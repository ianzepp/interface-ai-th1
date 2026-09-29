/**
 * The first `SurfaceDriver`: a browser page driven through Playwright.
 *
 * This adapter translates in both directions between Playwright's locating,
 * waiting, extraction, and screenshots and the surface-neutral vocabulary.
 * Nothing in the artifact schema names Playwright, so adding a second surface
 * changes no recorded flow.
 *
 * INVARIANTS
 * - `locate` walks candidates in order and throws on the first candidate that
 *   matches more than once, rather than falling through to a looser candidate
 *   whose uniqueness would hide the ambiguity.
 * - `waitFor` polls every detector until one matches or the budget runs out. On
 *   expiry it returns the detector carrying a `timeout` signal, or `null` when
 *   none does; the engine routes `null` to the stage's `otherwise`.
 * - `captureEvidence` throws without an evidence directory: a silently skipped
 *   screenshot would leave a failure with no diagnostic material.
 * - `evidenceDirectory` is the run's `screenshots/` directory; evidence paths
 *   are returned relative to the run as `screenshots/<file>`.
 *
 * LIMITS
 * - `accessibility` is the page's visible body text, cut to 4,000 characters,
 *   not an accessibility tree.
 * - `observe` skips a requested screenshot when no evidence directory is set.
 * - Only `role`, `label`, `text`, and `css` candidates resolve. `relative`
 *   throws rather than approximating.
 * - A `count` signal is measured against the first candidate of its target.
 * - A `response-status` signal never matches.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Locator, Page } from "playwright";

import type {
    ActionResult,
    DetectorSignal,
    EvidenceReference,
    ExtractionSpec,
    LocatorCandidate,
    Observation,
    ObservationRequest,
    StateDetector,
    StateMatch,
    SurfaceAction,
    SurfaceDriver,
    TargetDescriptor,
    TargetResolution,
} from "./surface-driver.js";

/**
 * Playwright's accessible-role vocabulary.
 *
 * Derived from `getByRole` so this adapter cannot drift from the installed
 * Playwright's accepted role names.
 */
type AriaRole = Parameters<Page["getByRole"]>[0];

const OBSERVATION_TEXT_LIMIT = 4_000;
const POLL_INTERVAL_MS = 100;

/** A browser page: one `SurfaceDriver` over one Playwright `Page`. */
export class PlaywrightBrowserDriver implements SurfaceDriver {
    public constructor(
        public readonly page: Page,
        public readonly evidenceDirectory?: string,
    ) {}

    public async observe(request: ObservationRequest): Promise<Observation> {
        const observation: Observation = {
            url: this.page.url(),
            title: await this.page.title(),
        };
        if (request.includeAccessibility) {
            const text = await this.page.locator("body").innerText();
            observation.accessibility = {
                text: text.slice(0, OBSERVATION_TEXT_LIMIT),
            };
        }
        if (request.includeScreenshot && this.evidenceDirectory !== undefined) {
            const reference = await this.captureEvidence("observation");
            observation.screenshotPath = reference.path;
        }
        return observation;
    }

    public async locate(target: TargetDescriptor): Promise<TargetResolution> {
        for (const [candidateIndex, candidate] of target.candidates.entries()) {
            const locator = this.locatorFor(candidate);
            const matchCount = await locator.count();
            if (matchCount === 1) {
                return {
                    candidateIndex,
                    matchCount,
                    description: JSON.stringify(candidate),
                };
            }
            if (matchCount > 1) {
                throw new Error(
                    `Ambiguous target ${JSON.stringify(candidate)} matched ${String(matchCount)} elements`,
                );
            }
        }
        throw new Error(`Missing target ${JSON.stringify(target.candidates)}`);
    }

    public async act(action: SurfaceAction): Promise<ActionResult> {
        switch (action.type) {
            case "navigate":
                await this.page.goto(action.url);
                break;
            case "activate":
                await (await this.resolve(action.target)).click();
                break;
            case "fill":
                await (await this.resolve(action.target)).fill(action.value);
                break;
            case "select":
                await (
                    await this.resolve(action.target)
                ).selectOption(action.value);
                break;
            case "press":
                await this.page.keyboard.press(action.key);
                break;
        }
        return {
            completed: true,
            observation: await this.observe({
                includeAccessibility: true,
                includeScreenshot: false,
            }),
        };
    }

    public async waitFor(
        detectors: readonly StateDetector[],
        timeoutMs: number,
    ): Promise<StateMatch | null> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            for (const detector of detectors) {
                if (await this.matches(detector)) {
                    return {
                        detectorId: detector.id,
                        observedAt: new Date().toISOString(),
                    };
                }
            }
            await this.page.waitForTimeout(POLL_INTERVAL_MS);
        }
        const timeout = detectors.find((detector) =>
            detector.signals.some((signal) => signal.kind === "timeout"),
        );
        return timeout === undefined
            ? null
            : { detectorId: timeout.id, observedAt: new Date().toISOString() };
    }

    public async extract(spec: ExtractionSpec): Promise<unknown> {
        const text = (
            await (await this.resolve(spec.target)).innerText()
        ).trim();
        switch (spec.type) {
            case "string":
                return text;
            case "number":
                return Number(text.replaceAll(",", ""));
            case "money":
                return Number(text.replaceAll(/[^0-9.-]/g, ""));
            case "boolean":
                return /^(true|yes|1)$/i.test(text);
        }
    }

    public async captureEvidence(reason: string): Promise<EvidenceReference> {
        if (this.evidenceDirectory === undefined) {
            throw new Error(
                "No evidence directory configured for Playwright driver",
            );
        }
        await mkdir(this.evidenceDirectory, { recursive: true });
        const slug = reason.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase();
        const filename = `${String(Date.now())}-${slug}.png`;
        const path = join(this.evidenceDirectory, filename);
        await this.page.screenshot({ path, fullPage: true });
        return {
            kind: "screenshot",
            path: join("screenshots", filename),
            redacted: false,
        };
    }

    private locatorFor(candidate: LocatorCandidate): Locator {
        switch (candidate.kind) {
            case "role":
                return this.page.getByRole(candidate.role as AriaRole, {
                    name: candidate.name,
                    exact: true,
                });
            case "label":
                return this.page.getByLabel(candidate.text, { exact: true });
            case "text":
                return this.page.getByText(candidate.text, {
                    exact: candidate.exact,
                });
            case "css":
                return this.page.locator(candidate.selector);
            case "relative":
                throw new Error(
                    `Relative locator is not implemented: ${candidate.anchor} ${candidate.relation}`,
                );
        }
    }

    private async resolve(target: TargetDescriptor): Promise<Locator> {
        const resolution = await this.locate(target);
        const candidate = target.candidates[resolution.candidateIndex];
        if (candidate === undefined)
            throw new Error("Resolved target candidate is missing");
        return this.locatorFor(candidate);
    }

    /** Whether any one of the detector's signals holds right now. */
    private async matches(detector: StateDetector): Promise<boolean> {
        for (const signal of detector.signals) {
            if (await this.matchesSignal(signal)) return true;
        }
        return false;
    }

    private async matchesSignal(signal: DetectorSignal): Promise<boolean> {
        switch (signal.kind) {
            case "url":
                return new RegExp(signal.pattern).test(this.page.url());
            case "text":
                return isVisible(
                    this.page.getByText(signal.value, { exact: signal.exact }),
                );
            case "role":
                return isVisible(
                    this.page.getByRole(signal.role as AriaRole, {
                        name: signal.name,
                        exact: true,
                    }),
                );
            case "count": {
                const count = await this.locatorFor(
                    signal.target.candidates[0] ?? {
                        kind: "css",
                        selector: ":not(*)",
                    },
                ).count();
                return signal.operator === "equal"
                    ? count === signal.value
                    : count > signal.value;
            }
            case "response-status":
            case "timeout":
                return false;
        }
    }
}

/** Whether the first match is visible; a failed visibility check reads as not. */
async function isVisible(locator: Locator): Promise<boolean> {
    return locator
        .first()
        .isVisible()
        .catch(() => false);
}

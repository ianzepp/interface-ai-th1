/**
 * The first `SurfaceDriver`: a browser page driven through Playwright.
 *
 * Playwright supplies locating, waiting, extraction, and tracing, and this
 * adapter translates in both directions between that API and the surface-neutral
 * vocabulary. Nothing in the artifact schema names Playwright, so adding a second
 * surface changes no recorded flow.
 *
 * This adapter is where the seam's promises are kept or broken, so the decisions
 * behind them are recorded here:
 *
 * - `locate` walks the candidate list in order and accepts only a single match.
 *   More than one match throws immediately rather than falling through to a
 *   looser candidate, because a later candidate that happened to be unique would
 *   hide the ambiguity the first one exposed.
 * - `waitFor` polls every detector until one matches or the budget runs out. On
 *   expiry it returns whichever detector carried a `timeout` signal, and `null`
 *   when the stage declared none. The engine routes `null` to the stage's
 *   `otherwise`, so "nothing recognized" stays a state a stage can name.
 * - `captureEvidence` refuses to run without an evidence directory. A silently
 *   skipped screenshot would leave a failure with no diagnostic material, which
 *   is the one thing a failure must carry.
 *
 * LIMITS
 * - Only `role`, `label`, `text`, and `css` candidates resolve. `relative` is
 *   declared in the vocabulary but unimplemented, so its failure is a loud throw
 *   rather than a quiet approximation.
 * - A `count` signal is measured against the first candidate of its target only.
 *   Count signals name one way of finding the elements being counted.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { BrowserContext, Locator, Page } from "playwright";

import type {
    ActionResult,
    EvidenceReference,
    ExtractionSpec,
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

/** A browser page: one `SurfaceDriver` over one Playwright `Page`. */
export class PlaywrightBrowserDriver implements SurfaceDriver {
    public constructor(
        public readonly context: BrowserContext,
        public readonly page: Page,
        public readonly evidenceDirectory?: string,
    ) {}

    public async observe(request: ObservationRequest): Promise<Observation> {
        const observation: Observation = {
            url: this.page.url(),
            title: await this.page.title(),
        };
        if (request.includeAccessibility) {
            observation.accessibility = {
                text: (await this.page.locator("body").innerText()).slice(
                    0,
                    4_000,
                ),
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
            await this.page.waitForTimeout(100);
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
        const filename = `${String(Date.now())}-${reason.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
        const path = join(this.evidenceDirectory, filename);
        await this.page.screenshot({ path, fullPage: true });
        return {
            kind: "screenshot",
            path: join("screenshots", filename),
            redacted: false,
        };
    }

    private async resolve(target: TargetDescriptor): Promise<Locator> {
        const resolution = await this.locate(target);
        const candidate = target.candidates[resolution.candidateIndex];
        if (candidate === undefined)
            throw new Error("Resolved target candidate is missing");
        return this.locatorFor(candidate);
    }

    private locatorFor(
        candidate: TargetDescriptor["candidates"][number],
    ): Locator {
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

    private async matches(detector: StateDetector): Promise<boolean> {
        for (const signal of detector.signals) {
            switch (signal.kind) {
                case "url":
                    if (new RegExp(signal.pattern).test(this.page.url()))
                        return true;
                    break;
                case "text":
                    if (
                        await this.page
                            .getByText(signal.value, { exact: signal.exact })
                            .first()
                            .isVisible()
                            .catch(() => false)
                    )
                        return true;
                    break;
                case "role":
                    if (
                        await this.page
                            .getByRole(signal.role as AriaRole, {
                                name: signal.name,
                                exact: true,
                            })
                            .first()
                            .isVisible()
                            .catch(() => false)
                    )
                        return true;
                    break;
                case "count": {
                    const count = await this.locatorFor(
                        signal.target.candidates[0] ?? {
                            kind: "css",
                            selector: ":not(*)",
                        },
                    ).count();
                    if (
                        (signal.operator === "equal" &&
                            count === signal.value) ||
                        (signal.operator === "greater-than" &&
                            count > signal.value)
                    )
                        return true;
                    break;
                }
                case "response-status":
                case "timeout":
                    break;
            }
        }
        return false;
    }
}

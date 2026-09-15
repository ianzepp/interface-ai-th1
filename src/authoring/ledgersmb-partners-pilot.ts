import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { chromium, type Locator, type Page } from "playwright";

import type {
    ActionResult,
    SurfaceAction,
    TargetDescriptor,
} from "../surfaces/surface-driver.js";
import { PlaywrightTestRunCapture } from "./playwright-run-capture.js";
import { FileTestRunRecorder } from "./run-recorder.js";

const BASE_URL = "http://127.0.0.1:5762";
const recorder = await FileTestRunRecorder.start({
    rootDirectory: join(process.cwd(), "runs"),
    goal: "Create the synthetic customer and vendor accounts required by the LedgerSMB inventory scenarios.",
    situation:
        "LedgerSMB initialized with the fixture administrator and no trading partners.",
    targetProfile: "ledgersmb",
    targetVersion: "1.13.7",
    fixtureId: "ledgersmb/initialized-company",
});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "en-US" });
const page = await context.newPage();
const capture = await PlaywrightTestRunCapture.start(context.tracing, recorder);

try {
    await login(page);
    await createCompany(
        page,
        "Northwind Outdoor Supply",
        "CUST-1001",
        "Customer",
        "Northwind customer account",
    );
    await createCompany(
        page,
        "Summit Gear Manufacturing",
        "VEND-2001",
        "Vendor",
        "Summit vendor account",
    );
    await mkdir(join(recorder.directory, "screenshots"), { recursive: true });
    await page.screenshot({
        path: join(recorder.directory, "screenshots", "partners-ready.png"),
        fullPage: true,
    });
    await recorder.append({
        type: "checkpoint",
        recordedAt: new Date().toISOString(),
        name: "customer-and-vendor-accounts-visible",
        satisfied: true,
    });
    await capture.finish({
        status: "satisfied",
        summary:
            "Created and visibly verified customer CUST-1001 and vendor VEND-2001.",
        checkpoint: "customer-and-vendor-accounts-visible",
    });
} catch (error) {
    await mkdir(join(recorder.directory, "screenshots"), { recursive: true });
    await page
        .screenshot({
            path: join(recorder.directory, "screenshots", "error.png"),
            fullPage: true,
        })
        .catch(() => undefined);
    await capture.finish({
        status: "error",
        code: "create-trading-partners-failed",
        summary: conciseError(error),
    });
    throw error;
} finally {
    await context.close();
    await browser.close();
    console.log(`Run directory: ${recorder.directory}`);
}

async function login(page: Page): Promise<void> {
    await action(
        page,
        { type: "navigate", url: `${BASE_URL}/login.pl` },
        "Open the LedgerSMB login surface.",
        () => page.goto(`${BASE_URL}/login.pl`).then(() => undefined),
    );
    await fill(page, "#username", "admin", "Enter the fixture administrator.");
    await fill(
        page,
        "#password",
        "interface-ai-local",
        "Enter the fixture password.",
    );
    await fill(
        page,
        "#company",
        "interface_ai",
        "Enter the initialized company.",
    );
    await click(
        page,
        roleTarget("button", "Login"),
        "Authenticate to the initialized company.",
        page.getByRole("button", { name: "Login", exact: true }),
    );
    await page.getByText("Welcome to LedgerSMB", { exact: true }).waitFor();
    const alert = page.getByRole("button", { name: "OK", exact: true });
    if (await alert.isVisible())
        await click(
            page,
            roleTarget("button", "OK"),
            "Dismiss the password notice.",
            alert,
        );
}

async function createCompany(
    page: Page,
    name: string,
    number: string,
    accountClass: "Customer" | "Vendor",
    description: string,
): Promise<void> {
    const contacts = page.getByRole("treeitem", {
        name: "Contacts",
        exact: true,
    });
    if ((await contacts.getAttribute("aria-expanded")) !== "true")
        await click(
            page,
            roleTarget("treeitem", "Contacts"),
            "Open the Contacts menu.",
            contacts,
        );
    await click(
        page,
        roleTarget("treeitem", "Add Entity"),
        "Open the company creation form.",
        page.getByRole("treeitem", { name: "Add Entity", exact: true }),
    );
    await page.getByRole("textbox", { name: "Name", exact: true }).waitFor();
    await fillLocator(
        page,
        page.getByRole("textbox", { name: "Name", exact: true }),
        roleTarget("textbox", "Name"),
        name,
        `Enter the ${accountClass.toLowerCase()} company name.`,
    );
    await choose(page, "Country", "United States");
    await click(
        page,
        roleTarget("button", "Generate Control Code"),
        "Generate a stable application-owned control code.",
        page.getByRole("button", {
            name: "Generate Control Code",
            exact: true,
        }),
    );
    await click(
        page,
        roleTarget("button", "Save"),
        "Save the company identity.",
        page.getByRole("button", { name: "Save", exact: true }),
    );
    await page
        .getByRole("tab", { name: "Credit Accounts", exact: true })
        .waitFor();
    if (accountClass === "Vendor") await choose(page, "Class", "Vendor");
    await fillLocator(
        page,
        page.getByRole("textbox", { name: "Number", exact: true }),
        roleTarget("textbox", "Number"),
        number,
        `Enter the ${accountClass.toLowerCase()} account number.`,
    );
    await fillLocator(
        page,
        page.getByRole("textbox", { name: "Description", exact: true }),
        roleTarget("textbox", "Description"),
        description,
        `Describe the ${accountClass.toLowerCase()} account.`,
    );
    await click(
        page,
        roleTarget("button", "Save New"),
        `Create the ${accountClass.toLowerCase()} credit account.`,
        page.getByRole("button", { name: "Save New", exact: true }),
    );
    await page.getByRole("link", { name: number, exact: true }).waitFor();
}

async function choose(
    page: Page,
    label: string,
    option: string,
): Promise<void> {
    await click(
        page,
        roleTarget("listbox", label),
        `Open the ${label} list.`,
        page.getByRole("listbox", { name: label, exact: true }),
    );
    await click(
        page,
        roleTarget("option", option),
        `Choose ${option} for ${label}.`,
        page.getByRole("option", { name: option, exact: true }),
    );
}

async function fill(
    page: Page,
    selector: string,
    value: string,
    rationale: string,
): Promise<void> {
    await fillLocator(
        page,
        page.locator(selector),
        cssTarget(selector),
        value,
        rationale,
    );
}

async function fillLocator(
    page: Page,
    locator: Locator,
    target: TargetDescriptor,
    value: string,
    rationale: string,
): Promise<void> {
    await action(page, { type: "fill", target, value }, rationale, () =>
        locator.fill(value),
    );
}

async function click(
    page: Page,
    target: TargetDescriptor,
    rationale: string,
    locator: Locator,
): Promise<void> {
    await action(page, { type: "activate", target }, rationale, () =>
        locator.click(),
    );
}

async function action(
    page: Page,
    browserAction: SurfaceAction,
    rationale: string,
    execute: () => Promise<void>,
): Promise<void> {
    await execute();
    const result: ActionResult = {
        completed: true,
        observation: {
            url: page.url(),
            title: await page.title(),
            accessibility: {
                text: (await page.locator("body").innerText()).slice(0, 2_000),
            },
        },
    };
    await recorder.append({
        type: "action",
        recordedAt: new Date().toISOString(),
        action: browserAction,
        result,
        rationale,
    });
}

function roleTarget(role: string, name: string): TargetDescriptor {
    return {
        candidates: [{ kind: "role", role, name }],
        require: "exactly-one",
    };
}
function cssTarget(selector: string): TargetDescriptor {
    return { candidates: [{ kind: "css", selector }], require: "exactly-one" };
}
function conciseError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.split("\n", 1)[0] ?? "Unknown partner creation failure";
}

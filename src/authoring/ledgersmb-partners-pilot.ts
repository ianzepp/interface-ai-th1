/**
 * Scripted capture pilot for LedgerSMB trading-partner creation, phase one of
 * the four-phase LedgerSMB corpus.
 *
 * From the `initialized-company` snapshot it creates the synthetic customer and
 * vendor, each with the credit account the later inventory phases depend on.
 * Each step appends a redacted action event with the rationale that held when
 * it ran. Run it through `npm run capture:ledgersmb:partners`, which restores
 * the snapshot first.
 *
 * INVARIANTS
 * - The run finalizes `satisfied` once both account numbers are visible, or
 *   `error` with a screenshot when any step throws.
 * - It leaves the created partners in the live fixture and creates no snapshot.
 */

import { runMain } from "../common/cli.js";
import {
    LEDGERSMB_ORIGIN,
    type LedgerSmbPilot,
    roleTarget,
    runLedgerSmbPilot,
} from "./ledgersmb-pilot.js";

async function main(): Promise<void> {
    await runLedgerSmbPilot({
        goal: "Create the synthetic customer and vendor accounts required by the LedgerSMB inventory scenarios.",
        situation:
            "LedgerSMB initialized with the fixture administrator and no trading partners.",
        fixtureId: "ledgersmb/initialized-company",
        errorCode: "create-trading-partners-failed",
        async steps(pilot, password) {
            await logIn(pilot, password);
            await createTradingPartner(
                pilot,
                "Northwind Outdoor Supply",
                "CUST-1001",
                "Customer",
                "Northwind customer account",
            );
            await createTradingPartner(
                pilot,
                "Summit Gear Manufacturing",
                "VEND-2001",
                "Vendor",
                "Summit vendor account",
            );
            await pilot.saveScreenshot("partners-ready.png");
            await pilot.finishSatisfied(
                "customer-and-vendor-accounts-visible",
                "Created and visibly verified customer CUST-1001 and vendor VEND-2001.",
            );
        },
    });
}

async function logIn(pilot: LedgerSmbPilot, password: string): Promise<void> {
    const { page } = pilot;
    await pilot.navigate(
        `${LEDGERSMB_ORIGIN}/login.pl`,
        "Open the LedgerSMB login surface.",
    );
    await pilot.fill("#username", "admin", "Enter the fixture administrator.");
    await pilot.fill("#password", password, "Enter the fixture password.");
    await pilot.fill(
        "#company",
        "interface_ai",
        "Enter the initialized company.",
    );
    await pilot.click(
        roleTarget("button", "Login"),
        "Authenticate to the initialized company.",
        page.getByRole("button", { name: "Login", exact: true }),
    );
    await page.getByText("Welcome to LedgerSMB", { exact: true }).waitFor();
    const expiryNotice = page.getByRole("button", { name: "OK", exact: true });
    if (await expiryNotice.isVisible()) {
        await pilot.click(
            roleTarget("button", "OK"),
            "Dismiss the password notice.",
            expiryNotice,
        );
    }
}

/** Create one company entity and the customer or vendor credit account on it. */
async function createTradingPartner(
    pilot: LedgerSmbPilot,
    name: string,
    number: string,
    accountClass: "Customer" | "Vendor",
    description: string,
): Promise<void> {
    const { page } = pilot;
    const kind = accountClass.toLowerCase();
    const contacts = page.getByRole("treeitem", {
        name: "Contacts",
        exact: true,
    });
    if ((await contacts.getAttribute("aria-expanded")) !== "true") {
        await pilot.click(
            roleTarget("treeitem", "Contacts"),
            "Open the Contacts menu.",
            contacts,
        );
    }
    await pilot.click(
        roleTarget("treeitem", "Add Entity"),
        "Open the company creation form.",
        page.getByRole("treeitem", { name: "Add Entity", exact: true }),
    );
    await page.getByRole("textbox", { name: "Name", exact: true }).waitFor();
    await pilot.fillLocator(
        page.getByRole("textbox", { name: "Name", exact: true }),
        roleTarget("textbox", "Name"),
        name,
        `Enter the ${kind} company name.`,
    );
    await chooseOption(pilot, "Country", "United States");
    await pilot.click(
        roleTarget("button", "Generate Control Code"),
        "Generate a stable application-owned control code.",
        page.getByRole("button", {
            name: "Generate Control Code",
            exact: true,
        }),
    );
    await pilot.click(
        roleTarget("button", "Save"),
        "Save the company identity.",
        page.getByRole("button", { name: "Save", exact: true }),
    );

    await page
        .getByRole("tab", { name: "Credit Accounts", exact: true })
        .waitFor();
    if (accountClass === "Vendor") {
        await chooseOption(pilot, "Class", "Vendor");
    }
    await pilot.fillLocator(
        page.getByRole("textbox", { name: "Number", exact: true }),
        roleTarget("textbox", "Number"),
        number,
        `Enter the ${kind} account number.`,
    );
    await pilot.fillLocator(
        page.getByRole("textbox", { name: "Description", exact: true }),
        roleTarget("textbox", "Description"),
        description,
        `Describe the ${kind} account.`,
    );
    await pilot.click(
        roleTarget("button", "Save New"),
        `Create the ${kind} credit account.`,
        page.getByRole("button", { name: "Save New", exact: true }),
    );
    await page.getByRole("link", { name: number, exact: true }).waitFor();
}

/** Open a custom listbox by its label, then pick one option from it. */
async function chooseOption(
    pilot: LedgerSmbPilot,
    label: string,
    option: string,
): Promise<void> {
    const { page } = pilot;
    await pilot.click(
        roleTarget("listbox", label),
        `Open the ${label} list.`,
        page.getByRole("listbox", { name: label, exact: true }),
    );
    await pilot.click(
        roleTarget("option", option),
        `Choose ${option} for ${label}.`,
        page.getByRole("option", { name: option, exact: true }),
    );
}

/**
 * One capture run's page, driven only through recorded steps.
 *
 * Every step passes the artifact policy before the browser acts, then appends
 * an action event carrying the rationale and the observation it left behind.
 */

await runMain(main);

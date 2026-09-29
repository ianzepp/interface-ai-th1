/**
 * Scripted capture pilot for LedgerSMB company initialization, phase zero of
 * the four-phase LedgerSMB corpus.
 *
 * From fresh Docker volumes it creates the company database, accepts the chart
 * of accounts and templates, creates the first administrator, and logs in as
 * that administrator. Each step appends a redacted action event with the
 * rationale that held when it ran. Run it through
 * `npm run capture:ledgersmb:initialize`, which performs the destructive
 * fixture reset first.
 *
 * INVARIANTS
 * - The run finalizes `satisfied` at the authenticated home screen, or `error`
 *   with a screenshot when any step throws.
 * - It creates no snapshot: `initialized-company` is a review action taken
 *   after the run has been checked.
 */

import { runMain } from "../common/cli.js";
import {
    cssTarget,
    LEDGERSMB_ORIGIN,
    type LedgerSmbPilot,
    roleTarget,
    runLedgerSmbPilot,
} from "./ledgersmb-pilot.js";

const DATABASE = "interface_ai";
const USERNAME = "admin";

async function main(): Promise<void> {
    await runLedgerSmbPilot({
        goal: "Initialize a fresh LedgerSMB company and prove the first administrator can log in.",
        situation:
            "Fresh LedgerSMB Docker volumes with PostgreSQL available and no company database.",
        fixtureId: "ledgersmb/fresh",
        errorCode: "initialize-company-failed",
        async steps(pilot, password) {
            await createCompanyDatabase(pilot, password);
            await acceptChartAndTemplates(pilot);
            await createAdministrator(pilot, password);
            await pilot.saveScreenshot("setup-complete.png");
            await pilot.recordObservation("screenshots/setup-complete.png");
            await logIn(pilot, password);
            await pilot.saveScreenshot("authenticated.png");
            await pilot.recordObservation("screenshots/authenticated.png");
            await pilot.finishSatisfied(
                "authenticated-ledgersmb-home",
                "The company database and administrator were created, and the administrator reached the LedgerSMB home screen.",
            );
        },
    });
}

async function createCompanyDatabase(
    pilot: LedgerSmbPilot,
    password: string,
): Promise<void> {
    const { page } = pilot;
    await pilot.navigate(
        `${LEDGERSMB_ORIGIN}/setup.pl`,
        "Open the database setup surface on the allowlisted local origin.",
    );
    await page.locator("#s-user").waitFor();
    await pilot.fill(
        "#s-user",
        "postgres",
        "Enter the local database administrator.",
    );
    await pilot.fill(
        "#s-password",
        password,
        "Enter the disposable local database password.",
    );
    await pilot.fill(
        "#database",
        DATABASE,
        "Name the fixture company database.",
    );
    await pilot.click(
        roleTarget("button", "Create"),
        "Create the company database from the fresh PostgreSQL state.",
        page.getByRole("button", { name: "Create" }),
    );
}

async function acceptChartAndTemplates(pilot: LedgerSmbPilot): Promise<void> {
    const { page } = pilot;
    await page.locator("input[name=coa_lc]").waitFor({ state: "attached" });
    await pilot.click(
        roleTarget("option", "Argentina"),
        "Open the chart-of-accounts country list from its current selection.",
        page.getByRole("option", { name: "Argentina", exact: true }),
    );
    await pilot.click(
        roleTarget("option", "United States"),
        "Select the United States chart family.",
        page.getByRole("option", { name: "United States", exact: true }),
    );
    await pilot.click(
        roleTarget("button", "Next"),
        "Continue with the selected country.",
        page.getByRole("button", { name: "Next" }),
    );

    await page.locator("input[name=chart]").waitFor({ state: "attached" });
    await pilot.click(
        roleTarget("button", "Next"),
        "Accept the General chart of accounts selected by the application.",
        page.getByRole("button", { name: "Next" }),
    );
    await page
        .locator("input[name=template_dir]")
        .waitFor({ state: "attached" });
    await pilot.click(
        roleTarget("button", "Load Templates"),
        "Load the selected demo templates required by the fixture.",
        page.getByRole("button", { name: "Load Templates" }),
    );
}

async function createAdministrator(
    pilot: LedgerSmbPilot,
    password: string,
): Promise<void> {
    const { page } = pilot;
    await page.locator("#username").waitFor();
    await pilot.fill(
        "#username",
        USERNAME,
        "Set the initial application username.",
    );
    await pilot.fill(
        "#password",
        password,
        "Set the disposable local application password.",
    );
    await pilot.fill(
        "#first-name",
        "Fixture",
        "Identify the synthetic administrator.",
    );
    await pilot.fill(
        "#last-name",
        "Administrator",
        "Identify the synthetic administrator.",
    );
    await pilot.fill(
        "#employeenumber",
        "EMP-001",
        "Set a stable employee identifier.",
    );
    await pilot.fill(
        "#dob",
        "1980-01-01",
        "Complete the required synthetic birth date.",
    );
    await pilot.fill(
        "#ssn",
        "000-00-0000",
        "Complete the required synthetic tax identifier.",
    );
    await chooseOption(pilot, "Salutation", "Mr.");
    await chooseOption(pilot, "Country", "United States");
    await chooseOption(pilot, "Assign Permissions", "Full Permissions");
    await pilot.click(
        roleTarget("button", "Create User"),
        "Create the initial administrator with full fixture permissions.",
        page.getByRole("button", { name: "Create User" }),
    );
    await page
        .getByText("Database Operation Complete", { exact: true })
        .waitFor();
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
        `Open the ${label} selection.`,
        page.getByRole("listbox", { name: label }),
    );
    await pilot.click(
        roleTarget("option", option),
        `Select ${option} for ${label}.`,
        page.getByRole("option", { name: option, exact: true }),
    );
}

async function logIn(pilot: LedgerSmbPilot, password: string): Promise<void> {
    const { page } = pilot;
    await pilot.navigate(
        `${LEDGERSMB_ORIGIN}/login.pl`,
        "Open the application login surface to verify the created user.",
    );
    await pilot.fill(
        "#username",
        USERNAME,
        "Enter the fixture administrator username.",
    );
    await pilot.fill(
        "#password",
        password,
        "Enter the disposable fixture password.",
    );
    await pilot.fill(
        "#company",
        DATABASE,
        "Select the initialized company database.",
    );
    await pilot.click(
        cssTarget("form button"),
        "Authenticate with the newly created administrator.",
        page.locator("form").getByRole("button"),
    );
    await page.getByText("Welcome to LedgerSMB", { exact: true }).waitFor();
    const expiryNotice = page.getByRole("button", { name: "OK" });
    if (await expiryNotice.isVisible()) {
        await pilot.click(
            roleTarget("button", "OK"),
            "Dismiss the expected disposable-password expiry notice.",
            expiryNotice,
        );
    }
}

/**
 * One capture run's page, driven only through recorded steps.
 *
 * Every step passes the artifact policy before the browser acts, then appends
 * an action event carrying the rationale and the observation it left behind.
 */

await runMain(main);

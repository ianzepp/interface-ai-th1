/**
 * Scripted capture pilot for the LedgerSMB inventory lifecycle, phase three and
 * the final phase of the four-phase LedgerSMB corpus.
 *
 * From the `catalog-ready` snapshot it posts a 30-unit vendor purchase, posts a
 * three-unit customer sale, records a physical count of 25 against 27 expected,
 * and approves the resulting two-unit shortage. Each step appends a redacted
 * action event with the rationale that held when it ran. Run it through
 * `npm run capture:ledgersmb:lifecycle`, which restores the snapshot first.
 *
 * INVARIANTS
 * - Every wait is on something the application owns, never a sleep.
 * - The run starts authenticated: the harness logs in before tracing begins and
 *   dismisses the disposable-password expiry notice that can cover the first
 *   menu action.
 * - A route change can land before the client-rendered frame changes, leaving a
 *   control whose label the previous screen shares briefly present, so each
 *   stage waits for a marker unique to its destination screen.
 * - Picking an inventory item fills its description and price asynchronously,
 *   and reading them early submits an invalid price, so invoices wait for those
 *   field values. A fixed delay is rejected: it failed in the contiguous
 *   end-to-end run.
 * - The run finalizes `satisfied` once the approval clears, or `error` with a
 *   screenshot when any step throws. It creates no snapshot.
 */

import { runMain } from "../common/cli.js";
import {
    type LedgerSmbPilot,
    roleTarget,
    runLedgerSmbPilot,
} from "./ledgersmb-pilot.js";

async function main(): Promise<void> {
    await runLedgerSmbPilot({
        goal: "Post a 30-unit purchase and three-unit sale, then record and approve a physical count of 25.",
        situation:
            "LedgerSMB catalog-ready with TRAIL-PACK-40 on hand at zero.",
        fixtureId: "ledgersmb/catalog-ready",
        authenticateTo: "interface_ai",
        errorCode: "inventory-lifecycle-failed",
        async steps(pilot) {
            const today = new Date().toISOString().slice(0, 10);
            await createInvoice(
                pilot,
                "Accounts Payable",
                "Vendor Invoice",
                "BILL-2001",
                "30",
                "72.50",
                "2175.00",
            );
            await createInvoice(
                pilot,
                "Accounts Receivable",
                "Sales Invoice",
                "INV-1001",
                "3",
                "129.00",
                "387.00",
            );
            await enterPhysicalCount(pilot, today);
            await approvePhysicalCount(pilot);
            await pilot.saveScreenshot("inventory-lifecycle-complete.png");
            await pilot.finishSatisfied(
                "inventory-lifecycle-complete",
                "Posted the purchase and sale, then approved COUNT-001 with final on-hand quantity 25.",
            );
        },
    });
}

/** Enter, total, save, and post a one-line TRAIL-PACK-40 invoice. */
async function createInvoice(
    pilot: LedgerSmbPilot,
    menu: string,
    item: string,
    number: string,
    quantity: string,
    price: string,
    total: string,
): Promise<void> {
    const { page } = pilot;
    await openMenu(pilot, menu);
    await pilot.click(
        roleTarget("treeitem", item),
        `Open ${item}.`,
        page.getByRole("treeitem", { name: item, exact: true }),
    );
    await page
        .getByRole("textbox", { name: "Invoice Number", exact: true })
        .waitFor();
    await pilot.fillLocator(
        page.getByRole("textbox", { name: "Invoice Number", exact: true }),
        roleTarget("textbox", "Invoice Number"),
        number,
        "Set the invoice number.",
    );
    await pilot.fill(
        "#partnumber_1",
        "TRAIL-PACK-40",
        "Enter the inventory part number.",
    );
    await pilot.click(
        roleTarget("option", "TRAIL-PACK-40--Trail Pack 40L"),
        "Resolve the inventory part.",
        page.getByRole("option", {
            name: "TRAIL-PACK-40--Trail Pack 40L",
            exact: true,
        }),
    );
    await page.waitForFunction(
        () =>
            (document.querySelector<HTMLInputElement>("#description_1")
                ?.value ?? "") === "Trail Pack 40L" &&
            (document.querySelector<HTMLInputElement>("#sellprice_1")?.value ??
                "") !== "",
    );
    await pilot.fill("#qty_1", quantity, "Set the invoice quantity.");
    await pilot.fill("#sellprice_1", price, "Set the invoice unit price.");
    await pilot.click(
        roleTarget("button", "Update"),
        "Calculate the invoice total.",
        page.getByRole("button", { name: "Update", exact: true }).last(),
    );
    await page.getByText(total, { exact: true }).first().waitFor();
    await pilot.click(
        roleTarget("button", "Save"),
        "Save the invoice workflow.",
        page.getByRole("button", { name: "Save", exact: true }).last(),
    );
    await page
        .getByRole("button", { name: "Post", exact: true })
        .first()
        .waitFor();
    await pilot.click(
        roleTarget("button", "Post"),
        "Post the invoice.",
        page.getByRole("button", { name: "Post", exact: true }).first(),
    );
    await page.getByText("POSTED", { exact: true }).first().waitFor();
}

async function enterPhysicalCount(
    pilot: LedgerSmbPilot,
    countDate: string,
): Promise<void> {
    const { page } = pilot;
    await openMenu(pilot, "Goods & Services");
    await pilot.click(
        roleTarget("treeitem", "Enter Inventory"),
        "Open physical inventory entry.",
        page.getByRole("treeitem", { name: "Enter Inventory", exact: true }),
    );
    await page.getByText("Adjustment Details", { exact: true }).waitFor();
    await pilot.fillLocator(
        page.getByRole("textbox", { name: "Date", exact: true }),
        roleTarget("textbox", "Date"),
        countDate,
        "Set the accounting-effective count date explicitly.",
    );
    await pilot.fillLocator(
        page.getByRole("textbox", { name: "Source", exact: true }),
        roleTarget("textbox", "Source"),
        "COUNT-001",
        "Set the count reference.",
    );
    await pilot.click(
        roleTarget("button", "Continue"),
        "Open the count lines.",
        page.getByRole("button", { name: "Continue", exact: true }),
    );
    await pilot.fill(
        "input[name=partnumber_1]",
        "TRAIL-PACK-40",
        "Identify the counted part.",
    );
    await pilot.fill(
        "input[name=counted_1]",
        "25",
        "Enter the physical count.",
    );
    await pilot.click(
        roleTarget("button", "Next"),
        "Calculate expected quantity and variance.",
        page.getByRole("button", { name: "Next", exact: true }),
    );
    await page
        .locator("input[name=onhand_1][value='27']")
        .waitFor({ state: "attached" });
    await pilot.click(
        roleTarget("button", "Save"),
        "Save the physical inventory report.",
        page.getByRole("button", { name: "Save", exact: true }),
    );
}

async function approvePhysicalCount(pilot: LedgerSmbPilot): Promise<void> {
    const { page } = pilot;
    await openMenu(pilot, "Transaction Approval");
    await pilot.click(
        roleTarget("treeitem", "Inventory"),
        "Open pending inventory adjustments.",
        page.getByRole("treeitem", { name: "Inventory", exact: true }),
    );
    await page.getByText("Search Inventory Entry", { exact: true }).waitFor();
    await pilot.fillLocator(
        page.getByRole("textbox", { name: "Source", exact: true }),
        roleTarget("textbox", "Source"),
        "COUNT-001",
        "Filter the approval report to the count reference.",
    );
    await pilot.click(
        roleTarget("button", "Run Report"),
        "Run the pending inventory adjustment report.",
        page.getByRole("button", { name: "Run Report", exact: true }),
    );
    const countReport = page.getByRole("link", {
        name: "COUNT-001",
        exact: true,
    });
    await countReport.waitFor();
    await pilot.click(
        roleTarget("link", "COUNT-001"),
        "Open the pending count adjustment.",
        countReport,
    );
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    await approve.waitFor();
    await pilot.click(
        roleTarget("button", "Approve"),
        "Approve the observed two-unit shortage.",
        approve,
    );
    await approve.waitFor({ state: "hidden" });
}

/** Expand a menu tree item unless it is already expanded. */
async function openMenu(pilot: LedgerSmbPilot, name: string): Promise<void> {
    const item = pilot.page.getByRole("treeitem", { name, exact: true });
    if ((await item.getAttribute("aria-expanded")) !== "true") {
        await pilot.click(
            roleTarget("treeitem", name),
            `Open the ${name} menu.`,
            item,
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

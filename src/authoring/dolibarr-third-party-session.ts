import type { Page } from "playwright";

import { runInteractivePlaywrightSession } from "./interactive-playwright-session.js";

const BASE_URL = "http://127.0.0.1:8080";
const password = process.env.DOLIBARR_FIXTURE_PASSWORD;
const skipAuthentication = process.env.DOLIBARR_SKIP_AUTH === "1";
if (password === undefined && !skipAuthentication) {
    throw new Error("DOLIBARR_FIXTURE_PASSWORD is required");
}

await runInteractivePlaywrightSession({
    rootDirectory: "runs",
    goal: "Look up a Dolibarr third party by exact name and return its account profile.",
    situation:
        process.env.DOLIBARR_SCENARIO ??
        "Authenticated administrator starts from the demo fixture home page.",
    targetProfile: "dolibarr",
    targetVersion: "23.0.4",
    fixtureId: "dolibarr/demo-install-smoke",
    policy: {
        allowedOrigins: [BASE_URL],
        allowedActionTypes: ["navigate", "activate", "fill", "press"],
        riskyActionMode: "block",
    },
    prepare: skipAuthentication
        ? (page) =>
              page.goto(`${BASE_URL}/societe/list.php`).then(() => undefined)
        : (page) => authenticate(page, password ?? ""),
});

async function authenticate(
    page: Page,
    fixturePassword: string,
): Promise<void> {
    await page.goto(BASE_URL);
    if (!page.url().includes("/index.php?mainmenu=home")) {
        await page.locator('input[name="username"]').fill("admin");
        await page.locator('input[name="password"]').fill(fixturePassword);
        await page
            .locator('input[type="submit"], button[type="submit"]')
            .first()
            .click();
    }
    await page
        .getByRole("link", { name: "Third parties", exact: true })
        .waitFor();
}

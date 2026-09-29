/**
 * Operator entry point for promoting reviewed runs into `evidence/`:
 *
 *     scripts/promote-run <run-id>...
 *
 * The wrapper script builds first and then calls this file, so the documented
 * command and the compiled entry point cannot drift apart.
 *
 * EXIT CODES
 * - 1 when a requested run cannot be promoted.
 * - 2 when no run ID is given.
 */

import process from "node:process";

import { print, runMain } from "../common/cli.js";
import { promoteRuns } from "./evidence-promotion.js";

await runMain(main);

async function main(): Promise<void> {
    const runIds = process.argv.slice(2);
    if (runIds.length === 0) {
        print("Usage: scripts/promote-run <run-id> [<run-id> ...]");
        process.exitCode = 2;
        return;
    }

    const promoted = await promoteRuns({
        runsDirectory: "runs",
        evidenceDirectory: "evidence",
        runIds,
    });
    for (const run of promoted) {
        print(
            `Promoted ${run.runId} (${run.status}) to ${run.evidenceDirectory}`,
        );
    }
}

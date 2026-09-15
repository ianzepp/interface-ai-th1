import process from "node:process";

import { promoteTestRuns } from "./evidence-promotion.js";

/**
 * Operator entry point for promoting reviewed runs into `evidence/`:
 *
 *     scripts/promote-run <run-id>...
 *
 * The wrapper script builds first and then calls this file, so the documented
 * command and the compiled entry point cannot drift apart.
 */

const runIds = process.argv.slice(2);

try {
    const promoted = await promoteTestRuns({
        runsDirectory: "runs",
        evidenceDirectory: "evidence",
        runIds,
    });
    for (const run of promoted) {
        process.stdout.write(
            `Promoted ${run.runId} (${run.status}) to ${run.evidenceDirectory}\n`,
        );
    }
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
}

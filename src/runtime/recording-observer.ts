/**
 * The engine observer every replay runner uses to write its event ledger.
 *
 * A replay makes no decisions, so its ledger holds only what the engine did:
 * each completed stage action, attributed to the artifact stage rather than to
 * a model rationale, and each detector that confirmed a checkpoint.
 */

import type { FileRunRecorder } from "../authoring/run-recorder.js";
import type { EngineObserver } from "./engine.js";

/** Translate engine progress into the run's event ledger. */
export function createRecordingObserver(
    recorder: FileRunRecorder,
): EngineObserver {
    return {
        async actionCompleted(stageId, action, result) {
            await recorder.append({
                type: "action",
                recordedAt: new Date().toISOString(),
                action,
                result,
                rationale: `Deterministic artifact stage: ${stageId}`,
            });
        },
        async checkpoint(_stageId, detectorId) {
            await recorder.append({
                type: "checkpoint",
                recordedAt: new Date().toISOString(),
                name: detectorId,
                satisfied: true,
            });
        },
    };
}

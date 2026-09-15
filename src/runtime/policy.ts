import type { ActionRisk, SurfaceAction } from "../surfaces/surface-driver.js";

/**
 * The guardrail decision, applied to every action before it runs.
 *
 * The model is an allowlist with a risk override. An action runs only if its
 * type is permitted. Irreversible actions are the one class with special
 * handling: `block` refuses them outright, and `require-confirmation` stops the
 * run for a person instead. There is no setting that lets an irreversible action
 * through unattended, so a capability cannot quietly become destructive by
 * editing its own policy.
 *
 * LIMITS
 * - This constrains action types and risk, not intent. A permitted fill can
 *   still carry a wrong value, and a permitted navigation can still reach a page
 *   nobody intended to reach.
 * - `allowedOrigins` is declared and recorded but not yet checked. `evaluate`
 *   inspects the action type and the risk only, so origin membership is
 *   currently documentation rather than enforcement.
 * - Nothing binds replay to the policy recorded in the artifact: the engine
 *   applies whatever `ArtifactPolicy` it is constructed with. Honouring the
 *   recorded policy is replay's job, and replay is not implemented.
 * - Requests are denied, not sanitized. An action outside the allowlist is
 *   blocked rather than rewritten into something permitted, because silently
 *   altering an action would make replay diverge from the reviewed artifact.
 * - The allowlist describes what a flow needs. It is not a security boundary
 *   against a hostile capability, which would need its own review gate.
 */

/**
 * The recorded allowlist for one capability.
 *
 * `allowedActionTypes` is what `evaluate` enforces today. `riskyActionMode`
 * decides whether an irreversible action is refused or pauses for a person, and
 * `allowedOrigins` names the application origins the capability is meant to act
 * on.
 */
export interface PolicyConfiguration {
    allowedOrigins: readonly string[];
    allowedActionTypes: readonly SurfaceAction["type"][];
    riskyActionMode: "block" | "require-confirmation";
}

/** The verdict for one action, with the reason a denial carries forward. */
export type PolicyDecision =
    | { type: "allow" }
    | { type: "block"; reason: string }
    | { type: "require-confirmation"; reason: string };

export class ArtifactPolicy {
    public constructor(public readonly configuration: PolicyConfiguration) {}

    /**
     * Decide whether an action may run.
     *
     * Action type is checked before risk, so a disallowed verb is refused even
     * when the caller marks it safe.
     */
    public evaluate(
        action: SurfaceAction,
        risk: ActionRisk = "safe",
    ): PolicyDecision {
        if (!this.configuration.allowedActionTypes.includes(action.type)) {
            return {
                type: "block",
                reason: `Action type ${action.type} is not allowlisted`,
            };
        }

        if (risk === "irreversible") {
            return this.configuration.riskyActionMode === "block"
                ? { type: "block", reason: "Irreversible actions are blocked" }
                : {
                      type: "require-confirmation",
                      reason: "Irreversible action requires human confirmation",
                  };
        }

        return { type: "allow" };
    }
}

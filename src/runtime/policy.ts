import type {
  ActionRisk,
  SurfaceAction,
} from "../surfaces/surface-driver.js";

export interface PolicyConfiguration {
  allowedOrigins: readonly string[];
  allowedActionTypes: readonly SurfaceAction["type"][];
  riskyActionMode: "block" | "require-confirmation";
}

export type PolicyDecision =
  | { type: "allow" }
  | { type: "block"; reason: string }
  | { type: "require-confirmation"; reason: string };

export class ArtifactPolicy {
  public constructor(public readonly configuration: PolicyConfiguration) {}

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

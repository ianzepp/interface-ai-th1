import type { TargetProfile } from "../target-profile.js";
import { ledgerSmbDetectors } from "./detectors.js";

export const ledgerSmbProfile: TargetProfile = {
  id: "ledgersmb",
  displayName: "LedgerSMB",
  surface: "browser",
  supportedVersions: [],
  allowedOrigins: ["http://localhost:5762"],
  globalDetectors: ledgerSmbDetectors,
};

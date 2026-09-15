import type { TargetProfile } from "../target-profile.js";
import { ledgerSmbDetectors } from "./detectors.js";

export const ledgerSmbProfile: TargetProfile = {
    id: "ledgersmb",
    displayName: "LedgerSMB",
    surface: "browser",
    supportedVersions: ["1.13.7"],
    allowedOrigins: ["http://127.0.0.1:5762"],
    globalDetectors: ledgerSmbDetectors,
};

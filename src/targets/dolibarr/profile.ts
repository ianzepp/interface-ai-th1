import type { TargetProfile } from "../target-profile.js";
import { dolibarrDetectors } from "./detectors.js";

export const dolibarrProfile: TargetProfile = {
    id: "dolibarr",
    displayName: "Dolibarr",
    surface: "browser",
    supportedVersions: ["23.0.4"],
    allowedOrigins: ["http://127.0.0.1:8080"],
    globalDetectors: dolibarrDetectors,
};

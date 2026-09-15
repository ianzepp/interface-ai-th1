import type { TargetProfile } from "../target-profile.js";
import { dolibarrDetectors } from "./detectors.js";

export const dolibarrProfile: TargetProfile = {
  id: "dolibarr",
  displayName: "Dolibarr",
  surface: "browser",
  supportedVersions: [],
  allowedOrigins: ["http://localhost:8080"],
  globalDetectors: dolibarrDetectors,
};

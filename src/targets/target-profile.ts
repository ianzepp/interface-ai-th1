import type { StateDetector } from "../surfaces/surface-driver.js";

export interface TargetProfile {
  id: string;
  displayName: string;
  surface: "browser";
  supportedVersions: readonly string[];
  allowedOrigins: readonly string[];
  globalDetectors: readonly StateDetector[];
}

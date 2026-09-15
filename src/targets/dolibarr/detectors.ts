import type { StateDetector } from "../../surfaces/surface-driver.js";

// Populate only after inspecting the pinned Dolibarr version. Target-specific
// detectors must be grounded in observed pages rather than assumed labels.
export const dolibarrDetectors: readonly StateDetector[] = [];

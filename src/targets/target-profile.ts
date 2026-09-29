/**
 * What a target application is, independent of any recorded flow.
 *
 * A profile holds what is true of the whole application: its supported
 * versions, the origins the system may act on, and detectors for states any
 * flow in it can hit. Capabilities recorded against one vendor product share a
 * profile, so a version bump changes those detectors in one place.
 */

import type { StateDetector } from "../surfaces/surface-driver.js";

export interface TargetProfile {
    id: string;
    displayName: string;
    surface: "browser";
    /** Pinned versions; the first is the default target version for discovery. */
    supportedVersions: readonly string[];
    /** Origins the audit rubric accepts in an artifact's policy. */
    allowedOrigins: readonly string[];
    globalDetectors: readonly StateDetector[];
}

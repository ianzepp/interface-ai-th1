import type { StateDetector } from "../surfaces/surface-driver.js";

/**
 * What a target application is, independent of any recorded flow.
 *
 * A profile holds the knowledge that is true of the whole application: which
 * versions are supported, which origins the system may act on, and the
 * detectors for states any flow in that application can hit. Keeping this
 * separate from capabilities is what makes reuse possible, because many
 * capabilities recorded against one vendor product share a profile. A version
 * bump then changes detectors in one place instead of invalidating every flow
 * recorded against the application.
 */

export interface TargetProfile {
    id: string;
    displayName: string;
    surface: "browser";
    supportedVersions: readonly string[];
    allowedOrigins: readonly string[];
    globalDetectors: readonly StateDetector[];
}

/**
 * The target registry.
 *
 * Profiles are resolved by ID at the edges of the system, so a capability names
 * its target once and everything downstream looks it up here rather than
 * hard-coding an application.
 */

import { dolibarrProfile } from "./dolibarr/profile.js";
import { ledgerSmbProfile } from "./ledgersmb/profile.js";
import type { TargetProfile } from "./target-profile.js";

export const targetProfiles: readonly TargetProfile[] = [
    ledgerSmbProfile,
    dolibarrProfile,
];

/** The profile registered under `id`, or a thrown error naming the known IDs. */
export function getTargetProfile(id: string): TargetProfile {
    const profile = targetProfiles.find((candidate) => candidate.id === id);
    if (profile === undefined) {
        const known = targetProfiles.map((candidate) => candidate.id);
        throw new Error(
            `Unknown target profile: ${id} (expected one of ${known.join(", ")})`,
        );
    }
    return profile;
}

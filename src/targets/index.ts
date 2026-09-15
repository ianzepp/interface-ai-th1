import { dolibarrProfile } from "./dolibarr/profile.js";
import { ledgerSmbProfile } from "./ledgersmb/profile.js";
import type { TargetProfile } from "./target-profile.js";

export const targetProfiles: readonly TargetProfile[] = [
  ledgerSmbProfile,
  dolibarrProfile,
];

export function getTargetProfile(id: string): TargetProfile {
  const profile = targetProfiles.find((candidate) => candidate.id === id);

  if (profile === undefined) {
    throw new Error(`Unknown target profile: ${id}`);
  }

  return profile;
}

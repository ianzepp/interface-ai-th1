import assert from "node:assert/strict";
import test from "node:test";

import {
  getTargetProfile,
  targetProfiles,
} from "../src/targets/index.js";

test("registers LedgerSMB and Dolibarr as first-class targets", () => {
  assert.deepEqual(
    targetProfiles.map((profile) => profile.id),
    ["ledgersmb", "dolibarr"],
  );
});

test("rejects an unknown target profile", () => {
  assert.throws(() => getTargetProfile("unknown"), /Unknown target profile/);
});

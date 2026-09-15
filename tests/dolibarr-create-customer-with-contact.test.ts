import assert from "node:assert/strict";
import test from "node:test";

import { dolibarrCreateCustomerWithContactArtifact as artifact } from "../src/capabilities/dolibarr-create-customer-with-contact.js";

test("customer-with-contact artifact is a reviewed nine-stage happy path", () => {
    assert.equal(artifact.id, "dolibarr.create-customer-with-contact");
    assert.equal(artifact.entryStageId, "open-third-party-area");
    assert.deepEqual(artifact.contract.inputs, {
        baseUrl: "string",
        thirdPartyName: "string",
        thirdPartyId: "string",
        contactFirstName: "string",
        contactLastName: "string",
    });
    assert.deepEqual(artifact.contract.outputs, {
        thirdPartyName: "string",
        contactName: "string",
    });
    assert.equal(artifact.stages.length, 9);
    assert.deepEqual(
        artifact.stages.map((stage) => stage.id),
        [
            "open-third-party-area",
            "open-customer-form",
            "fill-customer-name",
            "create-customer",
            "open-contact-form",
            "select-created-party",
            "fill-contact-last-name",
            "fill-contact-first-name",
            "create-contact",
        ],
    );
    assert.ok(
        artifact.stages.every(
            (stage) =>
                stage.otherwise.type === "terminal" &&
                stage.otherwise.outcome.type === "failure",
        ),
    );
    assert.deepEqual(artifact.provenance.evidenceRunIds, [
        "20260915214829952-cc922cc2",
        "20260915215250640-fea3b05a",
    ]);
    assert.deepEqual(artifact.provenance.validatedRunIds, [
        "20260915215946224-05d43891",
    ]);
});

test("customer-with-contact artifact keeps the two mutation stages reversible", () => {
    assert.equal(artifact.stages[3]?.risk, "reversible");
    assert.equal(artifact.stages[8]?.risk, "reversible");
    assert.deepEqual(artifact.policy.allowedOrigins, ["http://127.0.0.1:8126"]);
    assert.deepEqual(artifact.policy.allowedActionTypes, [
        "navigate",
        "activate",
        "fill",
        "select",
    ]);
});

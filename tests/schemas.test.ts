import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { createRequire } from "node:module";

import { Ajv2020 } from "ajv/dist/2020.js";

import { dolibarrThirdPartyLookupArtifact } from "../src/capabilities/dolibarr-third-party-lookup.js";
import {
    DeterministicEngine,
    type CapabilityInvocation,
} from "../src/runtime/engine.js";
import { ArtifactPolicy } from "../src/runtime/policy.js";
import type { RunResult } from "../src/runtime/result.js";
import type { SurfaceDriver } from "../src/surfaces/surface-driver.js";
import { loadCapabilityArtifacts } from "../src/audit/artifact-catalog.js";

/**
 * The published schemas, as the authority the code must satisfy.
 *
 * These schemas were written first and then drifted, because nothing checked
 * anything against them: the only test touching them asserted that `$schema` and
 * `$id` existed. Meanwhile the real contract lived in the TypeScript types, which
 * the compiler enforces, and in the audit rubric, which the test suite enforces.
 * So the artifact contract had three written forms and the published one was the
 * only one nothing obeyed.
 *
 * The direction is deliberately schema-first. Deriving the schema from the types
 * would make it a mirror: it could never say the types are wrong, and it would
 * inherit weaknesses such as a stage definition that constrains field names but
 * not the vocabulary inside them. Authoring the schema means the contract is
 * designed rather than inherited, and the types are then the compiler's
 * expression of it.
 *
 * Artifacts and promoted replay results are checked as they exist in the
 * repository. The invocation fixture below mirrors the real replay's typed
 * input, so the engine and schema boundary are checked together.
 */

const repositoryRoot = join(import.meta.dirname, "..", "..");

// ajv-formats is CommonJS whose export is a function, and NodeNext will not present
// that as callable through an import, so it is required explicitly and typed here.
const addFormats = createRequire(import.meta.url)("ajv-formats") as (
    ajv: Ajv2020,
) => void;

const schemaFiles = [
    "capability.schema.json",
    "invocation.schema.json",
    "result.schema.json",
];

function compiler(): Ajv2020 {
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    return ajv;
}

async function loadSchema(name: string): Promise<object> {
    return JSON.parse(
        await readFile(join(repositoryRoot, "schemas", name), "utf8"),
    ) as object;
}

const interventionInvocationFixture: CapabilityInvocation = {
    capabilityId: dolibarrThirdPartyLookupArtifact.id,
    inputs: {
        baseUrl: "http://127.0.0.1:8080",
        name: "Book Keeping Company",
    },
};

for (const schemaFile of schemaFiles) {
    test(`${schemaFile} contains valid JSON Schema metadata`, async () => {
        const schema = (await loadSchema(schemaFile)) as Record<
            string,
            unknown
        >;

        assert.equal(
            schema.$schema,
            "https://json-schema.org/draft/2020-12/schema",
        );
        assert.equal(typeof schema.$id, "string");
    });
}

test("every committed artifact satisfies the published capability schema", async () => {
    const ajv = compiler();
    const validate = ajv.compile(await loadSchema("capability.schema.json"));
    const entries = await loadCapabilityArtifacts(repositoryRoot);

    assert.ok(entries.length > 0, "no capability artifacts were found");

    const violations: string[] = [];
    for (const entry of entries) {
        const { id } = entry.artifact;
        const { sourcePath } = entry;
        if (validate(entry.artifact)) continue;
        violations.push(
            `${id} (${sourcePath}):\n${ajv.errorsText(validate.errors, {
                separator: "\n  ",
            })}`,
        );
    }

    assert.deepEqual(violations, [], "artifacts violate the capability schema");
});

test("the intervention invocation fixture satisfies the published invocation schema", async () => {
    const ajv = compiler();
    const validate = ajv.compile(await loadSchema("invocation.schema.json"));

    assert.equal(
        validate(interventionInvocationFixture),
        true,
        ajv.errorsText(validate.errors),
    );
});

test("every promoted replay result satisfies the published result schema", async () => {
    const ajv = compiler();
    const validate = ajv.compile(await loadSchema("result.schema.json"));
    const runsDirectory = join(repositoryRoot, "evidence", "runs");

    const withResults: string[] = [];
    const violations: string[] = [];
    for (const run of (await readdir(runsDirectory)).sort()) {
        const resultPath = join(runsDirectory, run, "result.json");
        let source: string;
        try {
            source = await readFile(resultPath, "utf8");
        } catch {
            continue;
        }
        withResults.push(run);

        const result: unknown = JSON.parse(source);
        if (!validate(result)) {
            violations.push(
                `${run}/result.json:\n${ajv.errorsText(validate.errors, {
                    separator: "\n  ",
                })}`,
            );
        }
    }

    assert.deepEqual(violations, [], "results violate the result schema");
    assert.ok(
        withResults.length > 0,
        "no replay results were found to validate against the result schema",
    );
});

test("the engine intervention result remains typed and schema-valid", async () => {
    const ajv = compiler();
    const validate = ajv.compile(await loadSchema("result.schema.json"));
    const result: RunResult = await new DeterministicEngine(
        authenticationRequiredDriver(),
        new ArtifactPolicy(dolibarrThirdPartyLookupArtifact.policy),
    ).run(dolibarrThirdPartyLookupArtifact, interventionInvocationFixture);

    assert.deepEqual(result, {
        type: "intervention-required",
        requestId: "dolibarr.lookup-third-party:open-list",
        code: "authentication-required",
        recoveries: [],
    });
    assert.equal(validate(result), true, ajv.errorsText(validate.errors));
});

function authenticationRequiredDriver(): SurfaceDriver {
    return {
        observe: () =>
            Promise.resolve({
                url: "http://127.0.0.1:8080",
                title: "Login",
            }),
        locate: () =>
            Promise.resolve({
                candidateIndex: 0,
                matchCount: 1,
                description: "fixture target",
            }),
        act: () =>
            Promise.resolve({
                completed: true,
                observation: {
                    url: "http://127.0.0.1:8080",
                    title: "Login",
                },
            }),
        waitFor: () =>
            Promise.resolve({
                detectorId: "dolibarr-authentication-required",
                observedAt: "2026-09-17T00:00:00.000Z",
            }),
        extract: () => Promise.resolve(undefined),
        captureEvidence: () =>
            Promise.resolve({
                kind: "screenshot",
                path: "login.png",
                redacted: true,
            }),
    };
}

test("the published schemas admit declared recovery evidence without requiring it historically", async () => {
    const ajv = compiler();
    const capabilitySchema = ajv.compile(
        await loadSchema("capability.schema.json"),
    );
    const resultSchema = ajv.compile(await loadSchema("result.schema.json"));
    const artifact = JSON.parse(
        JSON.stringify(dolibarrThirdPartyLookupArtifact),
    ) as {
        stages: { transitions: Record<string, unknown>[] }[];
    };
    const transition = artifact.stages[0]?.transitions[0];
    assert.ok(transition);
    transition.recovery = {
        id: "dismiss-known-interstitial",
        condition: "Known interstitial",
        sourceRunId: "run-interstitial",
        maxAttempts: 1,
    };

    assert.equal(
        capabilitySchema(artifact),
        true,
        ajv.errorsText(capabilitySchema.errors),
    );
    assert.equal(
        resultSchema({ type: "success", outputs: {} }),
        true,
        "historical results may omit recovery reports",
    );
    assert.equal(
        resultSchema({
            type: "success",
            outputs: {},
            recoveries: [
                {
                    recoveryId: "dismiss-known-interstitial",
                    condition: "Known interstitial",
                    sourceRunId: "run-interstitial",
                    detectorId: "interstitial",
                    attempt: 1,
                    evidence: [],
                },
            ],
        }),
        true,
        ajv.errorsText(resultSchema.errors),
    );
});

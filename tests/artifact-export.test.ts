import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import { loadCapabilityArtifacts } from "../src/audit/artifact-catalog.js";
import { serializeCapabilityArtifact } from "../src/authoring/export-artifact-cli.js";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const exportDirectory = join(repositoryRoot, "evidence", "capabilities");

// ajv-formats is CommonJS whose export is a function, and NodeNext will not present
// that as callable through an import, so it is required explicitly and typed here.
const addFormats = createRequire(import.meta.url)("ajv-formats") as (
    ajv: Ajv2020,
) => void;

async function loadCapabilitySchema(): Promise<object> {
    return JSON.parse(
        await readFile(
            join(repositoryRoot, "schemas", "capability.schema.json"),
            "utf8",
        ),
    ) as object;
}

async function committedExports(): Promise<readonly string[]> {
    return (await readdir(exportDirectory))
        .filter((name) => name.endsWith(".json"))
        .sort();
}

async function committedArtifacts() {
    return loadCapabilityArtifacts(repositoryRoot);
}

test("every committed artifact has a byte-identical deterministic export", async () => {
    const entries = await committedArtifacts();
    assert.ok(entries.length > 0, "no capability artifacts were found");

    const expectedNames = entries
        .map((entry) => `${entry.artifact.id}.json`)
        .sort();
    assert.deepEqual(await committedExports(), expectedNames);

    for (const entry of entries) {
        const path = join(exportDirectory, `${entry.artifact.id}.json`);
        assert.equal(
            await readFile(path, "utf8"),
            serializeCapabilityArtifact(entry.artifact),
            `${entry.artifact.id} export is not byte-identical to a fresh serialization`,
        );
    }
});

test("every committed artifact export satisfies the capability schema", async () => {
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(await loadCapabilitySchema());

    const violations: string[] = [];
    for (const name of await committedExports()) {
        const path = join(exportDirectory, name);
        const artifact: unknown = JSON.parse(await readFile(path, "utf8"));
        if (!validate(artifact)) {
            violations.push(
                `${name}:\n${ajv.errorsText(validate.errors, {
                    separator: "\n  ",
                })}`,
            );
        }
    }

    assert.deepEqual(
        violations,
        [],
        "capability exports violate the capability schema",
    );
});

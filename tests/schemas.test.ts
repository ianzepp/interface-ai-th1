import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaFiles = [
  "capability.schema.json",
  "invocation.schema.json",
  "result.schema.json",
];

for (const schemaFile of schemaFiles) {
  test(`${schemaFile} contains valid JSON Schema metadata`, async () => {
    const source = await readFile(`schemas/${schemaFile}`, "utf8");
    const schema = JSON.parse(source) as Record<string, unknown>;

    assert.equal(
      schema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
    );
    assert.equal(typeof schema.$id, "string");
  });
}

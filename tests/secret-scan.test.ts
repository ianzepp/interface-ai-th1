import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
    collectScanCandidates,
    collectStagedCandidates,
    type SecretScanCatalog,
} from "../src/audit/secret-scan-catalog.js";
import {
    DEFAULT_RULES,
    ledgerPresence,
    scanSecrets,
    type ScanCandidate,
    type ScanRules,
    type SecretFinding,
} from "../src/audit/secret-scan.js";

const execFileAsync = promisify(execFile);

/**
 * The secret scan, as a gate.
 *
 * Two jobs live here. The first is rule behaviour: each rule catches what it
 * claims to catch, and — just as important — stays quiet on the values that sit
 * in the same syntactic position as a secret without being one, because a noisy
 * gate is one people learn to skip. The second is the repository itself: the
 * committable surface carries no blocking finding, checked by running the same
 * scan over the real tree rather than over a fixture.
 *
 * PROBE VALUES ARE BUILT AT RUNTIME
 * The probes below are assembled from fragments. A literal provider key or PEM
 * header in this file's source would be a genuine finding in a committable file,
 * and the repository-wide test in this same file would fail on it. Building them
 * at runtime is what lets the tests demonstrate real detection without shipping
 * the thing being detected.
 *
 * The fixture-credential probes go further and use a synthetic value through an
 * injected rule set, so the real declared credential never appears in the tests
 * at all.
 */

const SYNTHETIC_FIXTURE = "synthetic-fixture-sentinel";

const RESPONSES: ScanRules = {
    ...DEFAULT_RULES,
    fixtureValues: [SYNTHETIC_FIXTURE],
    fixtureValuePaths: ["targets/dolibarr/compose.yaml"],
    patternDefinitionPaths: [],
    personalTokens: ["synthetic-host"],
    personalIdentifierPaths: ["AGENTS.md"],
};

function candidate(
    filePath: string,
    text: string,
    scope: ScanCandidate["scope"] = "committable",
): ScanCandidate {
    return { filePath, scope, text };
}

function rulesFor(
    filePath: string,
    text: string,
    scope: ScanCandidate["scope"] = "committable",
): readonly SecretFinding[] {
    return scanSecrets([candidate(filePath, text, scope)], RESPONSES);
}

function rulesOf(findings: readonly SecretFinding[]): readonly string[] {
    return findings.map((finding) => finding.rule);
}

// Probe values, assembled so this file never contains a matching literal. The
// URL and the key header are joined from fragments because a contiguous one would
// be a real finding in this file's own text; they use concatenation rather than a
// template literal with a constant expression, which a lint autofix collapses
// back into the literal this is avoiding.
const PROVIDER_KEY = `ghp_${"a".repeat(24)}`;
const PRIVATE_KEY_HEADER = ["-----BEGIN", "RSA", "PRIVATE KEY-----"].join(" ");
const DSN = [
    "postgres",
    "://",
    "app",
    ":",
    "s".repeat(20),
    "@db.internal/app",
].join("");
const BEARER = `Bearer ${"b".repeat(24)}`;
const SESSION_COOKIE = `DOLSESSID_${"c".repeat(40)}=${"d".repeat(26)}`;
const CSRF = `csrf_token=${"e".repeat(24)}`;
// Indirect through a variable, because a constant expression here is collapsed
// back into the literal by a lint autofix.
const USER_SEGMENT = "Users";
const HOME_PATH = `/${USER_SEGMENT}/example/`;

test("flags a fixture credential that reached a run artifact", () => {
    const findings = rulesFor(
        "runs/20260101000000000-abcdef12/events.jsonl",
        `{"value":"${SYNTHETIC_FIXTURE}"}`,
        "local",
    );

    assert.deepEqual(
        findings.map((finding) => ({
            rule: finding.rule,
            severity: finding.severity,
            line: finding.line,
        })),
        [
            {
                rule: "fixture-value-in-run-artifact",
                severity: "blocking",
                line: 1,
            },
        ],
    );
});

test("accepts the fixture credential in the fixture configuration", () => {
    const findings = rulesFor(
        "targets/dolibarr/compose.yaml",
        `      MARIADB_PASSWORD: ${SYNTHETIC_FIXTURE}`,
    );

    assert.deepEqual(findings, []);
});

test("flags the fixture credential outside the fixture configuration", () => {
    const findings = rulesFor(
        "src/authoring/some-pilot.ts",
        `const PASSWORD = "${SYNTHETIC_FIXTURE}";`,
    );

    assert.deepEqual(rulesOf(findings), [
        "fixture-value-outside-fixture-config",
    ]);
    assert.equal(findings[0]?.severity, "blocking");
});

test("downgrades the same finding to a warning in an ignored file", () => {
    const findings = rulesFor(
        "tmp/vivi/note.md",
        `the literal ${SYNTHETIC_FIXTURE} appears in older runs`,
        "local",
    );

    assert.equal(findings[0]?.severity, "warning");
});

test("flags each credential shape it claims to catch", () => {
    assert.deepEqual(rulesOf(rulesFor("a.txt", PROVIDER_KEY)), [
        "provider-key",
    ]);
    assert.deepEqual(rulesOf(rulesFor("a.txt", PRIVATE_KEY_HEADER)), [
        "private-key-material",
    ]);
    assert.deepEqual(rulesOf(rulesFor("a.txt", DSN)), [
        "credential-bearing-url",
    ]);
    assert.deepEqual(rulesOf(rulesFor("a.txt", `authorization: ${BEARER}`)), [
        "authorization-header",
    ]);
    assert.deepEqual(rulesOf(rulesFor("a.txt", SESSION_COOKIE)), [
        "session-cookie",
    ]);
    assert.deepEqual(rulesOf(rulesFor("a.txt", CSRF)), ["csrf-token"]);
});

test("flags an unquoted token whose value contains punctuation", () => {
    // A real csrf token carries characters a tidy character class excludes, and
    // under-matching here reports a clean file that is not clean. The backtick is
    // built from its code point so this file's own text stays matchable-clean.
    const punctuated = `YnQW)Wi}BkZaQf#P${String.fromCharCode(96)}oZi`;
    const findings = rulesFor(
        "runs/x/README.md",
        `navigated to "http://127.0.0.1:5762/setup.pl?csrf_token=${punctuated}"`,
        "local",
    );

    assert.deepEqual(rulesOf(findings), ["csrf-token"]);
});

test("flags a literal under a credential key, including a suffixed key", () => {
    assert.deepEqual(
        rulesOf(rulesFor("a.txt", `password: "${"p".repeat(12)}"`)),
        ["credential-assignment"],
    );
    assert.deepEqual(
        rulesOf(rulesFor("a.txt", `const PASSWORD = "${"q".repeat(12)}";`)),
        ["credential-assignment"],
    );
    assert.deepEqual(
        rulesOf(
            rulesFor("a.txt", `passwordHash: "${"$2y$10$" + "r".repeat(10)}"`),
        ),
        ["credential-assignment"],
    );
});

test("stays quiet on placeholders, types, and references", () => {
    const quiet = [
        `password: "string"`,
        `password: "[REDACTED]"`,
        `databasePassword: "{{input.databasePassword}}"`,
        `DOLIBARR_FIXTURE_PASSWORD=<fixture-password>`,
        `const password = process.env.DOLIBARR_FIXTURE_PASSWORD;`,
        `const password = requireFixturePassword();`,
        `const PASSWORD = requireEnvironment("LEDGERSMB_FIXTURE_PASSWORD");`,
        `password_field: "#password"`,
        `SecretSeverity = "blocking" | "warning" | "note";`,
        `type ScanScope = "committable" | "local";`,
        // Concatenated so this file's own text does not read as a token.
        `csrf_token=` + `\${input.csrfToken}`,
    ];

    for (const line of quiet) {
        assert.deepEqual(
            rulesFor("src/authoring/example.ts", line),
            [],
            `expected no finding for: ${line}`,
        );
    }
});

test("reports a personal identifier as a warning, not a blocker", () => {
    const findings = rulesFor(
        "docs/note.md",
        `see ${HOME_PATH}skills for more`,
    );

    assert.deepEqual(rulesOf(findings), ["personal-identifier"]);
    assert.equal(findings[0]?.severity, "warning");
});

test("never carries a usable value in a finding", () => {
    const findings = rulesFor("a.txt", `password: "${"z".repeat(16)}"`);
    const excerpt = findings[0]?.excerpt ?? "";

    assert.ok(
        excerpt.includes(`len 16`),
        `expected a length marker in: ${excerpt}`,
    );
    assert.ok(
        !excerpt.includes("z".repeat(16)),
        `excerpt carried the whole value: ${excerpt}`,
    );
});

test("reports a ledger entry that stops carrying its pattern", () => {
    const rows = ledgerPresence(
        [
            candidate("targets/dolibarr/compose.yaml", "no literal here"),
            candidate("AGENTS.md", "no personal identifier here"),
        ],
        RESPONSES,
    );

    assert.deepEqual(rows, [
        {
            filePath: "targets/dolibarr/compose.yaml",
            reason: "fixture-value",
            present: false,
        },
        {
            filePath: "AGENTS.md",
            reason: "personal-identifier",
            present: false,
        },
    ]);
});

test("the repository's committable surface carries no blocking finding", async () => {
    const catalog = await collectScanCandidates(repositoryRoot());
    const blocking = scanSecrets(catalog.candidates, DEFAULT_RULES).filter(
        (finding) =>
            finding.severity === "blocking" && finding.scope === "committable",
    );

    assert.deepEqual(
        blocking.map(
            (finding) =>
                `${finding.rule} ${finding.filePath}:${String(finding.line)}`,
        ),
        [],
    );
});

test("every recorded ledger entry still carries the pattern it is for", async () => {
    const rules = DEFAULT_RULES;
    assert.ok(
        rules.fixtureValuePaths.length > 0 &&
            rules.personalIdentifierPaths.length > 0,
        "expected a non-empty ledger; an emptied ledger passes vacuously",
    );

    const catalog = await collectScanCandidates(repositoryRoot());
    const missing = ledgerPresence(catalog.candidates, rules).filter(
        (row) => !row.present,
    );

    assert.deepEqual(
        missing.map((row) => `${row.reason} ${row.filePath}`),
        [],
    );
});

test("scans the staged index", async (t) => {
    const repo = await makeRepository();
    t.after(() => rm(repo, { recursive: true, force: true }));
    await writeFile(join(repo, "clean.ts"), "export const value = 1;\n");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "--quiet", "-m", "initial"]);

    await writeFile(
        join(repo, "app.ts"),
        `const apiKey = "${"k".repeat(24)}";\n`,
    );
    await git(repo, ["add", "app.ts"]);

    assert.deepEqual(await blockingStaged(repo), [
        "credential-assignment app.ts:1",
    ]);
});

test("does not scan content that is only in the working tree", async (t) => {
    const repo = await makeRepository();
    t.after(() => rm(repo, { recursive: true, force: true }));
    await writeFile(join(repo, "tracked.ts"), "export const value = 1;\n");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "--quiet", "-m", "initial"]);

    // Edited on disk, never staged: not what a commit would contain.
    await writeFile(
        join(repo, "tracked.ts"),
        `const apiKey = "${"k".repeat(24)}";\n`,
    );

    assert.deepEqual(await blockingStaged(repo), []);
    assert.deepEqual(await blockingTree(repo), [
        "credential-assignment tracked.ts:1",
    ]);
});

test("still scans staged content the working tree no longer matches", async (t) => {
    const repo = await makeRepository();
    t.after(() => rm(repo, { recursive: true, force: true }));
    await writeFile(join(repo, "tracked.ts"), "export const value = 1;\n");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "--quiet", "-m", "initial"]);

    await writeFile(
        join(repo, "tracked.ts"),
        `const apiKey = "${"k".repeat(24)}";\n`,
    );
    await git(repo, ["add", "tracked.ts"]);
    // Reverted on disk after staging: the index still holds the credential.
    await writeFile(join(repo, "tracked.ts"), "export const value = 1;\n");

    assert.deepEqual(await blockingStaged(repo), [
        "credential-assignment tracked.ts:1",
    ]);
    assert.deepEqual(
        await blockingTree(repo),
        [],
        "a working-tree scan is blind to this case, which is why the hook reads the index",
    );
});

test("counts a staged binary file instead of reading it", async (t) => {
    const repo = await makeRepository();
    t.after(() => rm(repo, { recursive: true, force: true }));
    await writeFile(
        join(repo, "bundle.bin"),
        Buffer.from([0x00, 0x01, 0x02, 0x03]),
    );
    await git(repo, ["add", "-A"]);

    const catalog = await collectStagedCandidates(repo);

    assert.deepEqual(catalog.skippedBinary, ["bundle.bin"]);
    assert.deepEqual(catalog.candidates, []);
});

test("the commit hook scans the index and is executable", async () => {
    const hookPath = join(repositoryRoot(), "scripts", "hooks", "pre-commit");
    const hook = await readFile(hookPath, "utf8");

    assert.match(hook, /--staged/u);
    assert.match(hook, /audit-secrets/u);
    assert.ok(
        ((await stat(hookPath)).mode & 0o111) !== 0,
        "Git only runs an executable hook, and the executable bit travels with the file",
    );

    const installer = await readFile(
        join(repositoryRoot(), "scripts", "install-hooks"),
        "utf8",
    );
    assert.match(
        installer,
        /core\.hooksPath scripts\/hooks/u,
        "the installer must point at the directory the hook actually lives in",
    );
});

async function blockingStaged(repo: string): Promise<readonly string[]> {
    return describeBlocking(await collectStagedCandidates(repo));
}

async function blockingTree(repo: string): Promise<readonly string[]> {
    return describeBlocking(await collectScanCandidates(repo));
}

function describeBlocking(catalog: SecretScanCatalog): readonly string[] {
    return scanSecrets(catalog.candidates, DEFAULT_RULES)
        .filter(
            (finding) =>
                finding.severity === "blocking" &&
                finding.scope === "committable",
        )
        .map(
            (finding) =>
                `${finding.rule} ${finding.filePath}:${String(finding.line)}`,
        );
}

async function makeRepository(): Promise<string> {
    const repo = await mkdtemp(join(tmpdir(), "secret-scan-repo-"));
    await git(repo, ["init", "--quiet"]);
    await git(repo, ["config", "user.name", "Scan Test"]);
    await git(repo, ["config", "user.email", "scan-test@example.test"]);
    return repo;
}

async function git(repo: string, args: readonly string[]): Promise<void> {
    await execFileAsync("git", ["-C", repo, ...args], { encoding: "utf8" });
}

function repositoryRoot(): string {
    return join(import.meta.dirname, "..", "..");
}

/**
 * Reviewed capability: initialize a fresh LedgerSMB company and its first
 * administrator, then prove the account can log in.
 *
 * It is reviewed TypeScript rather than generated output: each stage, detector,
 * and transition was decided by comparing repeated runs, and this file is the
 * durable record of that review. Stages form a straight line, each listening
 * for the one state that proves it completed.
 *
 * DESIGN NOTES
 * - Every stage declares `reversible` risk. With `riskyActionMode: "block"`,
 *   policy never stops this graph for a person, which keeps
 *   `replay:ledgersmb:initialize` a single unattended command.
 * - `authenticate` activates the Login button by role and accessible name, not
 *   by the CSS selector the recorder reported: discovery had resolved the role,
 *   and exact target resolution rejected the reported selector.
 * - The last stage dismisses the disposable-password expiry notice because the
 *   home screen only proves the account works once that interstitial is past.
 * - Values that are not the caller's business stay literals: the salutation,
 *   country, birth date, tax identifier, employee number, and administrator
 *   name are fixture constants the graph commits to, not invocation inputs.
 *
 * LIMITS
 * - No recoverable branches. Any other screen ends as `unexpected-screen`,
 *   which is honest for a flow that starts from an empty database.
 * - Login is part of this capability because proving the created account works
 *   is its success condition. Later capabilities should bootstrap
 *   authentication rather than repeat these stages.
 */

import type {
    CapabilityArtifact,
    CapabilityStage,
    StageDestination,
    StageTransition,
} from "../runtime/state-machine.js";
import type {
    DetectorSignal,
    StateDetector,
    SurfaceAction,
    TargetDescriptor,
} from "../surfaces/surface-driver.js";

export const ledgerSmbInitializeArtifact: CapabilityArtifact = {
    schemaVersion: "1",
    capabilityVersion: "0.1.0",
    id: "ledgersmb.initialize-company",
    title: "Initialize a fresh LedgerSMB company",
    targetProfile: "ledgersmb",
    contract: {
        goal: "Create a LedgerSMB company and its first administrator, then prove the account can authenticate.",
        inputs: {
            baseUrl: "string",
            databaseAdmin: "string",
            databasePassword: "string",
            company: "string",
            username: "string",
            password: "string",
        },
        outputs: {},
        successCondition:
            "The new administrator reaches the LedgerSMB home screen.",
    },
    entryStageId: "open-setup",
    stages: buildStages(),
    policy: {
        allowedOrigins: ["http://127.0.0.1:5762"],
        allowedActionTypes: ["navigate", "activate", "fill"],
        riskyActionMode: "block",
    },
    provenance: {
        discoveryRunId: "20260915162457450-f9c72fa6",
        createdAt: "2026-09-15T16:24:57.450Z",
        // The two 2026-09-15 validation replays predate declared-value
        // redaction and carry the fixture password in their ledgers, so they
        // stay local; this replay went through the current capture boundary.
        validatedRunIds: ["20260929120812777-6d5315d1"],
    },
};

function buildStages(): CapabilityStage[] {
    const specs: [string, string, SurfaceAction, DetectorSignal][] = [
        [
            "open-setup",
            "Open the setup console.",
            { type: "navigate", url: "{{input.baseUrl}}/setup.pl" },
            roleSignal("button", "Create"),
        ],
        [
            "fill-db-admin",
            "Enter the database administrator.",
            fill("#s-user", "{{input.databaseAdmin}}"),
            roleSignal("button", "Create"),
        ],
        [
            "fill-db-password",
            "Enter the database password.",
            fill("#s-password", "{{input.databasePassword}}"),
            roleSignal("button", "Create"),
        ],
        [
            "fill-company",
            "Enter the company database name.",
            fill("#database", "{{input.company}}"),
            roleSignal("button", "Create"),
        ],
        [
            "create-company",
            "Create the company database.",
            activate(roleTarget("button", "Create")),
            roleSignal("option", "Argentina"),
        ],
        [
            "open-country-list",
            "Open the chart country list.",
            activate(roleTarget("option", "Argentina")),
            roleSignal("option", "United States"),
        ],
        [
            "choose-chart-country",
            "Choose the United States chart family.",
            activate(roleTarget("option", "United States")),
            roleSignal("button", "Next"),
        ],
        [
            "confirm-chart-country",
            "Continue from the chart country selection.",
            activate(roleTarget("button", "Next")),
            textSignal("The selected country ('us') has"),
        ],
        [
            "confirm-chart",
            "Accept the General chart of accounts.",
            activate(roleTarget("button", "Next")),
            roleSignal("button", "Load Templates"),
        ],
        [
            "load-templates",
            "Load the demo templates.",
            activate(roleTarget("button", "Load Templates")),
            textSignal("Create new user"),
        ],
        [
            "fill-username",
            "Enter the initial username.",
            fill("#username", "{{input.username}}"),
            textSignal("Create new user"),
        ],
        [
            "fill-user-password",
            "Enter the initial user password.",
            fill("#password", "{{input.password}}"),
            textSignal("Create new user"),
        ],
        [
            "fill-first-name",
            "Enter the administrator first name.",
            fill("#first-name", "Fixture"),
            textSignal("Create new user"),
        ],
        [
            "fill-last-name",
            "Enter the administrator last name.",
            fill("#last-name", "Administrator"),
            textSignal("Create new user"),
        ],
        [
            "fill-employee-number",
            "Enter the administrator employee number.",
            fill("#employeenumber", "EMP-001"),
            textSignal("Create new user"),
        ],
        [
            "fill-birth-date",
            "Enter the synthetic birth date.",
            fill("#dob", "1980-01-01"),
            textSignal("Create new user"),
        ],
        [
            "fill-tax-id",
            "Enter the synthetic tax identifier.",
            fill("#ssn", "000-00-0000"),
            textSignal("Create new user"),
        ],
        [
            "open-salutation",
            "Open the salutation list.",
            activate(roleTarget("listbox", "Salutation")),
            roleSignal("option", "Mr."),
        ],
        [
            "choose-salutation",
            "Choose the salutation.",
            activate(roleTarget("option", "Mr.")),
            roleSignal("listbox", "Salutation"),
        ],
        [
            "open-country",
            "Open the administrator country list.",
            activate(roleTarget("listbox", "Country")),
            roleSignal("option", "United States"),
        ],
        [
            "choose-country",
            "Choose the administrator country.",
            activate(roleTarget("option", "United States")),
            roleSignal("listbox", "Country"),
        ],
        [
            "open-permissions",
            "Open the permission profile list.",
            activate(roleTarget("listbox", "Assign Permissions")),
            roleSignal("option", "Full Permissions"),
        ],
        [
            "choose-permissions",
            "Choose full fixture permissions.",
            activate(roleTarget("option", "Full Permissions")),
            roleSignal("button", "Create User"),
        ],
        [
            "create-user",
            "Create the first administrator.",
            activate(roleTarget("button", "Create User")),
            textSignal("Database Operation Complete"),
        ],
        [
            "open-login",
            "Open the LedgerSMB login page.",
            { type: "navigate", url: "{{input.baseUrl}}/login.pl" },
            roleSignal("button", "Login"),
        ],
        [
            "fill-login-user",
            "Enter the administrator username for verification.",
            fill("#username", "{{input.username}}"),
            roleSignal("button", "Login"),
        ],
        [
            "fill-login-password",
            "Enter the administrator password for verification.",
            fill("#password", "{{input.password}}"),
            roleSignal("button", "Login"),
        ],
        [
            "fill-login-company",
            "Enter the initialized company for verification.",
            fill("#company", "{{input.company}}"),
            roleSignal("button", "Login"),
        ],
        [
            "authenticate",
            "Authenticate the new administrator.",
            activate(roleTarget("button", "Login")),
            roleSignal("button", "OK"),
        ],
        [
            "dismiss-expiry",
            "Dismiss the disposable-password expiry notice.",
            activate(roleTarget("button", "OK")),
            textSignal("Welcome to LedgerSMB"),
        ],
    ];

    return specs.map(([id, description, action, signal], index) => {
        const detector = completionDetector(id, signal);
        const next = specs[index + 1];
        return {
            id,
            description,
            risk: "reversible",
            action,
            detectors: [detector],
            transitions: [
                transition(
                    detector.id,
                    next === undefined ? success() : stage(next[0]),
                ),
            ],
            otherwise: failure("unexpected-screen"),
            extractions: [],
        };
    });
}

function fill(selector: string, value: string): SurfaceAction {
    return { type: "fill", target: cssTarget(selector), value };
}

function activate(target: TargetDescriptor): SurfaceAction {
    return { type: "activate", target };
}

function roleTarget(role: string, name: string): TargetDescriptor {
    return {
        candidates: [{ kind: "role", role, name }],
        require: "exactly-one",
    };
}

function cssTarget(selector: string): TargetDescriptor {
    return { candidates: [{ kind: "css", selector }], require: "exactly-one" };
}

function roleSignal(role: string, name: string): DetectorSignal {
    return { kind: "role", role, name };
}

function textSignal(value: string): DetectorSignal {
    return { kind: "text", value, exact: false };
}

/** The detector that proves `stageId` reached its expected state. */
function completionDetector(
    stageId: string,
    signal: DetectorSignal,
): StateDetector {
    return {
        id: `${stageId}-complete`,
        description: `Expected state after ${stageId}`,
        scope: "capability",
        signals: [signal],
    };
}

function transition(
    detectorId: string,
    destination: StageDestination,
): StageTransition {
    return { detectorId, destination };
}

function stage(stageId: string): StageDestination {
    return { type: "stage", stageId };
}

function success(): StageDestination {
    return { type: "terminal", outcome: { type: "success" } };
}

function failure(code: string): StageDestination {
    return { type: "terminal", outcome: { type: "failure", code } };
}

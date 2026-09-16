/**
 * Reviewed capability: initialize a fresh LedgerSMB company and its first
 * administrator.
 *
 * This is the phase-zero artifact, and it is the one that establishes the shape
 * every later capability copies. It is reviewed TypeScript rather than generated
 * output: each stage, detector, and transition here was decided by comparing
 * repeated runs, and the file is the durable record of that review.
 *
 * It is a state graph, not a recording. `provenance` names the discovery run and
 * the two successful replays that validated it. The `authenticate` stage activates
 * by role and accessible name because an earlier draft carried the CSS selector
 * that the recorder *reported* instead of the role the discovery code had actually
 * used, and exact target resolution rejected it. The lesson is recorded in the
 * file rather than in a comment about CSS being bad.
 *
 * DESIGN NOTES
 * - Every stage declares `reversible` risk. Combined with `riskyActionMode:
 *   "block"`, policy never stops this graph for a person, which is what makes
 *   `replay:ledgersmb:initialize` a single unattended command.
 * - The last stage dismisses the disposable-password expiry notice because the
 *   home screen only proves the account works once that interstitial is past.
 * - Authored values that are not the caller's business stay as literals: the
 *   salutation, country, birth date, tax identifier, employee number, and the
 *   administrator's first and last name are fixture constants the graph commits
 *   to, not invocation inputs.
 *
 * LIMITS
 * - This graph has no recoverable branches. Any screen other than the expected one
 *   ends as `unexpected-screen`, which is honest for a flow whose starting state is
 *   an empty database: there is no upstream data to be wrong.
 * - Login is part of this capability because proving the created account works is
 *   its success condition. Later capabilities should bootstrap authentication
 *   rather than repeat this stage.
 */

import type {
    CapabilityArtifact,
    CapabilityStage,
    StageDestination,
} from "../runtime/state-machine.js";
import type {
    DetectorSignal,
    StateDetector,
    SurfaceAction,
    TargetDescriptor,
} from "../surfaces/surface-driver.js";

const RUN_ID = "20260915162457450-f9c72fa6";

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
        discoveryRunId: RUN_ID,
        createdAt: "2026-09-15T16:24:57.450Z",
        validatedRunIds: [
            "20260915170358856-fe344f46",
            "20260915170434612-2d03545d",
        ],
    },
};

function buildStages(): CapabilityStage[] {
    const specs: [string, string, SurfaceAction, DetectorSignal][] = [
        [
            "open-setup",
            "Open the setup console.",
            { type: "navigate", url: "{{input.baseUrl}}/setup.pl" },
            role("button", "Create"),
        ],
        [
            "fill-db-admin",
            "Enter the database administrator.",
            fill("#s-user", "{{input.databaseAdmin}}"),
            role("button", "Create"),
        ],
        [
            "fill-db-password",
            "Enter the database password.",
            fill("#s-password", "{{input.databasePassword}}"),
            role("button", "Create"),
        ],
        [
            "fill-company",
            "Enter the company database name.",
            fill("#database", "{{input.company}}"),
            role("button", "Create"),
        ],
        [
            "create-company",
            "Create the company database.",
            activate(roleTarget("button", "Create")),
            role("option", "Argentina"),
        ],
        [
            "open-country-list",
            "Open the chart country list.",
            activate(roleTarget("option", "Argentina")),
            role("option", "United States"),
        ],
        [
            "choose-chart-country",
            "Choose the United States chart family.",
            activate(roleTarget("option", "United States")),
            role("button", "Next"),
        ],
        [
            "confirm-chart-country",
            "Continue from the chart country selection.",
            activate(roleTarget("button", "Next")),
            text("The selected country ('us') has"),
        ],
        [
            "confirm-chart",
            "Accept the General chart of accounts.",
            activate(roleTarget("button", "Next")),
            role("button", "Load Templates"),
        ],
        [
            "load-templates",
            "Load the demo templates.",
            activate(roleTarget("button", "Load Templates")),
            text("Create new user"),
        ],
        [
            "fill-username",
            "Enter the initial username.",
            fill("#username", "{{input.username}}"),
            text("Create new user"),
        ],
        [
            "fill-user-password",
            "Enter the initial user password.",
            fill("#password", "{{input.password}}"),
            text("Create new user"),
        ],
        [
            "fill-first-name",
            "Enter the administrator first name.",
            fill("#first-name", "Fixture"),
            text("Create new user"),
        ],
        [
            "fill-last-name",
            "Enter the administrator last name.",
            fill("#last-name", "Administrator"),
            text("Create new user"),
        ],
        [
            "fill-employee-number",
            "Enter the administrator employee number.",
            fill("#employeenumber", "EMP-001"),
            text("Create new user"),
        ],
        [
            "fill-birth-date",
            "Enter the synthetic birth date.",
            fill("#dob", "1980-01-01"),
            text("Create new user"),
        ],
        [
            "fill-tax-id",
            "Enter the synthetic tax identifier.",
            fill("#ssn", "000-00-0000"),
            text("Create new user"),
        ],
        [
            "open-salutation",
            "Open the salutation list.",
            activate(roleTarget("listbox", "Salutation")),
            role("option", "Mr."),
        ],
        [
            "choose-salutation",
            "Choose the salutation.",
            activate(roleTarget("option", "Mr.")),
            role("listbox", "Salutation"),
        ],
        [
            "open-country",
            "Open the administrator country list.",
            activate(roleTarget("listbox", "Country")),
            role("option", "United States"),
        ],
        [
            "choose-country",
            "Choose the administrator country.",
            activate(roleTarget("option", "United States")),
            role("listbox", "Country"),
        ],
        [
            "open-permissions",
            "Open the permission profile list.",
            activate(roleTarget("listbox", "Assign Permissions")),
            role("option", "Full Permissions"),
        ],
        [
            "choose-permissions",
            "Choose full fixture permissions.",
            activate(roleTarget("option", "Full Permissions")),
            role("button", "Create User"),
        ],
        [
            "create-user",
            "Create the first administrator.",
            activate(roleTarget("button", "Create User")),
            text("Database Operation Complete"),
        ],
        [
            "open-login",
            "Open the LedgerSMB login page.",
            { type: "navigate", url: "{{input.baseUrl}}/login.pl" },
            role("button", "Login"),
        ],
        [
            "fill-login-user",
            "Enter the administrator username for verification.",
            fill("#username", "{{input.username}}"),
            role("button", "Login"),
        ],
        [
            "fill-login-password",
            "Enter the administrator password for verification.",
            fill("#password", "{{input.password}}"),
            role("button", "Login"),
        ],
        [
            "fill-login-company",
            "Enter the initialized company for verification.",
            fill("#company", "{{input.company}}"),
            role("button", "Login"),
        ],
        [
            "authenticate",
            "Authenticate the new administrator.",
            activate(roleTarget("button", "Login")),
            role("button", "OK"),
        ],
        [
            "dismiss-expiry",
            "Dismiss the disposable-password expiry notice.",
            activate(roleTarget("button", "OK")),
            text("Welcome to LedgerSMB"),
        ],
    ];

    return specs.map(([id, description, action, signal], index) => {
        const detector = detectorFor(id, signal);
        const destination: StageDestination =
            index === specs.length - 1
                ? { type: "terminal", outcome: { type: "success" } }
                : {
                      type: "stage",
                      stageId: specs[index + 1]?.[0] ?? "missing-stage",
                  };
        return {
            id,
            description,
            risk: "reversible",
            action,
            detectors: [detector],
            transitions: [{ detectorId: detector.id, destination }],
            otherwise: {
                type: "terminal",
                outcome: { type: "failure", code: "unexpected-screen" },
            },
            extractions: [],
        };
    });
}

function detectorFor(stageId: string, signal: DetectorSignal): StateDetector {
    return {
        id: `${stageId}-complete`,
        description: `Expected state after ${stageId}`,
        scope: "capability",
        signals: [signal],
    };
}

function fill(selector: string, value: string): SurfaceAction {
    return { type: "fill", target: cssTarget(selector), value };
}

function activate(target: TargetDescriptor): SurfaceAction {
    return { type: "activate", target };
}

function cssTarget(selector: string): TargetDescriptor {
    return { candidates: [{ kind: "css", selector }], require: "exactly-one" };
}

function roleTarget(roleName: string, name: string): TargetDescriptor {
    return {
        candidates: [{ kind: "role", role: roleName, name }],
        require: "exactly-one",
    };
}

function role(roleName: string, name: string): DetectorSignal {
    return { kind: "role", role: roleName, name };
}

function text(value: string): DetectorSignal {
    return { kind: "text", value, exact: false };
}

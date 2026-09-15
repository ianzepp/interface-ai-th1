import type {
    CapabilityArtifact,
    CapabilityStage,
} from "../runtime/state-machine.js";
import { dolibarrAuthenticationRequired } from "../targets/dolibarr/detectors.js";
import type {
    StateDetector,
    TargetDescriptor,
} from "../surfaces/surface-driver.js";

const nameTarget: TargetDescriptor = {
    candidates: [{ kind: "text", text: "{{input.name}}", exact: true }],
    require: "exactly-one",
};
const searchInput: TargetDescriptor = {
    candidates: [{ kind: "css", selector: 'input[name="search_nom"]' }],
    require: "exactly-one",
};
const searchButton: TargetDescriptor = {
    candidates: [{ kind: "css", selector: 'button[name="button_search_x"]' }],
    require: "exactly-one",
};

const searchReady = countDetector(
    "dolibarr-third-party-search-ready",
    searchInput,
    "equal",
    1,
);
const submitReady = countDetector(
    "dolibarr-third-party-submit-ready",
    searchButton,
    "equal",
    1,
);
const uniqueMatch = countDetector(
    "dolibarr-third-party-unique-match",
    nameTarget,
    "equal",
    1,
);
const ambiguousMatch = countDetector(
    "dolibarr-third-party-ambiguous-match",
    nameTarget,
    "greater-than",
    1,
);
const noMatch: StateDetector = {
    id: "dolibarr-third-party-no-match",
    description: "Dolibarr reported that the filtered list has no records.",
    scope: "capability",
    signals: [{ kind: "text", value: "No record found", exact: true }],
};
const profileVisible: StateDetector = {
    id: "dolibarr-third-party-profile-visible",
    description: "The selected third-party card is visible.",
    scope: "capability",
    signals: [{ kind: "url", pattern: "/societe/card\\.php" }],
};

export const dolibarrThirdPartyLookupArtifact: CapabilityArtifact = {
    schemaVersion: "1",
    capabilityVersion: "0.1.0",
    id: "dolibarr.lookup-third-party",
    title: "Look up a Dolibarr third party by exact name",
    targetProfile: "dolibarr-23.0.4",
    contract: {
        goal: "Look up a Dolibarr third party by exact name and return its account profile.",
        inputs: { baseUrl: "string", name: "string" },
        outputs: {
            name: "string",
            customerCode: "string",
            vendorCode: "string",
            currency: "string",
            status: "string",
            nature: "string",
        },
        successCondition:
            "Exactly one matching third party is opened and its visible account fields are returned.",
    },
    entryStageId: "open-list",
    stages: buildStages(),
    policy: {
        allowedOrigins: ["http://127.0.0.1:8080"],
        allowedActionTypes: ["navigate", "fill", "activate"],
        riskyActionMode: "block",
    },
    provenance: {
        discoveryRunId: "20260915201727769-f02bcb33",
        createdAt: "2026-09-15T20:17:27.769Z",
        evidenceRunIds: [
            "20260915201727769-f02bcb33",
            "20260915201943054-c67afa9b",
            "20260915202031432-6995a2e8",
            "20260915202113470-97cf9873",
            "20260915202202470-9abd1d52",
            "20260915202607595-f1eee304",
        ],
        validatedRunIds: [
            "20260915202650455-004445ba",
            "20260915202710527-48b0cf0c",
            "20260915202725488-7b93abd6",
            "20260915202742493-769ba7f6",
            "20260915202758596-ed9759b5",
        ],
    },
};

function buildStages(): CapabilityStage[] {
    return [
        {
            id: "open-list",
            description: "Open the protected third-party list.",
            risk: "safe",
            action: {
                type: "navigate",
                url: "{{input.baseUrl}}/societe/list.php?mainmenu=companies",
            },
            detectors: [dolibarrAuthenticationRequired, searchReady],
            transitions: [
                transition(
                    dolibarrAuthenticationRequired.id,
                    intervention("authentication-required"),
                ),
                transition(searchReady.id, stage("fill-name")),
            ],
            otherwise: failure("unexpected-list-state"),
            extractions: [],
        },
        {
            id: "fill-name",
            description: "Enter the caller-provided exact third-party name.",
            risk: "safe",
            action: {
                type: "fill",
                target: searchInput,
                value: "{{input.name}}",
            },
            detectors: [submitReady],
            transitions: [transition(submitReady.id, stage("submit-search"))],
            otherwise: failure("search-form-unavailable"),
            extractions: [],
        },
        {
            id: "submit-search",
            description:
                "Submit the name filter and classify the result cardinality.",
            risk: "safe",
            action: { type: "activate", target: searchButton },
            detectors: [
                dolibarrAuthenticationRequired,
                noMatch,
                ambiguousMatch,
                uniqueMatch,
            ],
            transitions: [
                transition(
                    dolibarrAuthenticationRequired.id,
                    intervention("authentication-required"),
                ),
                transition(noMatch.id, business("third-party-not-found")),
                transition(
                    ambiguousMatch.id,
                    business("third-party-ambiguous"),
                ),
                transition(uniqueMatch.id, stage("open-result")),
            ],
            otherwise: failure("unrecognized-search-result"),
            extractions: [],
        },
        {
            id: "open-result",
            description:
                "Open the sole exact-name result and return its account profile.",
            risk: "safe",
            action: { type: "activate", target: nameTarget },
            detectors: [dolibarrAuthenticationRequired, profileVisible],
            transitions: [
                transition(
                    dolibarrAuthenticationRequired.id,
                    intervention("authentication-required"),
                ),
                transition(profileVisible.id, stage("extract-profile")),
            ],
            otherwise: failure("unexpected-profile-state"),
            extractions: [],
        },
        {
            id: "extract-profile",
            description:
                "Extract the requested fields from the recognized profile card.",
            risk: "safe",
            detectors: [profileVisible],
            transitions: [
                transition(profileVisible.id, {
                    type: "terminal",
                    outcome: { type: "success" },
                }),
            ],
            otherwise: failure("profile-no-longer-visible"),
            extractions: [
                extraction("name", "div.refid > span.valignmiddle"),
                extraction(
                    "customerCode",
                    'tr:has(> td:text-is("Customer Code")) > td:nth-child(2) .clipboardCPValue',
                ),
                extraction(
                    "vendorCode",
                    'tr:has(> td:text-is("Vendor Code")) > td:nth-child(2) .clipboardCPValue',
                ),
                extraction(
                    "currency",
                    'tr:has(> td:text-is("Currency")) > td:nth-child(2)',
                ),
                extraction("status", "div.statusref .badge-status4"),
                extraction(
                    "nature",
                    'tr:has(> td:text-is("Nature of Third party")) > td:nth-child(2)',
                ),
            ],
        },
    ];
}

function countDetector(
    id: string,
    target: TargetDescriptor,
    operator: "equal" | "greater-than",
    value: number,
): StateDetector {
    return {
        id,
        description: `${id} observed by target cardinality.`,
        scope: "capability",
        signals: [{ kind: "count", target, operator, value }],
    };
}

function extraction(name: string, selector: string) {
    return {
        name,
        type: "string" as const,
        target: {
            candidates: [{ kind: "css" as const, selector }],
            require: "exactly-one" as const,
        },
    };
}

function transition(
    detectorId: string,
    destination: CapabilityStage["otherwise"],
) {
    return { detectorId, destination };
}

function stage(stageId: string): CapabilityStage["otherwise"] {
    return { type: "stage", stageId };
}

function business(code: string): CapabilityStage["otherwise"] {
    return { type: "terminal", outcome: { type: "business-outcome", code } };
}

function intervention(code: string): CapabilityStage["otherwise"] {
    return {
        type: "terminal",
        outcome: { type: "intervention-required", code },
    };
}

function failure(code: string): CapabilityStage["otherwise"] {
    return { type: "terminal", outcome: { type: "failure", code } };
}

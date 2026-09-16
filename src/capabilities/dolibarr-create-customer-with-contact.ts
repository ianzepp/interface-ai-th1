/**
 * Reviewed capability: create a Dolibarr customer and one linked contact.
 *
 * The two discovery captures agreed on the nine-stage happy path below. The
 * first capture also contained exploratory detours while identifying the real
 * submit control; those detours are deliberately excluded from the artifact.
 * No exception or recovery branch was captured under this lane's two-run cap,
 * so every unrecognized state fails closed.
 *
 * The contact form accepts a third-party database ID rather than a name. The
 * current runtime has no dynamic URL-to-input binding, so `thirdPartyId` is a
 * typed invocation input. The reset fixture proved the value `63`; a caller
 * using another fixture must supply that fixture's party ID.
 */

import type {
    CapabilityArtifact,
    CapabilityStage,
} from "../runtime/state-machine.js";
import type {
    StateDetector,
    TargetDescriptor,
} from "../surfaces/surface-driver.js";

const newCustomerLink = roleTarget("link", "New Customer");
const newContactLink = roleTarget("link", "New Contact/Address");
const customerNameInput = cssTarget('input[name="name"]');
const createSubmit = cssTarget('input[type="submit"]:first-of-type');
const thirdPartySelect = cssTarget('select[name="socid"]');
const lastNameInput = cssTarget('input[name="lastname"]');
const firstNameInput = cssTarget('input[name="firstname"]');

const thirdPartyAreaReady = urlDetector(
    "dolibarr-create-party-area-ready",
    "Third-party area is open and authenticated.",
    "/societe/index\\.php\\?mainmenu=companies",
);
const customerFormReady = urlDetector(
    "dolibarr-create-customer-form-ready",
    "The customer third-party creation form is visible.",
    "/societe/card\\.php\\?leftmenu=customers&action=create&type=c",
);
const customerCardReady = urlDetector(
    "dolibarr-created-customer-card-ready",
    "Dolibarr opened the newly created customer card.",
    "/societe/card\\.php\\?id=[^&]+&socid=\\d+",
);
const contactFormReady = urlDetector(
    "dolibarr-create-contact-form-ready",
    "The contact creation form is visible.",
    "/contact/card\\.php\\?leftmenu=contacts&action=create",
);
const contactCardReady = urlDetector(
    "dolibarr-created-contact-card-ready",
    "Dolibarr opened the newly created contact card.",
    "/contact/card\\.php\\?id=\\d+",
);

export const dolibarrCreateCustomerWithContactArtifact: CapabilityArtifact = {
    schemaVersion: "1",
    capabilityVersion: "0.1.0",
    id: "dolibarr.create-customer-with-contact",
    title: "Create a Dolibarr customer and linked contact",
    targetProfile: "dolibarr",
    contract: {
        goal: "Create a new customer third-party record and add one contact linked to it.",
        inputs: {
            baseUrl: "string",
            thirdPartyName: "string",
            thirdPartyId: "string",
            contactFirstName: "string",
            contactLastName: "string",
        },
        outputs: {
            thirdPartyName: "string",
            contactName: "string",
        },
        successCondition:
            "The created contact card visibly names the requested contact and links it to the requested customer.",
    },
    entryStageId: "open-third-party-area",
    stages: buildStages(),
    policy: {
        allowedOrigins: ["http://127.0.0.1:8126"],
        allowedActionTypes: ["navigate", "activate", "fill", "select"],
        riskyActionMode: "block",
    },
    provenance: {
        discoveryRunId: "20260915214829952-cc922cc2",
        createdAt: "2026-09-15T21:54:00.000Z",
        evidenceRunIds: [
            "20260915214829952-cc922cc2",
            "20260915215250640-fea3b05a",
        ],
        validatedRunIds: ["20260915215946224-05d43891"],
    },
};

function buildStages(): CapabilityStage[] {
    return [
        {
            id: "open-third-party-area",
            description: "Open the authenticated Dolibarr third-party area.",
            risk: "safe",
            action: {
                type: "navigate",
                url: "{{input.baseUrl}}/societe/index.php?mainmenu=companies&leftmenu=",
            },
            detectors: [thirdPartyAreaReady],
            transitions: [
                transition(thirdPartyAreaReady.id, stage("open-customer-form")),
            ],
            otherwise: failure("third-party-area-unavailable"),
            extractions: [],
        },
        {
            id: "open-customer-form",
            description: "Open the customer-specific third-party form.",
            risk: "safe",
            action: { type: "activate", target: newCustomerLink },
            detectors: [customerFormReady],
            transitions: [
                transition(customerFormReady.id, stage("fill-customer-name")),
            ],
            otherwise: failure("customer-form-unavailable"),
            extractions: [],
        },
        {
            id: "fill-customer-name",
            description: "Enter the caller-provided customer name.",
            risk: "safe",
            action: {
                type: "fill",
                target: customerNameInput,
                value: "{{input.thirdPartyName}}",
            },
            detectors: [customerFormReady],
            transitions: [
                transition(customerFormReady.id, stage("create-customer")),
            ],
            otherwise: failure("customer-form-left-before-name-entry"),
            extractions: [],
        },
        {
            id: "create-customer",
            description:
                "Submit the customer form through the reviewed first submit control.",
            risk: "reversible",
            action: { type: "activate", target: createSubmit },
            detectors: [customerCardReady],
            transitions: [
                transition(customerCardReady.id, stage("open-contact-form")),
            ],
            otherwise: failure("customer-creation-not-confirmed"),
            extractions: [],
        },
        {
            id: "open-contact-form",
            description: "Open a new contact from the created customer card.",
            risk: "safe",
            action: { type: "activate", target: newContactLink },
            detectors: [contactFormReady],
            transitions: [
                transition(contactFormReady.id, stage("select-created-party")),
            ],
            otherwise: failure("contact-form-unavailable"),
            extractions: [],
        },
        {
            id: "select-created-party",
            description: "Link the contact to the caller-provided party ID.",
            risk: "safe",
            action: {
                type: "select",
                target: thirdPartySelect,
                value: "{{input.thirdPartyId}}",
            },
            detectors: [contactFormReady],
            transitions: [
                transition(
                    contactFormReady.id,
                    stage("fill-contact-last-name"),
                ),
            ],
            otherwise: failure("created-party-not-selectable"),
            extractions: [],
        },
        {
            id: "fill-contact-last-name",
            description: "Enter the caller-provided contact family name.",
            risk: "safe",
            action: {
                type: "fill",
                target: lastNameInput,
                value: "{{input.contactLastName}}",
            },
            detectors: [contactFormReady],
            transitions: [
                transition(
                    contactFormReady.id,
                    stage("fill-contact-first-name"),
                ),
            ],
            otherwise: failure("contact-last-name-field-unavailable"),
            extractions: [],
        },
        {
            id: "fill-contact-first-name",
            description: "Enter the caller-provided contact given name.",
            risk: "safe",
            action: {
                type: "fill",
                target: firstNameInput,
                value: "{{input.contactFirstName}}",
            },
            detectors: [contactFormReady],
            transitions: [
                transition(contactFormReady.id, stage("create-contact")),
            ],
            otherwise: failure("contact-first-name-field-unavailable"),
            extractions: [],
        },
        {
            id: "create-contact",
            description:
                "Submit the contact form and verify the linked contact card.",
            risk: "reversible",
            action: { type: "activate", target: createSubmit },
            detectors: [contactCardReady],
            transitions: [
                transition(contactCardReady.id, {
                    type: "terminal",
                    outcome: { type: "success" },
                }),
            ],
            otherwise: failure("contact-creation-not-confirmed"),
            extractions: [
                extraction("contactName", "div.refid > span.valignmiddle"),
                extraction("thirdPartyName", "div.refidno a.refurl"),
            ],
        },
    ];
}

function roleTarget(role: string, name: string): TargetDescriptor {
    return {
        candidates: [{ kind: "role", role, name }],
        require: "exactly-one",
    };
}

function cssTarget(selector: string): TargetDescriptor {
    return {
        candidates: [{ kind: "css", selector }],
        require: "exactly-one",
    };
}

function urlDetector(
    id: string,
    description: string,
    pattern: string,
): StateDetector {
    return {
        id,
        description,
        scope: "capability",
        signals: [{ kind: "url", pattern }],
    };
}

function extraction(name: string, selector: string) {
    return {
        name,
        type: "string" as const,
        target: cssTarget(selector),
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

function failure(code: string): CapabilityStage["otherwise"] {
    return { type: "terminal", outcome: { type: "failure", code } };
}

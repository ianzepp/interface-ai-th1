import type { StateDetector } from "../../surfaces/surface-driver.js";

export const dolibarrAuthenticationRequired: StateDetector = {
    id: "dolibarr-authentication-required",
    description:
        "Dolibarr redirected the protected operation to its login page.",
    scope: "target",
    signals: [{ kind: "text", value: "Password forgotten?", exact: true }],
};

export const dolibarrDetectors: readonly StateDetector[] = [
    dolibarrAuthenticationRequired,
];

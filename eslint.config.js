import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["dist/", "node_modules/", "tmp/", "evidence/"],
    },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // TypeScript exempts `_`-prefixed parameters from noUnusedParameters.
            // Keep the linter aligned with the compiler rather than flagging
            // contract-signature parameters that a stub does not yet consume.
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    args: "all",
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                    destructuredArrayIgnorePattern: "^_",
                    ignoreRestSiblings: true,
                },
            ],
            // node:test owns the promise returned by test(). Ignoring that specific
            // call is the documented usage; every other floating promise still fails.
            "@typescript-eslint/no-floating-promises": [
                "error",
                {
                    allowForKnownSafeCalls: [
                        { from: "package", name: "test", package: "node:test" },
                    ],
                },
            ],
        },
    },
    {
        // Plain JS (this config file) is outside the TypeScript project, so it gets
        // no type-aware linting. parserOptions must be restated here because it
        // replaces the type-aware block above rather than merging with it.
        files: ["**/*.{js,mjs,cjs}"],
        languageOptions: {
            globals: globals.node,
            parserOptions: {
                projectService: false,
                project: false,
                program: null,
            },
        },
        rules: { ...tseslint.configs.disableTypeChecked.rules },
    },
    prettier,
);

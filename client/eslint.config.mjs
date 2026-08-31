import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // React Compiler ships strict rules in Next.js 16. The patterns flagged
    // below are common-and-correct in this codebase (hydration setState,
    // local tooltip components, manual memo deps that intentionally narrow).
    // We keep them as warnings so they remain visible for incremental
    // cleanup without gating CI.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/static-components": "warn",
      "no-unreachable": "error",
    },
  },
]);

export default eslintConfig;

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Issue #801: i128 stroop amounts must never go through JS double math.
  // `formatStroops` / `formatStroopsForDisplay` in @/lib/validation are the
  // only sanctioned stroop -> display conversion. `amountFormatting.test.ts`
  // enforces the same ban in CI as a backstop.
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "BinaryExpression[operator='/'] > Literal[value=10000000]",
          message:
            "Do not divide chain amounts by 1e7 — double math loses precision on i128 stroop values. Use formatStroops/formatStroopsForDisplay from @/lib/validation.",
        },
        {
          selector: "BinaryExpression[operator='/'][right.raw=/^1[eE]7$/]",
          message:
            "Do not divide chain amounts by 1e7 — use formatStroops/formatStroopsForDisplay from @/lib/validation.",
        },
      ],
    },
  },
  {
    files: ["src/lib/validation.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
]);

export default eslintConfig;

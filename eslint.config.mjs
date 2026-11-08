import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // These pages commit the result of an asynchronous initial data fetch.
    files: ["src/app/payments/page.tsx", "src/app/proposals/page.tsx"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "build-check*/**",
    "node_modules/**",
    "next-env.d.ts",
  ]),
]);

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "storage/**",
    "test-results/**",
    "playwright-report/**",
    "bridge/**",
    ".claude/**",
    "drizzle/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

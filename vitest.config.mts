import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://kbm:kbm@localhost:5432/kbm_notebook_test";

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  "server-only": path.resolve(import.meta.dirname, "scripts/server-only-stub.ts"),
};

const testEnv = {
  DATABASE_URL: TEST_DB_URL,
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
  BETTER_AUTH_URL: "http://localhost:3000",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  APP_ENCRYPTION_KEY: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  AI_PROVIDER: "mock",
  GEMINI_API_KEY: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  STORAGE_DIR: path.resolve(import.meta.dirname, "storage/.test"),
  MAX_UPLOAD_MB: "1",
  // Bridge giả trong test chạy ở localhost
  CONNECTORS_ALLOW_PRIVATE_HOSTS: "true",
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "tests/api/**/*.test.ts"],
          globalSetup: ["tests/setup/global-setup.ts"],
          env: testEnv,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: "components",
          environment: "jsdom",
          include: ["tests/components/**/*.test.tsx"],
          setupFiles: ["tests/setup/components.ts"],
          env: testEnv,
        },
      },
    ],
  },
});

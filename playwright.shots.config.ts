import { defineConfig } from "@playwright/test";
import { browserChannel } from "./playwright.config";
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.shots.ts",
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: "http://localhost:8789",
    channel: browserChannel,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "pnpm build && pnpm exec wrangler d1 migrations apply mer-harness-dev --env development --local --persist-to .wrangler/shots && pnpm exec wrangler dev --env development --local --persist-to .wrangler/shots --port 8789 --var DEV_AUTH_BYPASS:1 --var AI_ENABLED:0",
    url: "http://localhost:8789/api/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
  reporter: "list",
});

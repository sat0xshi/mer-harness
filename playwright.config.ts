import { existsSync } from "node:fs";
import { chromium, defineConfig } from "@playwright/test";
export const browserChannel = existsSync(chromium.executablePath()) ? undefined : "chrome";
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.e2e.ts",
  workers: 1,
  use: {
    baseURL: "http://localhost:8788",
    channel: browserChannel,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "pnpm build && pnpm exec wrangler d1 migrations apply mer-harness-dev --env development --local --persist-to .wrangler/e2e && pnpm exec wrangler dev --env development --local --persist-to .wrangler/e2e --port 8788 --var DEV_AUTH_BYPASS:1 --var AI_ENABLED:0",
    url: "http://localhost:8788/api/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
  reporter: "list",
});

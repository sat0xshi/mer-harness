import { expect, test } from "@playwright/test";

test("Google login screen submits GIS credential and opens the app", async ({ page }) => {
  let authenticated = false;
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: { mode: "google", configured: true, clientId: "test-client", authenticated },
    }),
  );
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    let callback;
    window.google = {accounts: {id: {
      initialize(options) { callback = options.callback; },
      renderButton(element) {
        const button = document.createElement('button');
        button.textContent = 'Sign in with Google';
        button.onclick = () => callback({credential: 'mock-google-id-token'});
        element.appendChild(button);
      }
    }}};
  `,
    }),
  );
  await page.route("**/api/auth/google", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ credential: "mock-google-id-token" });
    authenticated = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ログイン", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "新しい出品", exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.locator(".level-card")).toBeVisible();
});

test("missing auth configuration shows no sign-in button or private data", async ({ page }) => {
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({ json: { mode: "google", configured: false, authenticated: false } }),
  );
  await page.goto("/");
  await expect(page.getByText("認証の設定が必要です。管理者に確認してください。")).toBeVisible();
  await expect(page.locator(".level-card")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).not.toBeVisible();
});

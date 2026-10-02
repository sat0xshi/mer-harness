import { expect, test } from "@playwright/test";

test("mobile listing with AI disabled, persistent data, copy and undo", async ({
  page,
  context,
}) => {
  await page.addLocatorHandler(page.getByRole("dialog", { name: "音も鳴らす？" }), async () => {
    await page.getByRole("button", { name: "今は鳴らさない" }).click();
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "面倒を、 ひと引きの推進力に。" })).toBeVisible();
  await page.screenshot({ path: "test-results/home-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "新しい出品", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles("apps/web/public/icon-512.png");
  await expect(page.getByRole("button", { name: "これでOK ✓" })).toBeEnabled();
  await page.getByRole("checkbox", { name: "背景を白くする（任意）" }).check();
  await page.getByRole("button", { name: "これでOK ✓" }).click();
  if (await page.getByRole("button", { name: "今は鳴らさない" }).isVisible())
    await page.getByRole("button", { name: "今は鳴らさない" }).click();
  await expect(page.getByText("1/10枚")).toBeVisible();
  if (await page.getByRole("button", { name: "今は鳴らさない" }).isVisible())
    await page.getByRole("button", { name: "今は鳴らさない" }).click();
  await page.getByRole("button", { name: "質問へ進む →" }).click();
  await page.getByRole("textbox", { name: "ブランドは？" }).fill("Google");
  await page.getByRole("button", { name: "この回答で次へ" }).click();
  await page.getByRole("textbox", { name: "品名・型番を教えてね" }).fill("Pixel 10 Pro Fold 512GB");
  await page.getByRole("button", { name: "この回答で次へ" }).click();
  await page.getByRole("radio", { name: "目立った傷や汚れなし", exact: true }).check();
  await page.getByRole("button", { name: "この回答で次へ" }).click();
  await page.screenshot({ path: "test-results/questions-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "今の内容で価格へ進む →" }).click();
  await page.getByRole("spinbutton", { name: "価格（円）", exact: true }).fill("195000");
  await page.getByRole("button", { name: "＋ 相場を追加" }).click();
  await page.getByRole("button", { name: /おすすめ.*中央値/ }).click();
  await expect(page.getByText("￥174,750")).toBeVisible();
  await page.getByRole("button", { name: "この価格に決める →" }).click();
  await page.getByRole("button", { name: "コピー", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "コピー済み ✓" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("Pixel 10 Pro Fold");
  await page.getByRole("button", { name: "出品できた！", exact: true }).click();
  await page.getByRole("tab", { name: /出品中/ }).click();
  await expect(
    page.getByRole("heading", { name: /Google Pixel 10 Pro Fold/ }).last(),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "積荷", exact: true }).click();
  await page.getByRole("tab", { name: /出品中/ }).click();
  const card = page.locator(".stock-card").filter({ hasText: "Google Pixel 10 Pro Fold" }).last();
  await card.getByRole("button", { name: "売れた！", exact: true }).click();
  await page.getByRole("spinbutton", { name: "販売価格（円）" }).fill("190000");
  await page.getByRole("button", { name: "売れた！", exact: true }).last().click();
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect
    .poll(async () => {
      const state = await (await page.request.get("/api/state")).json();
      return state.settings?.soundAsked;
    })
    .toBe(true);
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  // SW must never store authenticated data or photo BLOBs.
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys())
      for (const request of await (await caches.open(key)).keys()) urls.push(request.url);
    return urls;
  });
  expect(cached.every((url) => !url.includes("/api/"))).toBe(true);
});

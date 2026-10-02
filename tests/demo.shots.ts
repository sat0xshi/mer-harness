import { mkdir } from "node:fs/promises";
import { defaultPlatform, type Item } from "@mer/core";
import { expect, test } from "@playwright/test";
import { defaults } from "../apps/web/src/api";

const output = "/workspace/mercari-harness/shots";
test("nine mobile demo screenshots", async ({ page, request, baseURL }) => {
  await mkdir(output, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // A deterministic, browser-generated photo fixture; no external image service.
  await page.goto("/");
  await expect(page.locator(".level-card")).toBeVisible();
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 900;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.fillStyle = "#eeeae1";
    ctx.fillRect(0, 0, 900, 900);
    ctx.shadowColor = "#0004";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 20;
    ctx.fillStyle = "#262939";
    ctx.beginPath();
    ctx.roundRect(190, 140, 520, 610, 40);
    ctx.fill();
    ctx.shadowColor = "transparent";
    const gradient = ctx.createLinearGradient(220, 180, 650, 680);
    gradient.addColorStop(0, "#658a96");
    gradient.addColorStop(0.5, "#c2ddd6");
    gradient.addColorStop(1, "#5667a2");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(210, 160, 480, 570, 25);
    ctx.fill();
    ctx.fillStyle = "#ffffffaa";
    ctx.font = "36px sans-serif";
    ctx.fillText("Pixel Fold", 275, 440);
    ctx.strokeStyle = "#ffffff55";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(450, 175);
    ctx.lineTo(450, 715);
    ctx.stroke();
    return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
  });
  const photo = Buffer.from(data, "base64");
  async function api(path: string, method = "GET", body?: unknown) {
    const response = await request.fetch(`/api${path}`, {
      method,
      headers: { Origin: baseURL || "", "Idempotency-Key": crypto.randomUUID() },
      data: body,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await api("/settings", "PUT", {
    ...defaults,
    soundAsked: true,
    sound: false,
    haptics: false,
    zone: "Asia/Tokyo",
  });
  async function seed(
    id: string,
    category: Item["category"],
    answers: Item["answers"],
    price: number,
    status: Item["status"],
  ) {
    let item: Item = await api("/items", "POST", { id, category, platform: "mercari" });
    item = await api(`/items/${id}`, "PUT", {
      version: item.version,
      category,
      answers,
      price,
      shipping: defaultPlatform.defaultShipping,
      comps: [
        { price: 190000, sold: true },
        { price: 195000, sold: true },
        { price: 200000, sold: true },
      ],
      finish: true,
    });
    const response = await request.post(`/api/items/${id}/photos/${id}`, {
      headers: { Origin: baseURL || "", "Content-Type": "image/jpeg" },
      data: photo,
    });
    expect(response.ok()).toBe(true);
    if (item.status !== status)
      item = (await api(`/items/${id}/status`, "POST", { version: item.version, status })).item;
    return item;
  }
  const pixel = await seed(
    "00000000-0000-4000-8000-000000000001",
    "phone",
    {
      brand: "Google",
      model: "Pixel 10 Pro Fold",
      capacity: "512GB",
      color: "Moonstone",
      condition: defaultPlatform.conditionLabels[2],
      accessories: "箱・充電ケーブル",
      flaws: "目立つ傷なし",
    },
    195000,
    "listed",
  );
  await seed(
    "00000000-0000-4000-8000-000000000002",
    "gadget",
    {
      brand: "Microsoft",
      model: "HoloLens 2",
      condition: defaultPlatform.conditionLabels[2],
      operation: "起動・表示・追跡を確認",
    },
    120000,
    "draft",
  );
  await seed(
    "00000000-0000-4000-8000-000000000003",
    "clothing",
    {
      brand: "GORUCK",
      model: "T-shirt",
      size: "M",
      color: "ブラック",
      condition: defaultPlatform.conditionLabels[2],
    },
    4500,
    "shelf",
  );
  expect((await api("/state")).settings.soundAsked).toBe(true);
  await page.reload();
  await expect(page.locator(".level-card")).toBeVisible();
  const shot = async (name: string) => {
    if (name !== "08-celebration") {
      while (await page.locator(".celebration").count()) await page.locator(".celebration").click();
    }
    await expect(page.getByRole("dialog", { name: "音も鳴らす？" })).not.toBeVisible();
    await page.screenshot({ path: `${output}/${name}.png` });
  };
  await shot("01-home");
  await page.getByRole("button", { name: "積荷", exact: true }).click();
  const holo = page.locator(".stock-card").filter({ hasText: "HoloLens 2" });
  await holo.getByRole("button", { name: "つづける", exact: true }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "generated-photo.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByRole("button", { name: "これでOK ✓" })).toBeEnabled();
  await page.locator(".crop-editor").scrollIntoViewIfNeeded();
  await shot("02-crop");
  await page.getByRole("button", { name: "この写真をやめる" }).click();
  await page.getByRole("button", { name: "質問へ進む →" }).click();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "この回答で次へ" }).click();
  await page.getByRole("textbox", { name: "エディションは？" }).fill("HoloLens 2");
  await page.locator(".growing").scrollIntoViewIfNeeded();
  await shot("03-questions");
  await page.getByRole("button", { name: "今の内容で価格へ進む →" }).click();
  await page.getByRole("button", { name: /おすすめ.*中央値/ }).click();
  await page
    .locator(".price-ladder")
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await shot("04-price");
  await page.getByRole("button", { name: "この価格に決める →" }).click();
  await expect(page.getByRole("heading", { name: "あとは、貼り付けるだけ。" })).toBeVisible();
  await shot("05-copy");
  await page.getByRole("button", { name: "← 保存して戻る" }).click();
  await page.getByRole("tab", { name: /出品中/ }).click();
  await expect(page.locator(".stock-card").filter({ hasText: pixel.title })).toBeVisible();
  await shot("06-board");
  await page.getByRole("tab", { name: /売れ残り棚/ }).click();
  await expect(page.locator(".stock-card").filter({ hasText: "GORUCK" })).toBeVisible();
  await shot("07-shelf");
  await page.getByRole("tab", { name: /下書き/ }).click();
  await holo.getByRole("button", { name: "つづける", exact: true }).click();
  await page.locator(".steps button").nth(3).click();
  await page.getByRole("button", { name: "出品できた！", exact: true }).click();
  await expect(
    page.locator(".celebration").filter({ hasText: "ピコーン！ 出品スタート" }),
  ).toBeVisible();
  // Let the entry animation reach full opacity while confetti is still active.
  await page.waitForTimeout(300);
  await shot("08-celebration");
  // Dismiss the actual queued celebrations before the static achievements capture.
  while (await page.locator(".celebration").count()) await page.locator(".celebration").click();
  await page.getByRole("button", { name: "実績", exact: true }).click();
  await expect(page.locator(".achievement-hero")).toBeVisible();
  await shot("09-achievements");
  expect(errors).toEqual([]);
});

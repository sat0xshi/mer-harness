import { type Answers, charCount, defaultPlatform } from "@mer/core";
import { describe, expect, it } from "vitest";
import {
  buildGeminiRequest,
  claims,
  extractGeminiText,
  redactGemini,
  validateListingDraft,
} from "./gemini";

const context = { category: "gadget" as const, platform: "mercari" as const, answers: {} };
const draft = {
  category: " Electronics ",
  brand: " Google ",
  model: 9,
  color: ["黒"],
  flaws: "",
  title: "写真の商品",
  description: "写真に写っている黒い商品です。",
};
function validate(text: string, answers: Answers = {}, title = draft.title) {
  return validateListingDraft(
    { ...draft, title, description: `${draft.description}\n${text}` },
    { ...context, answers },
  );
}

describe("Gemini request and response", () => {
  it("builds structured JSON with LOW thinking, no credentials, and at most three chunk-encoded images", () => {
    const bytes = new Uint8Array(307200).map((_, i) => i % 256);
    const request = buildGeminiRequest(
      { ...context, answers: { color: "黒", empty: "  " } },
      Array(4).fill(bytes),
    );
    expect(request.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: { category: { enum: ["phone", "gadget", "clothing", "other"] } },
        required: expect.arrayContaining(["title", "description"]),
      },
      thinkingConfig: { thinkingLevel: "LOW" },
      temperature: 0.2,
      maxOutputTokens: 2048,
    });
    expect(request.contents[0].parts).toHaveLength(4);
    const part = request.contents[0].parts[1];
    expect("inline_data" in part && part.inline_data.data).toBe(
      Buffer.from(bytes).toString("base64"),
    );
    const body = JSON.stringify(request);
    expect(body).not.toMatch(/api[-_]?key|GEMINI_API_KEY/i);
    expect(body).not.toContain("empty");
  });
  it("concatenates text while excluding thought parts", () => {
    expect(
      extractGeminiText({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                { text: "secret", thought: true },
                { text: "a" },
                { text: "b", thought: false },
              ],
            },
          },
        ],
      }),
    ).toEqual({ ok: true, text: "ab", finishReason: "STOP" });
  });
  it.each([
    null,
    {},
    { candidates: [] },
    {
      candidates: [
        { finishReason: "STOP", content: { parts: [{ thought: true, text: "thought" }] } },
      ],
    },
    ...["MAX_TOKENS", "SAFETY", undefined].map((finishReason) => ({
      candidates: [{ finishReason, content: { parts: [{ text: "{}" }] } }],
    })),
    {
      promptFeedback: { blockReason: "SAFETY" },
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{}" }] } }],
    },
  ])("rejects incomplete or blocked responses %j", (response) => {
    expect(extractGeminiText(response).ok).toBe(false);
  });
  it("redacts keys, data URLs and bare base64 before truncation", () => {
    expect(
      redactGemini(`secret-key data:image/jpeg;base64,AAAA ${"Ab12+/".repeat(100)}`, "secret-key"),
    ).toBe("[key] [image] [redacted]");
  });
});

describe("listing validation", () => {
  it.each([
    ["傷がありません", "no-damage"],
    ["キズもありません", "no-damage"],
    ["傷や汚れもなく", "no-damage"],
    ["汚れがない", "no-damage"],
    ["目立った傷はございません", "no-damage"],
    ["傷は見当たりません", "no-damage"],
    ["目立つ傷もなし", "no-damage"],
    ["目立った傷や汚れはありません", "no-damage"],
    ["目立つ傷なし", "no-damage"],
    ["美品", "no-damage"],
    ["極美品", "no-damage"],
    ["新品同様", "no-damage"],
    ["未使用", "no-damage"],
    ["新品未使用", "no-damage"],
    ["動作確認しました", "works-confirmed"],
    ["動作確認済", "works-confirmed"],
    ["通電確認済み", "works-confirmed"],
    ["通電確認しました", "works-confirmed"],
    ["起動確認済み", "works-confirmed"],
    ["問題なく使えます", "works-confirmed"],
    ["問題なく使用できます", "works-confirmed"],
    ["問題なく動作します", "works-confirmed"],
    ["正常に動作", "works-confirmed"],
    ["動作良好", "works-confirmed"],
    ["傷があります", null],
    ["小傷あり", null],
    ["動作未確認", null],
    ["付属品なし", null],
    ["ジャンク", null],
  ])("matches the expected claim for %s", (text, id) => {
    const expected = id ? [id] : [];
    expect(claims.filter((claim) => claim.pattern.test(text)).map((claim) => claim.id)).toEqual(
      expected,
    );
    expect(validate(text)).toMatchObject({
      ok: true,
      stripped: expected,
      draft: { description: id ? draft.description : `${draft.description}\n${text}` },
    });
  });
  it.each(["通電", "起動"])("accepts %s support only from operation", (operation) => {
    expect(validate("動作確認済み。", { operation })).toMatchObject({
      ok: true,
      stripped: [],
    });
    for (const field of ["battery", "reset"]) {
      expect(validate("動作確認済み。", { [field]: operation })).toMatchObject({
        ok: true,
        stripped: ["works-confirmed"],
      });
    }
  });
  it.each<[string, string, Answers]>([
    ["no-damage", "傷なし。", { flaws: "目立つ傷なし" }],
    ["no-damage", "キズなし。", { flaws: "なし" }],
    ["no-damage", "未使用。", { condition: defaultPlatform.conditionLabels[0] }],
    ["no-damage", "美品。", { condition: defaultPlatform.conditionLabels[1] }],
    ["works-confirmed", "動作確認済み。", { operation: "動作確認済み" }],
    ["works-confirmed", "正常に動作。", { battery: "動作確認済み" }],
    ["accessories-complete", "付属品完備。", { accessories: "付属品すべてあり" }],
    ["reset-done", "初期化済み。", { reset: "resetBothDone" }],
    ["reset-done", "リセット済。", { reset: "statusDone" }],
    ["reset-done", "初期化済。", { reset: "どちらも完了" }],
    ["reset-done", "初期化済。", { reset: "完了" }],
    ["battery-good", "バッテリー良好。", { battery: "確認済み" }],
    ["battery-good", "バッテリー残量95%。", { battery: "95%" }],
    ["genuine/authentic", "純正です。", { notes: "純正" }],
    ["genuine/authentic", "本物です。", { notes: "本物" }],
    ["smoke/pet-free", "ペットはいません。", { storage: "ペットはいません" }],
    ["smoke/pet-free", "喫煙者なし。", { notes: "喫煙者なし" }],
  ])("strips unsupported %s and keeps supported %s", (id, text, answers) => {
    const unsupported = validate(text);
    expect(unsupported).toMatchObject({
      ok: true,
      stripped: [id],
      draft: { description: draft.description },
    });
    expect(validate(text, answers)).toMatchObject({
      ok: true,
      stripped: [],
      draft: { description: `${draft.description}\n${text}` },
    });
  });
  it("checks each authenticity and environment claim independently", () => {
    expect(
      validate("純正です。正規品です。ペットなし。喫煙者なし。", { notes: "純正 ペットなし" }),
    ).toMatchObject({
      ok: true,
      stripped: ["genuine/authentic", "smoke/pet-free"],
      draft: { description: `${draft.description}\n純正です。ペットなし。` },
    });
  });
  it("does not treat other flaws, used condition, or pending reset as support", () => {
    expect(
      validate("傷なし。初期化済み。", {
        flaws: "傷なしではない",
        condition: defaultPlatform.conditionLabels[2],
        reset: "resetBeforeShipping",
      }),
    ).toMatchObject({ ok: true, stripped: ["no-damage", "reset-done"] });
  });
  it("strips whole sentences/lines, cleans the title and deduplicates ids", () => {
    expect(
      validate("傷なし。動作確認済み\n付属品完備。傷なし。", {}, "傷なし | 商品 - 動作確認済み"),
    ).toMatchObject({
      ok: true,
      stripped: expect.arrayContaining(["no-damage", "works-confirmed", "accessories-complete"]),
      draft: { title: "商品", description: draft.description },
    });
  });
  it("removes unsupported condition claims from flaws before they can become answers", () => {
    expect(
      validateListingDraft({ ...draft, flaws: "傷なし。左側に擦れがあります。" }, context),
    ).toMatchObject({
      ok: true,
      draft: { flaws: "左側に擦れがあります。" },
      stripped: ["no-damage"],
    });
  });
  it("tidies separators and empty brackets after stripping title claims", () => {
    expect(validate("", {}, "【美品】商品 | 目立つ傷なし | 黒")).toMatchObject({
      ok: true,
      draft: { title: "商品 黒" },
      stripped: ["no-damage"],
    });
  });
  it("normalizes metadata, limits code points and prefers description boundaries", () => {
    const result = validateListingDraft(
      {
        ...draft,
        title: "📷".repeat(50),
        description: `${"あ".repeat(900)}。${"い".repeat(200)}`,
        brand: "b".repeat(200),
        flaws: "傷".repeat(600),
      },
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toMatchObject({ category: "gadget", model: "9", color: "黒" });
    expect(charCount(result.draft.title)).toBe(40);
    expect(charCount(result.draft.description)).toBe(901);
    expect(result.draft.brand).toHaveLength(100);
    expect(result.draft.flaws).toHaveLength(500);
    const hard = validateListingDraft({ ...draft, description: "📷".repeat(1001) }, context);
    expect(hard.ok && charCount(hard.draft.description)).toBe(1000);
  });
  it.each([
    {},
    { title: "", description: draft.description },
    { title: "商品", description: "傷なし。動作確認済み。" },
    { title: "傷なし", description: draft.description },
    { title: "商品", description: "短い" },
  ])("rejects missing/empty text %j", (value) => {
    expect(validateListingDraft(value, context).ok).toBe(false);
  });
});

describe("claim support ignores negated answers", () => {
  const context = (answers: Record<string, string>) => ({
    answers,
    category: "gadget" as const,
    platform: "mercari" as const,
  });
  const draft = {
    category: "gadget",
    brand: "",
    model: "",
    color: "",
    flaws: "",
    title: "ワイヤレスイヤホン",
    description:
      "ワイヤレスイヤホンです。動作確認済みです。バッテリー良好です。写真のものが全てです。",
  };
  it.each([
    [{ operation: "動作未確認" }],
    [{ operation: "通電しません" }],
    [{ operation: "不明" }],
    [{ battery: "不明" }],
  ])("strips claims when answers are negated: %j", (answers) => {
    const result = validateListingDraft(draft, context(answers));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.description).not.toContain("動作確認済み");
    expect(result.draft.description).not.toContain("バッテリー良好");
  });
  it("keeps claims when answers affirm them", () => {
    const result = validateListingDraft(
      draft,
      context({ operation: "動作確認済み", battery: "最大容量90%" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.description).toContain("動作確認済み");
    expect(result.draft.description).toContain("バッテリー良好");
  });
});

import { defaultPlatform } from "@mer/core";
import { describe, expect, it } from "vitest";
import { AiJsonError, extractJson, extractText, normalizePhoto, normalizePrices } from "./ai";

describe("extractText", () => {
  it.each([
    ["direct", "direct"],
    [{ response: "response" }, "response"],
    [{ response: { prices: [12000] } }, '{"prices":[12000]}'],
    [{ result: { response: "wrapped" } }, "wrapped"],
    [{ choices: [{ message: { content: "content" } }] }, "content"],
    [
      { choices: [{ message: { content: [{ type: "text", text: "a" }, { text: "b" }, {}] } }] },
      "ab",
    ],
    [{ choices: [{ text: "legacy" }] }, "legacy"],
    [{ choices: [{ message: { content: "", reasoning_content: "thought" } }] }, "thought"],
    [{ choices: [{ message: { content: [], reasoning: "reasoning" } }] }, "reasoning"],
    [{ choices: [{ message: { content: "answer", reasoning_content: "thought" } }] }, "answer"],
    [{ response: "", choices: [{ message: { content: "answer" } }] }, "answer"],
    [{ choices: [{ message: { content: "  " } }], finish_reason: "length" }, ""],
    [null, ""],
    [undefined, ""],
    [{}, ""],
    [{ choices: [{}] }, ""],
  ])("extracts text from %j", (input, expected) => {
    expect(extractText(input)).toBe(expected);
  });
});

describe("extractJson", () => {
  it.each([
    ['```json\n{"brand":"Google"}\n```', { brand: "Google" }],
    ['<|channel>thought {"draft":true}<channel|>final {"brand":"Google"}', { brand: "Google" }],
    ['Prose {not JSON} before {"brand":"Google"}', { brand: "Google" }],
    ['{"nested":{"prices":[12000]}}', { nested: { prices: [12000] } }],
    [
      JSON.stringify({ flaws: 'Brace { and } and escaped " quote \\' }),
      { flaws: 'Brace { and } and escaped " quote \\' },
    ],
    ['{"draft":true} {"prices":[12000]} {invalid}', { prices: [12000] }],
    ['{"draft":true} {"unfinished":', { draft: true }],
  ])("finds the last valid object in %s", (input, expected) => {
    expect(extractJson(input)).toEqual(expected);
  });

  it.each(["", "garbage", "{invalid}", '{"unfinished":', "[]"])(
    "throws a typed error for %s",
    (input) => {
      expect(() => extractJson(input)).toThrow(AiJsonError);
    },
  );
});

describe("normalizePhoto", () => {
  it("joins arrays, trims fields, stringifies numbers, and clears null/non-string values", () => {
    expect(
      normalizePhoto({
        category: " Smartphone ",
        brand: [" Google ", null, "Pixel"],
        model: 9,
        color: null,
        flaws: ["小傷", " 擦れ "],
      }),
    ).toEqual({
      category: "phone",
      brand: "Google、Pixel",
      model: "9",
      color: "",
      flaws: "小傷、擦れ",
    });
    expect(normalizePhoto({ brand: {}, color: false })).toEqual({
      category: "other",
      brand: "",
      model: "",
      color: "",
      flaws: "",
    });
    expect(normalizePhoto(null)).toEqual(normalizePhoto({}));
  });

  it("truncates fields to the API limits", () => {
    const long = "傷".repeat(600);
    const result = normalizePhoto({ brand: long, model: long, color: long, flaws: long });
    expect([
      result.brand.length,
      result.model.length,
      result.color.length,
      result.flaws.length,
    ]).toEqual([100, 100, 100, 500]);
  });

  it.each([
    ["phone", ["PHONE", "Smartphone", "tablet", "スマホ", "携帯", "タブレット"]],
    ["gadget", ["gadget", "Electronics", "camera", "headphones", "ガジェット", "家電"]],
    ["clothing", ["clothing", "Clothes", "apparel", "fashion", "服", "衣類"]],
    ["other", ["other", "furniture", "", "unknown"]],
  ])("maps synonyms to %s", (expected, synonyms) => {
    for (const category of synonyms) expect(normalizePhoto({ category }).category).toBe(expected);
  });
});

describe("normalizePrices", () => {
  it("parses currency strings and rounds floats", () => {
    expect(
      normalizePrices({ prices: ["¥12,000", "12000円", " ￥ 2,000 ", 1234.6, "1234.4"] }),
    ).toEqual({ prices: [12000, 12000, 2000, 1235, 1234] });
  });

  it("drops out-of-range and non-numeric values and accepts a bare array", () => {
    const { minPrice, maxPrice } = defaultPlatform.limits;
    expect(
      normalizePrices([
        minPrice,
        maxPrice,
        minPrice - 1,
        maxPrice + 1,
        "unknown",
        "12oops",
        "",
        "¥ 円",
        null,
        undefined,
        false,
        {},
        NaN,
        Infinity,
        -Infinity,
      ]),
    ).toEqual({ prices: [minPrice, maxPrice] });
  });

  it("caps valid prices at 50 after filtering", () => {
    expect(normalizePrices({ prices: [null, ...Array(60).fill(12000)] }).prices).toEqual(
      Array(50).fill(12000),
    );
  });

  it.each([null, {}, { prices: "12000" }, { prices: [] }])(
    "allows empty results for %j",
    (input) => {
      expect(normalizePrices(input)).toEqual({ prices: [] });
    },
  );
});

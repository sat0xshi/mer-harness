import { describe, expect, it } from "vitest";
import {
  buildListing,
  type Category,
  copyAnswer,
  copyBoosters,
  neutralShipping,
  questions,
  removeBannedPhrases,
  sanitizeServiceNames,
} from "./index";

describe("service-neutral copy", () => {
  it.each([
    "らくらくメルカリ便",
    "ゆうゆうメルカリ便",
    "エコメルカリ便",
    "かんたんラクマパック",
    "おてがる配送",
    "匿名配送（ヤマト）",
    "匿名配送（日本郵便）",
  ])("normalizes %s in answers and prose", (shipping) => {
    expect(neutralShipping(` ${shipping} `)).toBe("匿名配送（追跡あり）");
    expect(sanitizeServiceNames(`・${shipping}で発送します。`)).toBe(
      "・匿名配送（追跡あり）で発送します。",
    );
    const listing = buildListing("phone", { model: "Pixel", shipping });
    expect(listing.description).toContain("発送方法：匿名配送（追跡あり）");
    expect(listing.description).not.toMatch(/メルカリ|ヤマト|日本郵便/);
  });
  it("keeps unknown shipping as an answer but omits it from public copy", () => {
    expect(neutralShipping("未定")).toBe("未定");
    expect(neutralShipping("手渡し")).toBe("手渡し");
    expect(buildListing("other", { shipping: "未定" }).description).toBe("");
  });
  it("cleans service names, empty brackets and separators before template limits", () => {
    expect(sanitizeServiceNames("【Mercari】 メルカリ | | Pixel")).toBe("Pixel");
    const result = buildListing("other", {
      brand: "mErCaRi",
      model: "商品",
      notes: "メルカリ。Mercari。",
    });
    expect(result.title).toBe("商品");
    expect(result.description).not.toMatch(/mercari|メルカリ/i);
  });
});

describe("banned copy", () => {
  it.each([
    ["ノークレーム・ノーリターン", "no-returns"],
    ["ノークレームノーリターン", "no-returns"],
    ["ノークレーム", "no-returns"],
    ["ノーリターン", "no-returns"],
    ["返品不可", "no-returns"],
    ["NC/NR", "no-returns"],
    ["NCNR", "no-returns"],
    ["nc/nr", "no-returns"],
    ["3N", "no-returns"],
    ["クレーム一切受け付けません", "no-returns"],
    ["プロフ必読", "restrictive-rules"],
    ["即購入禁止", "restrictive-rules"],
    ["コメント必須", "restrictive-rules"],
    ["値下げ交渉一切禁止", "restrictive-rules"],
    ["値下げ不可", "restrictive-rules"],
    ["値下げ交渉は一切お断り", "restrictive-rules"],
    ["激安", "hype"],
    ["最安値", "hype"],
    ["早い者勝ち", "hype"],
    ["大人気", "hype"],
    ["神", "hype"],
    ["神アイテム", "hype"],
    ["神コスパ", "hype"],
    ["限定価格", "hype"],
    ["今だけ限定", "hype"],
  ])("removes %s from titles and offending sentences even when answered", (phrase, id) => {
    expect(removeBannedPhrases(`【${phrase}】 カメラ`, "title")).toEqual({
      text: "カメラ",
      removed: [id],
    });
    expect(
      removeBannedPhrases(`カメラです。${phrase}です。\n即購入OKです。`, "description"),
    ).toEqual({
      text: "カメラです。即購入OKです。",
      removed: [id],
    });
    const listing = buildListing("gadget", {
      model: `${phrase} カメラ`,
      notes: `${phrase}です。\n即購入OKです。`,
    });
    expect(listing.title).toBe("カメラ");
    expect(listing.description).toBe("即購入OKです。");
    expect(listing.removed).toEqual([id]);
  });
  it.each([
    "即購入OKです。",
    "限定モデル",
    "神戸で購入しました。",
    "精神的な",
    "神話の本",
    "恐れ入りますが、お値下げはご遠慮いただけますと幸いです。",
  ])("preserves %s", (text) => {
    for (const kind of ["title", "description"] as const)
      expect(removeBannedPhrases(text, kind)).toEqual({ text, removed: [] });
    expect(buildListing("other", { model: text }).title).toBe(text);
  });
  it("keeps a courteous declined negotiation answer", () => {
    expect(buildListing("other", { negotiation: "negotiationDeclined" }).description).toContain(
      "お値下げはご遠慮いただけますと幸いです。",
    );
  });
});

describe("copy questions and boosters", () => {
  it.each(Object.keys(questions) as Category[])(
    "offers applicable %s questions within the answer limit",
    (category) => {
      const cards = questions[category];
      expect(cards.length).toBeLessThanOrEqual(30);
      expect(cards.some(({ key }) => key === "network")).toBe(category === "phone");
      for (const key of ["shipDays", "reason", "smokePet"])
        expect(cards.some((q) => q.key === key)).toBe(true);
      const answers = Object.fromEntries(
        cards.map(({ key, options }) => [key, options?.[0] || "回答"]),
      );
      expect(buildListing(category, answers)).toMatchObject({
        answered: cards.length,
        total: cards.length,
        complete: true,
      });
      expect(copyBoosters(category, answers)).toEqual([]);
      expect(copyBoosters(category, {})).toHaveLength(4);
      expect(
        copyBoosters(category, {}).every((booster) =>
          cards.some((q) => q.key === booster.key && q.label === booster.label),
        ),
      ).toBe(true);
    },
  );
  it("prioritizes unanswered phone and clothing details deterministically", () => {
    expect(copyBoosters("phone", {})).toEqual([
      { key: "sim", label: "questionSim" },
      { key: "battery", label: "questionBattery" },
      { key: "network", label: "questionNetwork" },
      { key: "shipDays", label: "questionShipDays" },
    ]);
    expect(
      copyBoosters("phone", { sim: "SIMフリー", battery: "未確認", network: " " }).map(
        ({ key }) => key,
      ),
    ).toEqual(["network", "shipDays", "purchase", "reset"]);
    expect(copyBoosters("clothing", {}).map(({ key }) => key)).toEqual([
      "size",
      "measurements",
      "material",
      "shipDays",
    ]);
  });
  it("renders stored option keys and new answer rows as public text", () => {
    expect(questions.phone.find((q) => q.key === "network")?.options?.map(copyAnswer)).toEqual([
      "○",
      "△",
      "×",
      "不明",
    ]);
    const listing = buildListing("phone", {
      shipDays: "shipDaysOneTwo",
      reason: "機種変更",
      network: "networkClear",
      smokePet: "smokePetNone",
    });
    for (const row of [
      "発送までの日数：1〜2日",
      "出品理由：機種変更",
      "ネットワーク利用制限：○",
      "喫煙・ペット：喫煙者・ペットなし",
    ])
      expect(listing.description).toContain(row);
  });
});

it.each([
  "ラクマ",
  "Rakuma",
  "rAkUmA",
  "フリル",
  "Yahoo!フリマ",
  "Yahoo！フリマ",
  "PayPayフリマ",
  "ヤフオク!",
  "ヤフオク！",
  "ヤフオク",
  "Yahoo!オークション",
  "Yahoo！オークション",
  "ジモティー",
  "jmty",
  "JMTY",
])("strips %s completely while preserving generic words", (name) => {
  expect(sanitizeServiceNames(`【${name}】 フリマ 商品`)).toBe("フリマ 商品");
  expect(buildListing("other", { model: `${name} 商品`, notes: `${name} フリマ` }).title).toBe(
    "商品",
  );
});
it("preserves pickup in public copy", () => {
  expect(sanitizeServiceNames("手渡し")).toBe("手渡し");
  expect(buildListing("other", { shipping: "手渡し" }, "jmoty").description).toBe(
    "発送方法：手渡し",
  );
});

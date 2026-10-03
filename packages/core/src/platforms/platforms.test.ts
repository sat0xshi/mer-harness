import { describe, expect, it } from "vitest";
import { buildListing, netProceeds, platformQuestions } from "../listing";
import { defaultPlatform, formatCurrency, getPlatform, platforms } from "./index";

describe("platform adapters", () => {
  it("registers all platforms in picker order and rejects unsupported identifiers", () => {
    expect(Object.keys(platforms)).toEqual([
      "mercari",
      "yahooFleamarket",
      "rakuma",
      "yahooAuctions",
      "jmoty",
    ]);
    expect(getPlatform("mercari")).toBe(defaultPlatform);
    expect(() => getPlatform("other")).toThrow();
    expect(() => getPlatform("toString")).toThrow();
  });
  it("owns fees, shipping, conditions, and Unicode limits", () => {
    const p = getPlatform("mercari");
    expect(netProceeds(195000, p.feeRate, p.defaultShipping)).toBe(174750);
    const listing = buildListing(
      "phone",
      { model: "😀".repeat(80), notes: "a".repeat(2000) },
      "mercari",
    );
    expect([...listing.title]).toHaveLength(p.limits.title);
    expect([...listing.description]).toHaveLength(p.limits.description);
    expect(platformQuestions("phone").find((q) => q.key === "condition")?.options).toEqual(
      p.conditionLabels,
    );
    expect(platformQuestions("phone").find((q) => q.key === "shipping")?.options).toEqual(
      p.shippingMethods,
    );
  });
  it("owns description and copy order, URLs, and currency formatting", () => {
    const p = getPlatform("mercari");
    const listing = {
      ...buildListing("phone", { brand: "Google", model: "Pixel", capacity: "512GB" }),
      price: 195000,
    };
    expect(listing.title).toBe("Google Pixel 512GB");
    expect(listing.description).toBe("ブランド：Google\n品名・型番：Pixel\n容量：512GB");
    expect(p.copyFields.map((f) => f.key)).toEqual(["title", "description", "price"]);
    expect(p.formatCopy(listing)).toBe(`${listing.title}\n\n${listing.description}\n\n195000円`);
    expect(new URL(p.soldSearchUrl("Pixel & 日本語")).searchParams.get("keyword")).toBe(
      "Pixel & 日本語",
    );
    expect(formatCurrency(195000, p)).toBe("￥195,000");
    expect(formatCurrency(12.5, { ...p, locale: "en-US", currency: "USD" })).toBe("$12.50");
  });
});

const keyword = "Pixel 8 & 日本語";
const encoded = encodeURIComponent(keyword);
it.each([
  [
    "mercari",
    `https://jp.mercari.com/search?keyword=${encoded}&status=sold_out`,
    "keyword",
    true,
    40,
    300,
    10,
  ],
  [
    "yahooFleamarket",
    `https://paypayfleamarket.yahoo.co.jp/search/${encoded}?sold=1`,
    null,
    true,
    65,
    100,
    5,
  ],
  ["rakuma", `https://fril.jp/s?query=${encoded}&transaction=soldout`, "query", true, 40, 300, 10],
  [
    "yahooAuctions",
    `https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=${encoded}`,
    "p",
    true,
    65,
    1,
    10,
  ],
  ["jmoty", `https://jmty.jp/all/sale?keyword=${encoded}`, "keyword", false, 40, 0, 0],
] as const)(
  "%s has the expected search, bounds, and neutral copy",
  (id, expected, param, sold, title, minPrice, fee) => {
    const p = getPlatform(id);
    const url = new URL(p.soldSearchUrl(keyword));
    expect(url.href).toBe(expected);
    expect(
      param
        ? url.searchParams.get(param)
        : decodeURIComponent(url.pathname.slice("/search/".length)),
    ).toBe(keyword);
    expect(p.hasSoldFilter).toBe(sold);
    expect(p.limits).toEqual({ title, description: 1000, minPrice, maxPrice: 9999999 });
    expect(p.feeRate).toBe(fee);
    expect(p.defaultShipping).toBe(id === "jmoty" ? 0 : 750);
    expect(p.shippingTable).toBe(defaultPlatform.shippingTable);
    expect(p.shippingMethods).toEqual(
      id === "jmoty"
        ? ["手渡し", ...defaultPlatform.shippingMethods]
        : defaultPlatform.shippingMethods,
    );
    expect(p).toMatchObject({ locale: "ja-JP", currency: "JPY", currencyLabel: "円" });
    const { id: _id, serviceName, searchLabel, ...neutral } = p;
    expect(serviceName).toBeTruthy();
    expect(searchLabel).toBeTruthy();
    expect(JSON.stringify(neutral).replace(/https?:[^"\s]+/g, "")).not.toMatch(
      /メルカリ|mercari|ラクマ|Rakuma|フリル|Yahoo[!！]フリマ|PayPayフリマ|ヤフオク|Yahoo[!！]オークション|ジモティー|jmty/i,
    );
  },
);
it("offers active auction search as well as sold-price search", () => {
  const url = getPlatform("yahooAuctions").activeSearchUrl?.(keyword);
  expect(url).toBe(`https://auctions.yahoo.co.jp/search/search?p=${encoded}`);
  expect(new URL(url || "").searchParams.get("p")).toBe(keyword);
});
it("uses each platform's Unicode title limit and pickup options", () => {
  for (const [id, length] of [
    ["yahooFleamarket", 65],
    ["mercari", 40],
  ] as const) {
    expect([...buildListing("phone", { model: "😀".repeat(80) }, id).title]).toHaveLength(length);
  }
  expect(platformQuestions("phone", "jmoty").find((q) => q.key === "shipping")?.options?.[0]).toBe(
    "手渡し",
  );
});

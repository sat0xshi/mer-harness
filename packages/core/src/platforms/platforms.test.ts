import { describe, expect, it } from "vitest";
import { buildListing, netProceeds, platformQuestions } from "../listing";
import { defaultPlatform, formatCurrency, getPlatform, platforms } from "./index";

describe("platform adapters", () => {
  it("ships only mercari and rejects unsupported identifiers", () => {
    expect(Object.keys(platforms)).toEqual(["mercari"]);
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

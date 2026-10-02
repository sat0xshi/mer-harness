import { describe, expect, it } from "vitest";
import {
  badges,
  buildListing,
  type Category,
  charCount,
  combo,
  type GameEvent,
  gameSummary,
  levelFor,
  localDay,
  netProceeds,
  prices,
  questions,
  searchUrl,
  streak,
} from "./index";

function event(
  day: string,
  type: GameEvent["type"] = "answer",
  time = Date.parse(`${day}T12:00:00Z`),
): GameEvent {
  return {
    id: crypto.randomUUID(),
    key: crypto.randomUUID(),
    type,
    item_id: "one",
    xp: 5,
    created_at: time,
    day,
    meta: { complete: true },
    rule_version: 1,
  };
}
describe("deterministic listing and pricing", () => {
  it.each([
    ["phone", "Google", "Pixel 10 Pro Fold", "512GB"],
    ["gadget", "Microsoft", "HoloLens 2", ""],
    ["clothing", "GORUCK", "Simple Pants", ""],
  ] as const)("fits %s dog food", (category, brand, model, capacity) => {
    const answers = { brand, model, capacity };
    const result = buildListing(category, answers);
    expect(result.title).toContain(model);
    expect(result.title).toContain(capacity);
    expect(result).toEqual(buildListing(category, answers));
    expect(result.description).not.toContain("初期化：完了");
  });
  it("limits Unicode code points without splitting a surrogate", () => {
    const result = buildListing("other", {
      brand: "😀".repeat(50),
      model: "商品",
      notes: "あ".repeat(2000),
    });
    expect(charCount(result.title)).toBe(40);
    expect(charCount(result.description)).toBe(1000);
    expect(result.title).not.toContain("\uFFFD");
  });
  it("has safe, explicit unknowns and complete counts for every category", () => {
    for (const [category, cards] of Object.entries(questions)) {
      expect(buildListing(category as Category, {}).description).toBe("");
      expect(new Set(cards.map((c) => c.key)).size).toBe(cards.length);
      const answers = Object.fromEntries(cards.map((c) => [c.key, "未確認"]));
      expect(buildListing(category as Category, answers).complete).toBe(true);
    }
  });
  it("uses sold entries only, even median and nice rounding", () => {
    expect(
      prices([
        { price: 40000, sold: true },
        { price: 44000, sold: true },
        { price: 999999, sold: false },
      ]),
    ).toEqual({ low: 39500, recommended: 42000, high: 44900, min: 40000, max: 44000 });
    expect(prices([])).toBeNull();
    expect(prices([{ price: NaN, sold: true }])).toBeNull();
  });
  it("computes fee and shipping, encodes search terms", () => {
    expect(netProceeds(195000, 10, 750)).toBe(174750);
    expect(netProceeds(999, 10, 200)).toBe(700);
    expect(searchUrl("Pixel & Fold")).toContain("Pixel%20%26%20Fold&status=sold_out");
  });
});
describe("game rules", () => {
  it("uses need(L), resolving inconsistent example totals in DESIGN", () => {
    expect(levelFor(0)).toEqual({ level: 1, current: 0, need: 120 });
    expect(levelFor(119).level).toBe(1);
    expect(levelFor(120).level).toBe(2);
    expect(levelFor(280).level).toBe(3);
    expect(levelFor(720).level).toBe(5);
    expect(levelFor(2520).level).toBe(10);
  });
  it("rolls days at local 04:00 including DST zones", () => {
    expect(localDay(Date.parse("2026-10-01T18:59:59Z"), "Asia/Tokyo")).toBe("2026-10-01");
    expect(localDay(Date.parse("2026-10-01T19:00:00Z"), "Asia/Tokyo")).toBe("2026-10-02");
    expect(localDay(Date.parse("2026-03-08T07:30:00Z"), "America/New_York")).toBe("2026-03-07");
  });
  it("keeps best streak and spends earned rest tickets once", () => {
    const events = Array.from({ length: 7 }, (_, i) => event(`2026-10-0${i + 1}`));
    expect(streak(events, "2026-10-08")).toEqual({ current: 7, best: 7, tickets: 1 });
    events.push(event("2026-10-09"));
    expect(streak(events, "2026-10-09")).toEqual({ current: 9, best: 9, tickets: 0 });
    events.push(event("2026-10-12"));
    expect(streak(events, "2026-10-12")).toEqual({ current: 1, best: 9, tickets: 0 });
  });
  it("does not duplicate days and caps tickets at 3", () => {
    const events = Array.from({ length: 28 }, (_, i) =>
      event(new Date(Date.UTC(2026, 9, i + 1)).toISOString().slice(0, 10)),
    );
    expect(streak([...events, ...events], "2026-10-28")).toEqual({
      current: 28,
      best: 28,
      tickets: 3,
    });
  });
  it("limits combo to complete listings in 20 minutes", () => {
    const events = [
      event("2026-10-01", "listed", 1000),
      event("2026-10-01", "listed", 1201000),
      event("2026-10-01", "listed", 1202000),
    ];
    expect(combo(events, 1202000)).toEqual({ count: 3, best: 3, multiplier: 1.5 });
    expect(combo(events, 2402001).count).toBe(0);
    events[1].meta.complete = false;
    expect(combo(events, 1202000).count).toBe(1);
  });
  it("has ten explicit badges and sums recorded XP", () => {
    expect(badges).toHaveLength(10);
    const events = [
      event("2026-10-01", "listed"),
      { ...event("2026-10-01", "sold"), xp: 80, meta: { price: 195000 } },
    ];
    const summary = gameSummary(events, "2026-10-01", Date.parse("2026-10-01T12:00:00Z"));
    expect(summary.xp).toBe(85);
    expect(summary.sales).toBe(195000);
    expect(summary.unlocked).toEqual(expect.arrayContaining(["first", "sold", "100k"]));
  });
});

import { describe, expect, it } from "vitest";
import {
  badgeThresholds,
  bossConfig,
  bossFor,
  calendar,
  dailyQuests,
  type GameEvent,
  gameSummary,
  type Item,
  jstDay,
  listingStreak,
  questPool,
  streak,
  titleFor,
  titles,
  weeklySummary,
} from "./index";

const time = (value: string) => Date.parse(value);
const now = time("2026-10-08T12:00:00+09:00");
function event(
  type: GameEvent["type"],
  at = now,
  itemId = "one",
  meta: GameEvent["meta"] = {},
): GameEvent {
  return {
    id: crypto.randomUUID(),
    key: crypto.randomUUID(),
    type,
    item_id: itemId,
    xp: 5,
    created_at: at,
    day: "2026-10-07",
    meta,
    rule_version: 1,
  };
}
function item(overrides: Partial<Item> = {}): Item {
  return {
    id: "one",
    category: "other",
    platform: "mercari",
    status: "listed",
    answers: {},
    title: "古い品",
    description: "",
    price: 1000,
    shipping: 0,
    comps: [],
    photos: [],
    version: 0,
    listed_at: now - 4 * calendar.dayMs,
    sold_at: null,
    shipped_at: null,
    completed_at: null,
    sold_price: 0,
    created_at: now - 4 * calendar.dayMs,
    updated_at: now,
    ...overrides,
  };
}
const summary = (events: GameEvent[], items: Item[] = []) =>
  gameSummary(events, jstDay(now), now, items);

describe("titles and JST listing streak", () => {
  it.each(titles)("uses the title at level %i", (level, name) => {
    expect(titleFor(level)).toBe(name);
    expect(titleFor(level + 1)).toBe(name);
  });
  it("clamps title lookup to the first/last configured title", () => {
    expect(titleFor(0)).toBe(titles[0][1]);
    expect(titleFor(1000)).toBe(titles.at(-1)?.[1]);
  });
  it("changes dates at JST midnight, independently of event.day", () => {
    const before = time("2026-10-08T23:59:00+09:00"),
      after = time("2026-10-09T00:01:00+09:00");
    const events = [event("listed", before)];
    expect(jstDay(before)).toBe("2026-10-08");
    expect(listingStreak(events, before)).toEqual({ current: 1, best: 1, listedToday: true });
    expect(listingStreak(events, after)).toEqual({ current: 1, best: 1, listedToday: false });
    expect(listingStreak([...events, event("relisted", after)], after)).toEqual({
      current: 2,
      best: 2,
      listedToday: true,
    });
  });
  it("deduplicates days, ignores other actions/future events, breaks gaps and retains best", () => {
    const events = [
      event("listed", now - 4 * calendar.dayMs),
      event("relisted", now - 3 * calendar.dayMs),
      event("listed", now - 3 * calendar.dayMs),
      event("photo", now),
      event("listed", now + calendar.dayMs),
    ];
    expect(listingStreak(events, now)).toEqual({ current: 0, best: 2, listedToday: false });
    expect(listingStreak([...events, event("listed")], now)).toEqual({
      current: 1,
      best: 2,
      listedToday: true,
    });
    expect(listingStreak([], now)).toEqual({ current: 0, best: 0, listedToday: false });
  });
});

describe("new badge conditions", () => {
  it("awards the first listing and counts ten distinct items, not relisting repeats", () => {
    expect(summary([event("listed")]).unlocked).toContain("first");
    expect(
      summary(Array.from({ length: badgeThresholds.ten }, () => event("relisted"))).unlocked,
    ).not.toContain("ten");
    expect(
      summary(
        Array.from({ length: badgeThresholds.ten }, (_, i) => event("listed", now, String(i))),
      ).unlocked,
    ).toContain("ten");
  });
  it.each([
    ["sales10k", 10000],
    ["100k", 100000],
  ] as const)("awards %s at the inclusive boundary", (badge, total) => {
    expect(summary([event("sold", now, "one", { price: total - 1 })]).unlocked).not.toContain(
      badge,
    );
    expect(summary([event("sold", now, "one", { price: total })]).unlocked).toContain(badge);
    expect(
      summary([
        event("sold", now, "one", { price: total }),
        event("sales_adjustment", now, "one", { price: -1 }),
      ]).unlocked,
    ).not.toContain(badge);
    expect(summary([event("badge", now, "one", { badge })]).unlocked).toContain(badge);
  });
  it("uses latest listing before each sale for the inclusive 24h badge", () => {
    const old = event("listed", now - 10 * calendar.dayMs);
    const sale = event("sold");
    expect(summary([old, sale]).unlocked).not.toContain("fast");
    expect(
      summary([old, event("relisted", now - badgeThresholds.fastMs), sale]).unlocked,
    ).toContain("fast");
    expect(
      summary([old, event("relisted", now - badgeThresholds.fastMs - 1), sale]).unlocked,
    ).not.toContain("fast");
    expect(summary([sale, event("listed", now + 1)]).unlocked).not.toContain("fast");
    expect(summary([event("listed", now, "other"), sale]).unlocked).not.toContain("fast");
  });
  it.each([
    ["price_drop", "priceDrop"],
    ["retake", "retake2"],
    ["boss", "bossSlayer"],
  ] as const)("awards %s only after its event", (type, badge) => {
    expect(summary([]).unlocked).not.toContain(badge);
    expect(summary([event(type)]).unlocked).toContain(badge);
  });
  it("awards seven calendar days of listings", () => {
    const events = Array.from({ length: 7 }, (_, i) =>
      event(i % 2 ? "listed" : "relisted", now - i * calendar.dayMs),
    );
    expect(summary(events.slice(0, 6)).unlocked).not.toContain("streak7");
    expect(summary(events).unlocked).toContain("streak7");
  });
});

describe("leftover bosses", () => {
  it("requires a real listing and minimum JST calendar age; shelf is eligible", () => {
    expect(bossFor(item({ listed_at: null }), [], now)).toBeNull();
    expect(bossFor(item({ status: "draft" }), [], now)).toBeNull();
    expect(
      bossFor(item({ listed_at: now - (bossConfig.minimumDays - 1) * calendar.dayMs }), [], now),
    ).toBeNull();
    expect(bossFor(item({ status: "shelf" }), [], now)?.daysListed).toBe(4);
  });
  it("grows on JST midnight and resets on the latest relisting", () => {
    const before = time("2026-10-08T23:59:00+09:00"),
      after = time("2026-10-09T00:01:00+09:00");
    const boss = bossFor(item(), [], before);
    expect(boss?.maxHp).toBe(bossConfig.baseHp + 4 * bossConfig.hpPerDay);
    expect(bossFor(item(), [], after)?.maxHp).toBe((boss?.maxHp ?? 0) + bossConfig.hpPerDay);
    expect(bossFor(item(), [event("relisted", before)], after)).toBeNull();
  });
  it("counts only this listing's item damage, including zero-XP actions, and floors at 1", () => {
    const events = [
      event("price_drop"),
      { ...event("retake"), xp: 0 },
      event("retake", now, "other"),
      event("price_drop", now - 5 * calendar.dayMs),
      event("retake", now + 1),
    ];
    const boss = bossFor(item(), events, now);
    expect(boss?.hp).toBe(
      (boss?.maxHp ?? 0) - bossConfig.priceDropDamage - bossConfig.retakeDamage,
    );
    expect(
      bossFor(
        item(),
        Array.from({ length: 100 }, () => event("price_drop")),
        now,
      )?.hp,
    ).toBe(1);
  });
  it.each(["trading", "to_ship", "done"] as const)(
    "defeats a boss in %s, freezes its age",
    (status) => {
      const sold = item({ status, sold_at: now });
      expect(bossFor(sold, [], now + 30 * calendar.dayMs)).toMatchObject({
        defeated: true,
        hp: 0,
        daysListed: 4,
      });
    },
  );
  it("handles a sold event and never turns a fast sale into a boss later", () => {
    expect(bossFor(item(), [event("sold")], now)).toMatchObject({ defeated: true, hp: 0 });
    expect(
      bossFor(
        item({ status: "done", sold_at: now, listed_at: now - calendar.dayMs }),
        [],
        now + 30 * calendar.dayMs,
      ),
    ).toBeNull();
    expect(bossFor(item({ title: "", answers: { model: "模型" } }), [], now)?.name).toBe("模型");
    expect(bossFor(item({ title: "" }), [], now)?.name).toBe(bossConfig.fallbackName);
  });
});

describe("daily quests", () => {
  it("selects three unique quests, stable all day and different at each midnight", () => {
    for (let i = 0; i < 40; i++) {
      const start = time("2026-10-01T00:00:00+09:00") + i * calendar.dayMs;
      const selected = dailyQuests([], [], start);
      expect(new Set(selected.map((q) => q.id)).size).toBe(3);
      expect(dailyQuests([], [], start + calendar.dayMs - 1)).toEqual(selected);
      expect(
        dailyQuests([], [], start + calendar.dayMs)
          .map((q) => q.id)
          .sort(),
      ).not.toEqual(selected.map((q) => q.id).sort());
    }
  });
  it("counts all pool actions only today, clamps progress, and preserves completed rewards", () => {
    for (let i = 0; i < questPool.length; i++) {
      const at = now + i * calendar.dayMs;
      const events = [
        event("relisted", at),
        ...Array.from({ length: 4 }, () => event("photo", at)),
        event("price_drop", at, "one", { boss: true }),
        event("text", at),
        event("sold", at),
      ];
      for (const q of dailyQuests(events, [item()], at))
        expect(q).toMatchObject({ done: true, progress: q.target });
      for (const q of dailyQuests(
        events.map((e) => ({ ...e, created_at: at - calendar.dayMs })),
        [item()],
        at,
      ))
        expect(q).toMatchObject({ done: false, progress: 0 });
      const chosen = dailyQuests([], [], at)[0];
      const reward = { ...event("quest", at), key: `quest:${jstDay(at)}:${chosen.id}` };
      expect(dailyQuests([reward], [], at)[0]).toMatchObject({
        done: true,
        progress: chosen.target,
      });
    }
  });
  it("recognizes bosses at attack time even after the item is sold, ignores young attacks", () => {
    const at =
      Array.from({ length: 6 }, (_, i) => now + i * calendar.dayMs).find((at) =>
        dailyQuests([], [], at).some((q) => q.id === "bossHit"),
      ) ?? now;
    const read = (events: GameEvent[], items: Item[]) =>
      dailyQuests(events, items, at).find((q) => q.id === "bossHit");
    expect(
      read([event("retake", at, "one", { boss: true })], [item({ status: "done" })])?.done,
    ).toBe(true);
    expect(read([event("retake", at, "one", { boss: false })], [item()])?.done).toBe(false);
    expect(read([event("retake", at)], [item()])?.done).toBe(true);
  });
});

describe("JST weekly summary", () => {
  it("switches exactly at Monday midnight JST and excludes future events", () => {
    const monday = time("2026-10-05T00:00:00+09:00");
    const events = [
      event("sold", monday - 1, "one", { price: 1000 }),
      event("listed", monday),
      event("sold", monday + 1, "two", { price: 2000 }),
    ];
    expect(weeklySummary(events, [], monday - 1).current).toMatchObject({
      sales: 1000,
      soldCount: 1,
      listedCount: 0,
    });
    const result = weeklySummary(events, [], monday);
    expect(result.previous).toMatchObject({ sales: 1000, soldCount: 1, xp: 5 });
    expect(result.current).toMatchObject({ sales: 0, soldCount: 0, listedCount: 1, xp: 5 });
  });
  it("aggregates adjustments and all action counts; clears sold/completed items only once", () => {
    const events = [
      event("sold", now, "one", { price: 1000 }),
      event("sales_adjustment", now, "one", { price: -100 }),
      event("relisted"),
      event("price_drop"),
      event("retake"),
      event("boss"),
    ];
    const result = weeklySummary(
      events,
      [item({ sold_at: now, completed_at: now }), item({ id: "two", completed_at: now })],
      now,
    );
    expect(result.current).toEqual({
      sales: 900,
      soldCount: 1,
      cleared: 2,
      listedCount: 1,
      priceDrops: 1,
      retakes: 1,
      bossesDefeated: 1,
      xp: 30,
    });
    expect(result.previous.xp).toBe(0);
  });
});

it("keeps JST quest/boss rewards from extending the legacy activity streak", () => {
  const action = { ...event("photo"), day: "2026-10-07" };
  const quest = { ...event("quest"), day: "2026-10-08" };
  const boss = { ...event("boss"), day: "2026-10-08" };
  expect(streak([action, quest, boss], "2026-10-07")).toEqual(streak([action], "2026-10-07"));
});

it("shows partial photo quest progress and ignores future actions", () => {
  const at =
    Array.from({ length: 6 }, (_, i) => now + i * calendar.dayMs).find((at) =>
      dailyQuests([], [], at).some((q) => q.id === "photo"),
    ) ?? now;
  const events = [event("photo", at), event("photo", at), event("photo", at + 1)];
  expect(dailyQuests(events, [], at).find((q) => q.id === "photo")).toMatchObject({
    progress: 2,
    target: 3,
    done: false,
  });
});

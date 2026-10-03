import { bossFor } from "./boss";
import { dayNumber, jstDay } from "./day";
import type { GameEvent } from "./game";
import { questConfig, questPool } from "./gameConfig";
import type { Item } from "./listing";

export function dailyQuests(events: GameEvent[], items: Item[], now: number) {
  const day = jstDay(now);
  // The JST date is the seed. A calendar-day rotation guarantees a different
  // selection tomorrow while remaining identical for all users and reloads.
  const ordered = questPool;
  const offset = dayNumber(day) % questPool.length;
  const today = events.filter((e) => e.created_at <= now && jstDay(e.created_at) === day);
  return Array.from(
    { length: questConfig.dailyCount },
    (_, i) => ordered[(offset + i) % ordered.length],
  ).map((q) => {
    const progress = today.filter((e) => {
      switch (q.id) {
        case "list":
          return e.type === "listed" || e.type === "relisted";
        case "photo":
          return e.type === "photo";
        case "price":
          return e.type === "price_drop";
        case "text":
          return e.type === "text";
        case "sell":
          return e.type === "sold";
        case "bossHit": {
          if (e.type !== "price_drop" && e.type !== "retake") return false;
          // Use the action-time snapshot, so selling/relisting later cannot revoke progress.
          if (typeof e.meta.boss === "boolean") return e.meta.boss;
          const item = items.find((item) => item.id === e.item_id);
          if (!item) return false;
          const historical = { ...item, status: "listed" as const, sold_at: null };
          const boss = bossFor(
            historical,
            events.filter((v) => v.created_at <= e.created_at && v.type !== "sold"),
            e.created_at,
          );
          return !!boss && !boss.defeated;
        }
      }
      return false;
    }).length;
    const rewarded = today.some((e) => e.key === `quest:${day}:${q.id}` && e.type === "quest");
    return {
      ...q,
      progress: rewarded ? q.target : Math.min(q.target, progress),
      done: rewarded || progress >= q.target,
    };
  });
}

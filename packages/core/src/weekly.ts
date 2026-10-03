import { dayNumber, jstDay } from "./day";
import type { GameEvent } from "./game";
import { calendar } from "./gameConfig";
import type { Item } from "./listing";

export function weeklySummary(events: GameEvent[], items: Item[], now: number) {
  const day = jstDay(now);
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const monday = dayNumber(day) - ((weekday + calendar.weekDays - 1) % calendar.weekDays);
  const start = monday * calendar.dayMs - calendar.jstOffsetMs;
  const weekMs = calendar.weekDays * calendar.dayMs;
  const summarize = (from: number, until: number) => {
    const inRange = (time: number | null) =>
      time !== null && time >= from && time < until && time <= now;
    const period = events.filter((e) => inRange(e.created_at));
    const count = (type: GameEvent["type"]) => period.filter((e) => e.type === type).length;
    const cleared = new Set(
      period.filter((e) => e.type === "sold" && e.item_id).map((e) => e.item_id),
    );
    for (const item of items)
      if (inRange(item.sold_at) || inRange(item.completed_at)) cleared.add(item.id);
    return {
      sales: period
        .filter((e) => e.type === "sold" || e.type === "sales_adjustment")
        .reduce((sum, e) => sum + Number(e.meta.price || 0), 0),
      soldCount: count("sold"),
      cleared: cleared.size,
      listedCount: count("listed") + count("relisted"),
      priceDrops: count("price_drop"),
      retakes: count("retake"),
      bossesDefeated: count("boss"),
      xp: period.reduce((sum, e) => sum + e.xp, 0),
    };
  };
  return { current: summarize(start, start + weekMs), previous: summarize(start - weekMs, start) };
}

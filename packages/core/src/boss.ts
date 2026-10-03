import { jstDayNumber } from "./day";
import type { GameEvent } from "./game";
import { bossConfig } from "./gameConfig";
import type { Item } from "./listing";

export function latestListing(item: Item, events: GameEvent[], now: number) {
  const times = events
    .filter(
      (e) =>
        e.item_id === item.id &&
        (e.type === "listed" || e.type === "relisted") &&
        e.created_at <= now,
    )
    .map((e) => e.created_at);
  if (item.listed_at !== null && item.listed_at <= now) times.push(item.listed_at);
  return times.length ? Math.max(...times) : undefined;
}
export function bossFor(item: Item, events: GameEvent[], now: number) {
  if (item.status === "draft") return null;
  const listed = latestListing(item, events, now);
  if (listed === undefined) return null;
  const since = events.filter(
    (e) => e.item_id === item.id && e.created_at >= listed && e.created_at <= now,
  );
  const sale = since
    .filter((e) => e.type === "sold")
    .sort((a, b) => a.created_at - b.created_at)[0];
  const soldStatus = ["trading", "to_ship", "done"].includes(item.status);
  const defeated = soldStatus || !!sale;
  // Freeze growth at sale: a quick sale must never become a boss retroactively.
  const end = defeated ? Math.min(now, item.sold_at ?? sale?.created_at ?? now) : now;
  const daysListed = Math.max(0, jstDayNumber(end) - jstDayNumber(listed));
  if (daysListed < bossConfig.minimumDays) return null;
  const maxHp = bossConfig.baseHp + bossConfig.hpPerDay * daysListed;
  const damage = since
    .filter((e) => e.created_at <= end)
    .reduce(
      (sum, e) =>
        sum +
        (e.type === "price_drop"
          ? bossConfig.priceDropDamage
          : e.type === "retake"
            ? bossConfig.retakeDamage
            : 0),
      0,
    );
  return {
    itemId: item.id,
    name: item.title || item.answers.model || bossConfig.fallbackName,
    level: Math.max(1, Math.floor(daysListed / bossConfig.daysPerLevel)),
    hp: defeated ? 0 : Math.max(bossConfig.hpFloor, maxHp - damage),
    maxHp,
    defeated,
    daysListed,
  };
}

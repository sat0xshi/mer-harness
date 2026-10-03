import { bossFor } from "./boss";
import { dayNumber, jstDayNumber } from "./day";
import {
  badges,
  gameRules,
  levelCurve,
  badgeThresholds as thresholds,
  titles,
  type XP,
} from "./gameConfig";
import type { Item } from "./listing";
import { dailyQuests } from "./quests";
import { weeklySummary } from "./weekly";

export { badges, streakMilestones, XP } from "./gameConfig";
export type EventType = keyof typeof XP | "streak" | "rest" | "sales_adjustment" | "quest";
export interface GameEvent {
  id: string;
  key: string;
  type: EventType;
  item_id: string | null;
  xp: number;
  created_at: number;
  day: string;
  meta: Record<string, unknown>;
  rule_version: number;
}
export function levelFor(xp: number) {
  let level: number = levelCurve.startingLevel,
    remaining = Math.max(0, xp);
  while (remaining >= levelCurve.base + levelCurve.perLevel * level) {
    remaining -= levelCurve.base + levelCurve.perLevel * level;
    level++;
  }
  return { level, current: remaining, need: levelCurve.base + levelCurve.perLevel * level };
}
// Calculate in the user's IANA zone, so DST and travel do not use Worker UTC dates.
export function localDay(time: number, zone = "Asia/Tokyo") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(time);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const date = new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`);
  if (Number(p.hour) < gameRules.legacyDayStartHour) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function streak(events: GameEvent[], today: string) {
  const days = [
    ...new Set(
      events
        .filter((e) => !gameRules.streakRewardTypes.some((type) => type === e.type))
        .map((e) => e.day),
    ),
  ].sort();
  let current = 0,
    best = 0,
    tickets = 0,
    last: number | undefined,
    earned = 0;
  for (const day of days) {
    const d = dayNumber(day);
    const gap = last === undefined ? 0 : d - last - 1;
    if (gap > 0 && gap <= tickets) {
      tickets -= gap;
      current += gap;
    } else if (gap > 0) {
      current = 0;
      earned = 0;
    }
    current++;
    best = Math.max(best, current);
    const threshold = Math.floor(current / gameRules.restTicketEveryDays);
    if (threshold > earned) {
      tickets = Math.min(gameRules.maxRestTickets, tickets + threshold - earned);
      earned = threshold;
    }
    last = d;
  }
  const gap = last === undefined ? 0 : dayNumber(today) - last - 1;
  if (gap > tickets) current = 0;
  else if (gap > 0) {
    current += gap;
    tickets -= gap;
  }
  return { current, best, tickets };
}
export function combo(events: GameEvent[], now: number) {
  const listed = events
    .filter((e) => e.type === "listed" && e.meta.complete === true)
    .sort((a, b) => a.created_at - b.created_at);
  let count = 0,
    last = 0,
    best = 0;
  for (const e of listed) {
    count = e.created_at - last <= gameRules.comboWindowMs ? count + 1 : 1;
    last = e.created_at;
    best = Math.max(best, count);
  }
  if (now - last > gameRules.comboWindowMs) count = 0;
  return { count, best, multiplier: comboMultiplier(count) };
}
export function comboMultiplier(count: number) {
  return gameRules.comboMultipliers[
    Math.min(gameRules.comboMultipliers.length - 1, Math.max(0, count))
  ];
}
export function titleFor(level: number) {
  return [...titles].reverse().find(([minimum]) => level >= minimum)?.[1] ?? titles[0][1];
}
export function listingStreak(events: GameEvent[], now: number) {
  const today = jstDayNumber(now);
  const days = [
    ...new Set(
      events
        .filter((e) => (e.type === "listed" || e.type === "relisted") && e.created_at <= now)
        .map((e) => jstDayNumber(e.created_at)),
    ),
  ].sort((a, b) => a - b);
  let current = 0,
    best = 0,
    last: number | undefined;
  for (const day of days) {
    current = last !== undefined && day === last + 1 ? current + 1 : 1;
    best = Math.max(best, current);
    last = day;
  }
  return {
    current: last !== undefined && last >= today - 1 ? current : 0,
    best,
    listedToday: last === today,
  };
}
export function gameSummary(events: GameEvent[], today: string, now: number, items: Item[] = []) {
  const count = (type: EventType) => events.filter((e) => e.type === type).length;
  const sales = events
    .filter((e) => e.type === "sold" || e.type === "sales_adjustment")
    .reduce((sum, e) => sum + Number(e.meta.price || 0), 0);
  const s = streak(events, today),
    c = combo(events, now),
    ls = listingStreak(events, now);
  const listings = events.filter((e) => e.type === "listed" || e.type === "relisted");
  const conditions: Record<(typeof badges)[number][0], boolean> = {
    first: listings.length >= thresholds.first,
    camera: count("photo") >= thresholds.camera,
    talk: events.filter((e) => e.type === "listed" && e.meta.complete).length >= thresholds.talk,
    combo: c.best >= thresholds.combo,
    fire: s.best >= thresholds.fire,
    reins: s.best >= thresholds.reins,
    sold: count("sold") >= thresholds.sold,
    pack: events.filter((e) => e.type === "shipped" && e.meta.checked).length >= thresholds.pack,
    "100k": sales >= thresholds.sales100k,
    retry: events.some(
      (e) =>
        e.type === "sold" &&
        events.some(
          (r) => r.type === "relisted" && r.item_id === e.item_id && r.created_at <= e.created_at,
        ),
    ),
    ten: new Set(listings.filter((e) => e.item_id).map((e) => e.item_id)).size >= thresholds.ten,
    sales10k: sales >= thresholds.sales10k,
    fast: events.some((e) => {
      if (e.type !== "sold" || !e.item_id) return false;
      const prior = listings.filter((l) => l.item_id === e.item_id && l.created_at <= e.created_at);
      return (
        prior.length > 0 &&
        e.created_at - Math.max(...prior.map((l) => l.created_at)) <= thresholds.fastMs
      );
    }),
    priceDrop: count("price_drop") >= thresholds.priceDrop,
    retake2: count("retake") >= thresholds.retake,
    bossSlayer: count("boss") >= thresholds.bossSlayer,
    streak7: ls.best >= thresholds.streak7,
  };
  const unlocked = badges
    .filter(
      (b) => conditions[b[0]] || events.some((e) => e.type === "badge" && e.meta.badge === b[0]),
    )
    .map((b) => b[0]);
  const xp = events.reduce((sum, e) => sum + e.xp, 0);
  const level = levelFor(xp);
  return {
    xp,
    ...level,
    title: titleFor(level.level),
    streak: s,
    combo: c,
    sales,
    unlocked,
    listingStreak: ls,
    quests: dailyQuests(events, items, now),
    bosses: items.flatMap((item) => {
      const boss = bossFor(item, events, now);
      return boss ? [boss] : [];
    }),
    weekly: weeklySummary(events, items, now),
  };
}

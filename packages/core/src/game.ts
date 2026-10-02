export const XP = {
  photo: 3,
  answer: 5,
  text: 20,
  price: 10,
  listed: 50,
  sold: 80,
  check: 5,
  shipped: 60,
  relisted: 30,
  badge: 100,
} as const;
export type EventType = keyof typeof XP | "streak" | "rest" | "sales_adjustment";
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
  let level = 1,
    remaining = Math.max(0, xp);
  while (remaining >= 80 + 40 * level) {
    remaining -= 80 + 40 * level;
    level++;
  }
  return { level, current: remaining, need: 80 + 40 * level };
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
  if (Number(p.hour) < 4) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86400000;
export function streak(events: GameEvent[], today: string) {
  const days = [
    ...new Set(events.filter((e) => e.type !== "badge" && e.type !== "streak").map((e) => e.day)),
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
    const threshold = Math.floor(current / 7);
    if (threshold > earned) {
      tickets = Math.min(3, tickets + threshold - earned);
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
    count = e.created_at - last <= 1200000 ? count + 1 : 1;
    last = e.created_at;
    best = Math.max(best, count);
  }
  if (now - last > 1200000) count = 0;
  return { count, best, multiplier: [1, 1, 1.2, 1.5, 2][Math.min(4, count)] };
}
export const badges = [
  ["first", "badgeFirst", "badgeFirstHint"],
  ["camera", "badgeCamera", "badgeCameraHint"],
  ["talk", "badgeTalk", "badgeTalkHint"],
  ["combo", "badgeCombo", "badgeComboHint"],
  ["fire", "badgeFire", "badgeFireHint"],
  ["reins", "badgeReins", "badgeReinsHint"],
  ["sold", "badgeSold", "badgeSoldHint"],
  ["pack", "badgePack", "badgePackHint"],
  ["100k", "badgeSales", "badgeSalesHint"],
  ["retry", "badgeRetry", "badgeRetryHint"],
] as const;
export function gameSummary(events: GameEvent[], today: string, now: number) {
  const count = (type: EventType) => events.filter((e) => e.type === type).length;
  const sales = events
    .filter((e) => e.type === "sold" || e.type === "sales_adjustment")
    .reduce((sum, e) => sum + Number(e.meta.price || 0), 0);
  const s = streak(events, today),
    c = combo(events, now);
  const conditions = [
    count("listed") > 0,
    count("photo") >= 30,
    events.filter((e) => e.type === "listed" && e.meta.complete).length >= 5,
    c.best >= 3,
    s.best >= 7,
    s.best >= 30,
    count("sold") > 0,
    events.filter((e) => e.type === "shipped" && e.meta.checked).length >= 5,
    sales > 100000,
    events.some(
      (e) =>
        e.type === "sold" &&
        events.some(
          (r) => r.type === "relisted" && r.item_id === e.item_id && r.created_at <= e.created_at,
        ),
    ),
  ];
  const unlocked = badges
    .filter(
      (b, i) => conditions[i] || events.some((e) => e.type === "badge" && e.meta.badge === b[0]),
    )
    .map((b) => b[0]);
  const xp = events.reduce((sum, e) => sum + e.xp, 0);
  return { xp, ...levelFor(xp), streak: s, combo: c, sales, unlocked };
}
export const streakMilestones: Record<number, number> = { 3: 10, 7: 30, 14: 60, 30: 150, 100: 500 };

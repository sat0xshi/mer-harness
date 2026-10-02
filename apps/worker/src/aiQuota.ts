import { jstDay } from "./day";

export function reserveAiCall(db: D1Database, configuredLimit: string) {
  const limit = Math.max(0, Math.min(100, Number(configuredLimit) || 0));
  return db
    .prepare(
      "INSERT INTO ai_usage(day,calls) SELECT ?,1 WHERE ?>0 ON CONFLICT(day) DO UPDATE SET calls=calls+1 WHERE calls<? RETURNING calls",
    )
    .bind(jstDay(Date.now()), limit, limit)
    .first();
}

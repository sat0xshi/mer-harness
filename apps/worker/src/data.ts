import type { GameEvent, Item } from "@mer/core";
export interface ItemRow extends Omit<Item, "answers" | "comps" | "photos"> {
  answers_json: string;
  comps_json: string;
}
export const decodeItem = (r: ItemRow): Item => {
  const { answers_json, comps_json, ...rest } = r;
  return { ...rest, answers: JSON.parse(answers_json), comps: JSON.parse(comps_json), photos: [] };
};
export async function getItem(db: D1Database, id: string) {
  const r = await db.prepare("SELECT * FROM items WHERE id=?").bind(id).first<ItemRow>();
  if (!r) return null;
  const item = decodeItem(r);
  item.photos = (
    await db
      .prepare("SELECT id,position FROM photos WHERE item_id=? ORDER BY position,created_at")
      .bind(id)
      .all<{ id: string; position: number }>()
  ).results;
  return item;
}
export async function getEvents(db: D1Database): Promise<GameEvent[]> {
  const rows = await db
    .prepare("SELECT * FROM events ORDER BY created_at,id")
    .all<Omit<GameEvent, "meta"> & { meta_json: string }>();
  return rows.results.map(({ meta_json, ...e }) => ({ ...e, meta: JSON.parse(meta_json) }));
}
export function eventStatement(
  db: D1Database,
  event: Omit<GameEvent, "id" | "rule_version">,
  op?: string,
) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO events(id,key,type,item_id,xp,meta_json,day,created_at) SELECT ?,?,?,?,?,?,?,? ${op ? "WHERE EXISTS(SELECT 1 FROM operations WHERE key=?)" : ""}`,
    )
    .bind(
      crypto.randomUUID(),
      event.key,
      event.type,
      event.item_id,
      event.xp,
      JSON.stringify(event.meta),
      event.day,
      event.created_at,
      ...(op ? [op] : []),
    );
}

// Evaluate the daily cap inside the same D1 batch as the mutation, never from a stale read.
export function cappedActionStatement(
  db: D1Database,
  event: Omit<GameEvent, "id" | "rule_version">,
  cap: number,
  from: number,
  until: number,
  op?: string,
) {
  return db
    .prepare(`INSERT OR IGNORE INTO events(id,key,type,item_id,xp,meta_json,day,created_at)
    SELECT ?,?,?,?,CASE WHEN (SELECT count(*) FROM events WHERE item_id=? AND type=? AND xp>0 AND created_at>=? AND created_at<?) < ? THEN ? ELSE 0 END,?,?,?
    WHERE EXISTS(SELECT 1 FROM items WHERE id=? AND status IN ('listed','shelf'))
    ${op ? "AND EXISTS(SELECT 1 FROM operations WHERE key=?)" : ""}`)
    .bind(
      crypto.randomUUID(),
      event.key,
      event.type,
      event.item_id,
      event.item_id,
      event.type,
      from,
      until,
      cap,
      event.xp,
      JSON.stringify(event.meta),
      event.day,
      event.created_at,
      event.item_id,
      ...(op ? [op] : []),
    );
}

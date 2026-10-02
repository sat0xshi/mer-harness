import type { Item } from "@mer/core";

export function isEmptyDraft(item: Item) {
  return (
    item.status === "draft" &&
    !item.photos.length &&
    !Object.values(item.answers).some((answer) => answer.trim()) &&
    !item.title.trim() &&
    !item.description.trim() &&
    !item.price &&
    !item.comps.length
  );
}

export function pickNextDraft(items: Item[]) {
  return items
    .filter((item) => item.status === "draft")
    .sort(
      (a, b) => Number(isEmptyDraft(a)) - Number(isEmptyDraft(b)) || b.updated_at - a.updated_at,
    )[0];
}

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const pendingDraftKey = "harness:pending-draft";
export const activeDraftKey = "harness:active-draft";

// Session storage survives reload and auth remounts without sharing an editing
// session across tabs. In restricted browsers, retain at least in-memory retries.
const memory = new Map<string, string>();
export const draftStorage: DraftStorage = {
  getItem(key) {
    try {
      return sessionStorage.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  setItem(key, value) {
    memory.set(key, value);
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Storage may be disabled or full.
    }
  },
  removeItem(key) {
    memory.delete(key);
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Storage may be disabled.
    }
  },
};

export function rememberDraft(item: Item, storage = draftStorage) {
  storage.setItem(activeDraftKey, item.id);
  if (storage.getItem(pendingDraftKey) === item.id) storage.removeItem(pendingDraftKey);
  return item;
}

export function resumedDraft(items: Item[], storage = draftStorage) {
  const id = storage.getItem(activeDraftKey) || storage.getItem(pendingDraftKey);
  return items.find((item) => item.id === id && ["draft", "shelf"].includes(item.status));
}

export async function startDraft(
  items: Item[],
  create: (id: string) => Promise<Item>,
  storage = draftStorage,
) {
  const active = storage.getItem(activeDraftKey);
  // An older /state response can arrive after creation finished in a previous
  // mount. Retry the remembered id even if that snapshot does not contain it.
  const pending =
    storage.getItem(pendingDraftKey) ||
    (active && !items.some((item) => item.id === active) ? active : null);
  const existing = resumedDraft(items, storage) || pickNextDraft(items.filter(isEmptyDraft));
  if (existing && !pending) return rememberDraft(existing, storage);
  // Persist before the request: an interrupted/lost response retries this id.
  const id = pending || existing?.id || crypto.randomUUID();
  storage.setItem(pendingDraftKey, id);
  const item = items.find((item) => item.id === id) || (await create(id));
  return rememberDraft(item, storage);
}

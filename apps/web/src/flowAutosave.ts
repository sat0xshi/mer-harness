import type { Item } from "@mer/core";
import { ApiError, api, json } from "./api";
import { AutosaveQueue, type Checkpoint, editInput } from "./autosave";
import { draftStorage } from "./drafts";
import { t } from "./i18n/ja";

// Keep one writer per item even when auth unmounts/remounts the flow while a
// keepalive request is still running. Only unsaved text is persisted, no images.
const queues = new Map<string, AutosaveQueue>();
export function flowAutosave(initial: Item) {
  const existing = queues.get(initial.id);
  if (existing) return existing;
  const storageKey = `harness:edits:${initial.id}`;
  let checkpoint: Checkpoint | undefined;
  try {
    const saved = JSON.parse(draftStorage.getItem(storageKey) || "null") as Checkpoint | null;
    if (saved?.base.id === initial.id && saved.local.id === initial.id) checkpoint = saved;
  } catch {
    // Ignore unreadable session data; the server copy is still available.
  }
  const queue = new AutosaveQueue(
    initial,
    {
      save: (item, { finish, keepalive, key }) =>
        api<Item>(`/items/${item.id}`, {
          ...json({ ...editInput(item), version: item.version, finish }, "PUT", key),
          keepalive,
        }),
      refetch: async () => {
        const state = await api<{ items: Item[] }>("/state");
        const item = state.items.find((item) => item.id === initial.id);
        if (!item) throw Error(t("apiError8"));
        return item;
      },
      isConflict: (error) =>
        error instanceof ApiError &&
        error.status === 409 &&
        ["apiError9", "apiError10"].includes(String(error.code)),
      conflictMessage: t("autosaveConflict"),
      persist: (value) => {
        if (value) draftStorage.setItem(storageKey, JSON.stringify(value));
        else draftStorage.removeItem(storageKey);
      },
    },
    checkpoint,
  );
  queues.set(initial.id, queue);
  return queue;
}

export function releaseAutosave(queue: AutosaveQueue) {
  // Defer eviction until the writer has stopped. A remount can reuse it in the
  // meantime; callers verify their subscription is still detached.
  if (queues.get(queue.item.id) === queue) queues.delete(queue.item.id);
}

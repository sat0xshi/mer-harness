import { buildListing, type Item } from "@mer/core";

import { isCustomText, syncTemplateText } from "./listingText";

const fields = ["category", "price", "shipping", "comps"] as const;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const editInput = (item: Item) => ({
  category: item.category,
  answers: item.answers,
  price: item.price,
  shipping: item.shipping,
  comps: item.comps,
  ...(isCustomText(item) ? { title: item.title, description: item.description } : {}),
});

// Three-way merge: only locally changed fields override the server. Answers
// merge per question; deletions and edits made during a request are preserved.
export function mergeEdits(base: Item, local: Item, server: Item): Item {
  const merged = { ...server, answers: { ...server.answers } };
  for (const field of fields) {
    if (!equal(base[field], local[field])) Object.assign(merged, { [field]: local[field] });
  }
  for (const key of new Set([...Object.keys(base.answers), ...Object.keys(local.answers)])) {
    if (base.answers[key] !== local.answers[key]) {
      if (local.answers[key] === undefined) delete merged.answers[key];
      else merged.answers[key] = local.answers[key];
    }
  }
  for (const field of ["title", "description"] as const) {
    if ((isCustomText(base) || isCustomText(local)) && base[field] !== local[field])
      merged[field] = local[field];
  }
  if (!isCustomText(local) && !isCustomText(server)) {
    const { title, description } = buildListing(merged.category, merged.answers, merged.platform);
    Object.assign(merged, { title, description });
  }
  return merged;
}

export interface Checkpoint {
  base: Item;
  local: Item;
}
interface SaveOptions {
  finish: boolean;
  keepalive: boolean;
  key: string;
}
interface Dependencies {
  save: (item: Item, options: SaveOptions) => Promise<Item>;
  refetch: () => Promise<Item>;
  isConflict: (error: unknown) => boolean;
  conflictMessage: string;
  persist?: (checkpoint: Checkpoint | null) => void;
}

export class AutosaveQueue {
  private base: Item;
  private local: Item;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<Item>;
  private finish = false;
  private keepalive = false;
  private photoRevision = 0;
  private listeners = new Set<() => void>();
  error = "";

  constructor(
    initial: Item,
    private dependencies: Dependencies,
    checkpoint?: Checkpoint,
  ) {
    this.base = initial;
    this.local = checkpoint ? mergeEdits(checkpoint.base, checkpoint.local, initial) : initial;
  }
  get item() {
    return this.local;
  }
  get dirty() {
    return !equal(editInput(this.base), editInput(this.local));
  }
  get observed() {
    return this.listeners.size > 0;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish() {
    this.dependencies.persist?.(this.dirty ? { base: this.base, local: this.local } : null);
    for (const listener of this.listeners) listener();
  }
  edit(update: Item | ((item: Item) => Item), options: { preserveText?: boolean } = {}) {
    const next = typeof update === "function" ? update(this.local) : update;
    this.local = options.preserveText ? next : syncTemplateText(this.local, next);
    this.publish();
    this.schedule();
  }
  photos(photos: Item["photos"], updatedAt = this.local.updated_at) {
    this.photoRevision++;
    this.local = { ...this.local, photos, updated_at: updatedAt };
    this.base = { ...this.base, photos, updated_at: updatedAt };
    this.publish();
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.dirty)
      this.timer = setTimeout(() => {
        void this.flush().catch(() => {});
      }, 1000);
  }
  flush(finish = false, keepalive = false): Promise<Item> {
    clearTimeout(this.timer);
    this.finish ||= finish;
    this.keepalive ||= keepalive;
    if (this.running) return this.running;
    this.running = this.drain().then(
      () => {
        this.running = undefined;
        const keepalive = this.keepalive;
        this.keepalive = false;
        clearTimeout(this.timer);
        // Edits can arrive after drain resolves but before this microtask.
        return this.dirty || this.finish ? this.flush(false, keepalive) : this.local;
      },
      (error) => {
        this.running = undefined;
        this.keepalive = false;
        clearTimeout(this.timer);
        throw error;
      },
    );
    return this.running;
  }
  private async drain() {
    let retried = false;
    try {
      while (this.dirty || this.finish) {
        const sent = this.local,
          finish = this.finish,
          photos = this.photoRevision;
        this.finish = false;
        let saved: Item;
        try {
          saved = await this.dependencies.save(sent, {
            finish,
            keepalive: this.keepalive,
            key: crypto.randomUUID(),
          });
        } catch (error) {
          if (!this.dependencies.isConflict(error)) throw error;
          if (retried) throw Error(this.dependencies.conflictMessage);
          retried = true;
          const remote = await this.dependencies.refetch();
          const merged = mergeEdits(this.base, this.local, remote);
          // A photo response may have arrived while refetching.
          if (photos !== this.photoRevision) merged.photos = this.local.photos;
          this.local = merged;
          this.base = remote;
          this.finish ||= finish;
          this.publish();
          continue;
        }
        const merged = mergeEdits(sent, this.local, saved);
        if (photos !== this.photoRevision) merged.photos = this.local.photos;
        merged.updated_at = Math.max(merged.updated_at, this.local.updated_at);
        this.base = saved;
        this.local = merged;
        this.error = "";
        this.publish();
      }
      return this.local;
    } catch (error) {
      this.finish = false;
      this.error = (error as Error).message;
      this.publish();
      throw error;
    }
  }
}

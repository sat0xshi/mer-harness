import type { Item } from "@mer/core";
import { describe, expect, it, vi } from "vitest";
import {
  activeDraftKey,
  type DraftStorage,
  isEmptyDraft,
  pendingDraftKey,
  pickNextDraft,
  resumedDraft,
  startDraft,
} from "./drafts";

const draft = (patch: Partial<Item> = {}): Item => ({
  id: "draft",
  category: "phone",
  platform: "mercari",
  status: "draft",
  answers: {},
  title: "",
  description: "",
  price: 0,
  shipping: 750,
  comps: [],
  photos: [],
  version: 0,
  created_at: 1,
  updated_at: 1,
  listed_at: null,
  sold_at: null,
  sold_price: 0,
  shipped_at: null,
  completed_at: null,
  ...patch,
});
const storage = (): DraftStorage => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
};

describe("draft selection and creation", () => {
  it("prefers content, then most recent activity regardless of server order", () => {
    const empty = draft({ id: "empty", updated_at: 500 });
    const older = draft({ id: "old", answers: { model: "Pixel" }, updated_at: 10 });
    const photo = draft({ id: "photo", photos: [{ id: "p", position: 0 }], updated_at: 20 });
    const items = [empty, older, photo, draft({ status: "listed", updated_at: 900 })];
    expect(pickNextDraft(items)).toBe(photo);
    expect(items[0]).toBe(empty);
    expect(pickNextDraft([older, empty])).toBe(older);
    expect(pickNextDraft([draft(), empty])).toBe(empty);
    expect(pickNextDraft([])).toBeUndefined();
  });
  it.each([
    { photos: [{ id: "p", position: 0 }] },
    { answers: { notes: "keep" } },
    { title: "keep" },
    { price: 100 },
    { comps: [{ price: 100, sold: true }] },
    { status: "shelf" as const },
  ])("never hides or reuses content: %j", (patch) => {
    expect(isEmptyDraft(draft(patch))).toBe(false);
  });
  it("ignores whitespace answers", () => {
    expect(isEmptyDraft(draft({ answers: { model: "  " } }))).toBe(true);
  });
  it("reuses an empty draft without POST", async () => {
    const create = vi.fn(),
      session = storage(),
      empty = draft();
    expect(await startDraft([empty], create, session)).toBe(empty);
    expect(create).not.toHaveBeenCalled();
    expect(resumedDraft([empty], session)).toBe(empty);
  });
  it("keeps an interrupted creation id across retries/remounts", async () => {
    const session = storage();
    const create = vi
      .fn()
      .mockRejectedValueOnce(Error("lost response"))
      .mockImplementationOnce(async (id) => draft({ id }));
    await expect(startDraft([], create, session)).rejects.toThrow("lost response");
    const id = session.getItem(pendingDraftKey);
    expect(id).toBeTruthy();
    const item = await startDraft([], create, session);
    expect(item.id).toBe(id);
    expect(create.mock.calls.map(([id]) => id)).toEqual([id, id]);
    expect(session.getItem(pendingDraftKey)).toBeNull();
    expect(session.getItem(activeDraftKey)).toBe(id);
  });
  it("concurrent starts use one id and active flows resume with their photos", async () => {
    const session = storage();
    const create = vi.fn(async (id: string) => draft({ id, photos: [{ id: "p", position: 0 }] }));
    const [a, b] = await Promise.all([
      startDraft([], create, session),
      startDraft([], create, session),
    ]);
    expect(a.id).toBe(b.id);
    const resumed = await startDraft([a], create, session);
    expect(resumed).toBe(a);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it("recovers a committed POST whose response was lost without another POST", async () => {
    const session = storage(),
      create = vi.fn();
    session.setItem(pendingDraftKey, "committed");
    const committed = draft({ id: "committed" });
    expect(resumedDraft([committed], session)).toBe(committed);
    expect(await startDraft([committed], create, session)).toBe(committed);
    expect(create).not.toHaveBeenCalled();
  });
  it("retries the active id when a remount receives a stale state snapshot", async () => {
    const session = storage();
    const create = vi.fn(async (id: string) => draft({ id }));
    const opened = await startDraft([], create, session);
    const resumed = await startDraft([], create, session);
    expect(resumed.id).toBe(opened.id);
    expect(create.mock.calls.map(([id]) => id)).toEqual([opened.id, opened.id]);
  });
  it("an explicit new listing after exit does not reuse an unrelated content draft", async () => {
    const create = vi.fn(async (id: string) => draft({ id }));
    const item = await startDraft([draft({ title: "other item" })], create, storage());
    expect(create).toHaveBeenCalledOnce();
    expect(item.id).not.toBe("draft");
  });
});

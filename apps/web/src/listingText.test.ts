import { buildListing, type Item } from "@mer/core";
import { describe, expect, it } from "vitest";
import { AutosaveQueue, editInput, mergeEdits } from "./autosave";
import { isCustomText, listingText, syncTemplateText } from "./listingText";

const item: Item = {
  id: "test",
  category: "gadget",
  platform: "mercari",
  status: "draft",
  answers: { model: "Camera" },
  ...buildListing("gadget", { model: "Camera" }),
  price: 1000,
  shipping: 750,
  comps: [],
  photos: [],
  version: 0,
  listed_at: null,
  sold_at: null,
  shipped_at: null,
  completed_at: null,
  sold_price: 0,
  created_at: 0,
  updated_at: 0,
};
describe("custom listing text", () => {
  it("omits template fields from PUT and includes both fields when either is custom", () => {
    expect(isCustomText(item)).toBe(false);
    expect(editInput(item)).not.toHaveProperty("title");
    expect(editInput(item)).not.toHaveProperty("description");
    for (const patch of [{ title: "Edited" }, { description: "Edited" }, { title: "" }]) {
      const custom = { ...item, ...patch };
      expect(isCustomText(custom)).toBe(true);
      expect(editInput(custom)).toMatchObject({
        title: custom.title,
        description: custom.description,
      });
      expect(listingText(custom)).toEqual({ title: custom.title, description: custom.description });
    }
  });
  it("updates template text with answers but preserves custom text", () => {
    const next = { ...item, answers: { model: "New" } };
    const synced = syncTemplateText(item, next);
    expect(synced).toMatchObject(buildListing("gadget", next.answers));
    expect(isCustomText(synced)).toBe(false);
    const custom = { ...item, title: "Custom" };
    expect(syncTemplateText(custom, { ...custom, answers: next.answers }).title).toBe("Custom");
  });
  it("merges title and description independently and rebuilds merged template answers", () => {
    const local = { ...item, title: "Local" };
    const remote = { ...item, description: "Remote", version: 2 };
    expect(mergeEdits(item, local, remote)).toMatchObject({
      title: "Local",
      description: "Remote",
      version: 2,
    });
    const answerEdit = syncTemplateText(item, {
      ...item,
      answers: { ...item.answers, color: "黒" },
    });
    const server = syncTemplateText(item, {
      ...item,
      answers: { ...item.answers, brand: "Brand" },
    });
    const merged = mergeEdits(item, answerEdit, server);
    expect(merged.answers).toEqual({ model: "Camera", color: "黒", brand: "Brand" });
    expect(isCustomText(merged)).toBe(false);
    expect(mergeEdits(item, answerEdit, remote).description).toBe("Remote");
  });
  it("preserves an explicit draft even when it repeats the old template while filling answers", async () => {
    const queue = new AutosaveQueue(item, {
      save: async (sent) => ({ ...sent, version: sent.version + 1 }),
      refetch: async () => item,
      isConflict: () => false,
      conflictMessage: "conflict",
    });
    queue.edit(
      (current) => ({
        ...current,
        answers: { ...current.answers, color: "黒" },
        title: item.title,
        description: item.description,
      }),
      { preserveText: true },
    );
    await queue.flush();
    expect(queue.item).toMatchObject({
      title: item.title,
      description: item.description,
      answers: { color: "黒" },
    });
    expect(isCustomText(queue.item)).toBe(true);
  });
  it("keeps custom text during an in-flight save and sends the later edit", async () => {
    let resolve!: (item: Item) => void;
    const requests: ReturnType<typeof editInput>[] = [];
    const queue = new AutosaveQueue(item, {
      save: async (sent) => {
        requests.push(editInput(sent));
        if (requests.length === 1)
          return new Promise<Item>((done) => {
            resolve = done;
          });
        return { ...sent, version: sent.version + 1 };
      },
      refetch: async () => item,
      isConflict: () => false,
      conflictMessage: "conflict",
    });
    queue.edit((current) => ({ ...current, title: "AI draft", description: "AI description" }));
    const flushing = queue.flush();
    const sent = queue.item;
    queue.edit((current) => ({ ...current, description: "User edit" }));
    resolve({ ...sent, version: 1 });
    await flushing;
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ title: "AI draft", description: "User edit" });
    expect(queue.dirty).toBe(false);
  });
});

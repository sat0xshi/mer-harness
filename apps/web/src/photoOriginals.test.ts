import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe("local photo originals", () => {
  it("retains both blobs and toggle state without IndexedDB, deletes, and drops oldest entries", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const store = await import("./photoOriginals");
    const original = new Blob(["original"]),
      enhancedBlob = new Blob(["enhanced"]);
    const listener = vi.fn(),
      unsubscribe = store.subscribeOriginals(listener);
    await store.setPhotoOriginal("first", { original, enhancedBlob, enhanced: true });
    expect(store.getPhotoOriginal("first")).toMatchObject({
      original,
      enhancedBlob,
      enhanced: true,
    });
    await store.setPhotoOriginal("first", { original, enhancedBlob, enhanced: false });
    expect(store.getPhotoOriginal("first")?.enhanced).toBe(false);
    for (let n = 0; n < store.maxOriginals; n++)
      await store.setPhotoOriginal(`photo-${n}`, { original, enhancedBlob, enhanced: true });
    expect(store.getPhotoOriginal("first")).toBeUndefined();
    expect(store.getPhotoOriginal("photo-0")).toBeDefined();
    await store.deletePhotoOriginal("photo-0");
    expect(store.getPhotoOriginal("photo-0")).toBeUndefined();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
  it("silently tolerates browsers denying IndexedDB access", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("denied");
      },
    });
    const store = await import("./photoOriginals");
    await store.setPhotoOriginal("photo", {
      original: new Blob(),
      enhancedBlob: new Blob(),
      enhanced: true,
    });
    expect(store.getPhotoOriginal("photo")?.enhanced).toBe(true);
    await store.deletePhotoOriginal("photo");
    expect(store.getPhotoOriginal("photo")).toBeUndefined();
  });
});

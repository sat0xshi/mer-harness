import type { Item } from "@mer/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { AutosaveQueue, type Checkpoint, mergeEdits } from "./autosave";
import { draftStorage } from "./drafts";
import { flowAutosave, releaseAutosave } from "./flowAutosave";

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
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const saved = (item: Item) => ({ ...item, version: item.version + 1 });
function setup(initial = draft()) {
  const save = vi.fn(async (item: Item) => saved(item));
  const refetch = vi.fn(async () => initial);
  const persist = vi.fn();
  const queue = new AutosaveQueue(initial, {
    save,
    refetch,
    persist,
    isConflict: (error) => error instanceof ApiError && error.status === 409,
    conflictMessage: "conflict",
  });
  return { queue, save, refetch, persist };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("serialized draft autosave", () => {
  it("keeps edits queued just as an idle flush completes", async () => {
    vi.useFakeTimers();
    const { queue, save } = setup();
    const flushing = queue.flush();
    queue.edit((item) => ({ ...item, answers: { model: "late edit" } }));
    await flushing;
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledOnce();
    expect(queue.dirty).toBe(false);
  });
  it("debounces edits for one second and never finishes automatically", async () => {
    vi.useFakeTimers();
    const { queue, save } = setup();
    queue.edit((item) => ({ ...item, answers: { model: "P" } }));
    await vi.advanceTimersByTimeAsync(800);
    expect(save).not.toHaveBeenCalled();
    queue.edit((item) => ({ ...item, answers: { model: "Pixel" } }));
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ answers: { model: "Pixel" } }),
      expect.objectContaining({ finish: false }),
    );
    expect(queue.dirty).toBe(false);
  });
  it("serializes overlapping flushes, queues latest edits and uses the returned version", async () => {
    const { queue, save } = setup();
    const first = deferred<Item>(),
      second = deferred<Item>();
    save.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    queue.edit((item) => ({ ...item, answers: { model: "P" } }));
    const flushing = queue.flush();
    queue.edit((item) => ({ ...item, answers: { model: "Pixel", color: "black" }, price: 500 }));
    expect(queue.flush()).toBe(flushing);
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve(saved(save.mock.calls[0][0]));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(queue.item.answers).toEqual({ model: "Pixel", color: "black" });
    expect(save.mock.calls[1][0]).toMatchObject({
      version: 1,
      price: 500,
      answers: queue.item.answers,
    });
    second.resolve(saved(save.mock.calls[1][0]));
    await flushing;
    expect(queue.item.version).toBe(2);
    expect(queue.dirty).toBe(false);
    const options = save.mock.calls as unknown as [Item, { key: string }][];
    expect(options[0][1].key).not.toBe(options[1][1].key);
  });
  it.each(["apiError9", "apiError10"])(
    "refetches and rebases local edits once after %s",
    async (code) => {
      const { queue, save, refetch } = setup(draft({ answers: { model: "old" } }));
      save.mockRejectedValueOnce(new ApiError(409, code));
      refetch.mockResolvedValue(
        draft({ version: 4, answers: { model: "remote", color: "black" }, price: 700 }),
      );
      queue.edit((item) => ({ ...item, answers: { model: "local" } }));
      await queue.flush();
      expect(refetch).toHaveBeenCalledOnce();
      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls[1][0]).toMatchObject({
        version: 4,
        answers: { model: "local", color: "black" },
        price: 700,
      });
      expect(queue.item.version).toBe(5);
    },
  );
  it("preserves edits made during the conflict refetch", async () => {
    const { queue, save, refetch } = setup();
    const remote = deferred<Item>();
    save.mockRejectedValueOnce(new ApiError(409, "apiError9"));
    refetch.mockReturnValueOnce(remote.promise);
    queue.edit((item) => ({ ...item, answers: { model: "first" } }));
    const flushing = queue.flush();
    await vi.waitFor(() => expect(refetch).toHaveBeenCalledOnce());
    queue.edit((item) => ({ ...item, answers: { model: "latest" }, shipping: 200 }));
    remote.resolve(draft({ version: 2, answers: { color: "black" } }));
    await flushing;
    expect(save.mock.calls[1][0]).toMatchObject({
      version: 2,
      shipping: 200,
      answers: { model: "latest", color: "black" },
    });
  });
  it("stops after a second conflict, retains edits, and supports an explicit retry", async () => {
    vi.useFakeTimers();
    const { queue, save, refetch, persist } = setup();
    save.mockRejectedValue(new ApiError(409, "apiError10"));
    refetch.mockResolvedValue(draft({ version: 2 }));
    queue.edit((item) => ({ ...item, answers: { model: "keep" } }));
    await expect(queue.flush()).rejects.toThrow("conflict");
    await vi.advanceTimersByTimeAsync(10000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(refetch).toHaveBeenCalledOnce();
    expect(queue.item.answers.model).toBe("keep");
    expect(queue.error).toBe("conflict");
    expect(queue.dirty).toBe(true);
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ local: queue.item }));
    save.mockImplementation(async (item) => saved(item));
    await queue.flush();
    expect(queue.error).toBe("");
    expect(persist).toHaveBeenLastCalledWith(null);
  });
  it("does not retry network/auth failures automatically", async () => {
    vi.useFakeTimers();
    const { queue, save, refetch } = setup();
    save.mockRejectedValue(new ApiError(401, "apiError1"));
    queue.edit((item) => ({ ...item, price: 500 }));
    await vi.advanceTimersByTimeAsync(10000);
    expect(save).toHaveBeenCalledOnce();
    expect(refetch).not.toHaveBeenCalled();
    expect(queue.dirty).toBe(true);
  });
  it("flushes before debounce with keepalive and shares the writer with explicit finish", async () => {
    vi.useFakeTimers();
    const { queue, save } = setup();
    const first = deferred<Item>();
    save.mockImplementationOnce(() => first.promise);
    queue.edit((item) => ({ ...item, answers: { model: "Pixel" } }));
    const hidden = queue.flush(false, true);
    const finish = queue.flush(true);
    expect(finish).toBe(hidden);
    expect(save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ finish: false, keepalive: true }),
    );
    first.resolve(saved(save.mock.calls[0][0]));
    await finish;
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: 1 }),
      expect.objectContaining({ finish: true }),
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("does not overwrite concurrent photo changes with a stale PUT response", async () => {
    const { queue, save } = setup();
    const response = deferred<Item>();
    save.mockImplementationOnce(() => response.promise);
    queue.edit((item) => ({ ...item, price: 500 }));
    const flushing = queue.flush();
    queue.photos([{ id: "new-photo", position: 0 }], 50);
    response.resolve(saved(save.mock.calls[0][0]));
    await flushing;
    expect(queue.item.photos).toEqual([{ id: "new-photo", position: 0 }]);
    expect(queue.item.updated_at).toBe(50);
    expect(queue.dirty).toBe(false);
  });
  it("restores unsaved fields over a newer server copy after reload", async () => {
    const base = draft({ answers: { model: "old", color: "white" } });
    const local = { ...base, answers: { model: "local" }, comps: [{ price: 500, sold: true }] };
    const server = draft({
      version: 3,
      price: 800,
      answers: { model: "remote", color: "black", notes: "remote note" },
    });
    const save = vi.fn(async (item: Item) => saved(item));
    const queue = new AutosaveQueue(
      server,
      {
        save,
        refetch: async () => server,
        isConflict: () => false,
        conflictMessage: "conflict",
      },
      { base, local },
    );
    expect(queue.item).toMatchObject({
      version: 3,
      price: 800,
      answers: { model: "local", notes: "remote note" },
      comps: local.comps,
    });
    expect(queue.item.answers.color).toBeUndefined();
    await queue.flush();
    expect(save).toHaveBeenCalledOnce();
  });
  it("preserves a local reversal to the baseline while a save is in flight", () => {
    const base = draft(),
      sent = draft({ price: 500 });
    expect(mergeEdits(sent, base, saved(sent)).price).toBe(0);
  });
});

describe("flow save adapter", () => {
  it("shares an in-flight writer on auth remount and persists/recovers pending edits", async () => {
    const initial = draft({ id: "adapter" });
    const response = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(response.promise);
    vi.stubGlobal("fetch", fetch);
    const queue = flowAutosave(initial);
    queue.edit((item) => ({ ...item, answers: { model: "keep" } }));
    const checkpoint = JSON.parse(
      draftStorage.getItem("harness:edits:adapter") || "null",
    ) as Checkpoint;
    expect(checkpoint.local.answers.model).toBe("keep");
    const flushing = queue.flush(false, true);
    expect(flowAutosave(initial)).toBe(queue);
    expect(fetch).toHaveBeenCalledOnce();
    const options = fetch.mock.calls[0][1] as RequestInit;
    expect(options.keepalive).toBe(true);
    expect(JSON.parse(String(options.body))).toMatchObject({
      version: 0,
      finish: false,
      answers: { model: "keep" },
    });
    response.resolve(Response.json(saved(queue.item)));
    await flushing;
    expect(draftStorage.getItem("harness:edits:adapter")).toBeNull();
    releaseAutosave(queue);
    draftStorage.setItem("harness:edits:adapter", JSON.stringify(checkpoint));
    const restored = flowAutosave({ ...initial, version: 4, price: 500 });
    expect(restored.item).toMatchObject({ version: 4, price: 500, answers: { model: "keep" } });
    releaseAutosave(restored);
    draftStorage.removeItem("harness:edits:adapter");
  });
});

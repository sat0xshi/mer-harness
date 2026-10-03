import { describe, expect, it, vi } from "vitest";
import {
  clearUserKey,
  maskKey,
  readUserKey,
  saveUserKey,
  userKeyHeaders,
  userKeyStorageKey,
} from "./userKey";

const key = "AIzaUSERKEY_1234567890abcdefWXYZ";
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => {
      values.set(name, value);
    },
    removeItem: (name: string) => {
      values.delete(name);
    },
  };
}
describe("user key", () => {
  it("stores a trimmed valid key, masks it and deletes it", () => {
    const store = storage();
    expect(readUserKey(store)).toBeNull();
    expect(saveUserKey(store, `  ${key}\n`)).toBe(true);
    expect(store.getItem(userKeyStorageKey)).toBe(key);
    expect(readUserKey(store)).toBe(key);
    expect(maskKey(key)).toBe("••••WXYZ");
    expect(maskKey("abc")).not.toContain("abc");
    expect(clearUserKey(store)).toBe(true);
    expect(readUserKey(store)).toBeNull();
  });
  it.each(["", "short", "a".repeat(129), `${key}!`, `a b${key}`])(
    "rejects malformed keys: %s",
    (invalid) => {
      const store = storage();
      expect(saveUserKey(store, invalid)).toBe(false);
      store.setItem(userKeyStorageKey, invalid);
      expect(readUserKey(store)).toBeNull();
    },
  );
  it("handles unavailable storage", () => {
    const fail = () => {
      throw Error("blocked");
    };
    expect(readUserKey({ getItem: fail })).toBeNull();
    expect(saveUserKey({ setItem: fail }, key)).toBe(false);
    expect(clearUserKey({ removeItem: fail })).toBe(false);
  });
  it("only sends the key to the two explicitly allowed POST endpoints", () => {
    const store = storage();
    saveUserKey(store, key);
    for (const path of ["/ai/listing", "/ai/key-test"]) {
      expect(userKeyHeaders(store, path, "POST")).toEqual({ "X-User-Gemini-Key": key });
      expect(userKeyHeaders(store, path, "GET")).toEqual({});
    }
    const getItem = vi.fn(store.getItem);
    for (const path of [
      "/settings",
      "/state",
      "/items",
      "/ai/photo",
      "/ai/prices",
      "/ai/listing?x=1",
      "https://example.com/ai/listing",
    ])
      expect(userKeyHeaders({ getItem }, path, "POST")).toEqual({});
    expect(getItem).not.toHaveBeenCalled();
    clearUserKey(store);
    expect(userKeyHeaders(store, "/ai/listing", "POST")).toEqual({});
  });
});

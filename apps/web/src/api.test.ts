import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { ja } from "./i18n/ja";

afterEach(() => vi.unstubAllGlobals());

describe("API error boundary", () => {
  it.each([
    "/state",
    "/items/item/status",
    "/auth/google",
    "/ai/photo",
    "/ai/prices",
    "/items/item/photos/photo",
  ])("localizes errors from %s before callers store them", async (path) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "apiError4" }, { status: 400 })),
    );
    await expect(api(path)).rejects.toThrow(ja.apiError4);
  });
  it.each([{ error: "apiError999" }, {}, null])(
    "handles unknown or missing error codes: %j",
    async (body) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body, { status: 500 })));
      await expect(api("/state")).rejects.toThrow(ja.apiErrorUnknown);
    },
  );
  it("localizes apiError1 while preserving the auth-expired event", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "apiError1" }, { status: 401 })),
    );
    await expect(api("/state")).rejects.toThrow(ja.apiError1);
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "auth-expired" }));
  });
});

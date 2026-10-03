import { afterEach, describe, expect, it, vi } from "vitest";
import app from "./index";

const key = "AIzaUSERKEY_1234567890abcdefWXYZ";
const prepare = vi.fn(() => {
  throw Error("Key test must never access D1");
});
const env = {
  APP_ENV: "development",
  DEV_AUTH_BYPASS: "1",
  GEMINI_API_KEY: "unused-server-key",
  DB: { prepare },
  AI_DAILY_LIMIT: "0",
};
const request = (userKey: string | undefined = key, path = "/api/ai/key-test") =>
  app.request(
    `http://localhost${path}`,
    {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        ...(userKey === undefined ? {} : { "X-User-Gemini-Key": userKey }),
      },
    },
    env as never,
  );
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("key test HTTP route without D1", () => {
  it.each([
    [200, "ignored", { ok: true }],
    [400, "API_KEY_INVALID", { ok: false, code: "invalid-key" }],
    [400, "bad request", { ok: false, code: "error" }],
    [401, "", { ok: false, code: "invalid-key" }],
    [403, "", { ok: false, code: "invalid-key" }],
    [429, "", { ok: false, code: "quota" }],
    [402, "", { ok: false, code: "billing" }],
    [503, "", { ok: false, code: "error" }],
  ] as const)("maps upstream %s without leaking its body", async (status, body, expected) => {
    const fetch = vi.fn().mockResolvedValue(new Response(`${body} ${key}`, { status }));
    vi.stubGlobal("fetch", fetch);
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).not.toContain(key);
    expect(init.headers).toEqual({ "x-goog-api-key": key, "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      contents: [{ parts: [{ text: "ok" }] }],
      generationConfig: { maxOutputTokens: 1, thinkingConfig: { thinkingLevel: "LOW" } },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each([Error(key), new DOMException(key, "TimeoutError")])(
    "handles fetch failures safely",
    async (error) => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
      const response = await request();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: false, code: "network" });
      expect(prepare).not.toHaveBeenCalled();
    },
  );
  it.each(["", "bad!", "a".repeat(129)])(
    "rejects malformed headers before accessing D1 or fetch: %s",
    async (invalid) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      for (const path of ["/api/ai/key-test", "/api/ai/listing"]) {
        const response = await request(invalid, path);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "apiError23" });
      }
      expect(fetch).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
    },
  );
  it("requires a user key even when the server has one", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await app.request(
      "http://localhost/api/ai/key-test",
      { method: "POST", headers: { Origin: "http://localhost" } },
      env as never,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "apiError23" });
    expect(fetch).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
});

import { readFileSync } from "node:fs";
import {
  bossConfig,
  calendar,
  caps,
  copyBoosters,
  dailyQuests,
  type GameEvent,
  type Item,
  XP,
} from "@mer/core";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate, devBypass } from "./auth";
import { getEvents } from "./data";
import { jstDay } from "./day";
import app from "./index";
import { jpegDimensions } from "./validation";

let mf: Miniflare, db: D1Database;
const env = {
  APP_ENV: "development",
  DEV_AUTH_BYPASS: "1",
  AI_ENABLED: "0",
  AI_DAILY_LIMIT: "2",
  ACCESS_TEAM_DOMAIN: "",
  ACCESS_AUD: "",
  OWNER_EMAIL: "",
  ASSETS: { fetch: () => new Response("shell") },
};
const id = crypto.randomUUID();
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  key = crypto.randomUUID(),
  origin = "http://localhost",
) {
  return app.request(
    `http://localhost/api${path}`,
    {
      method,
      headers: {
        Origin: origin,
        "Content-Type": body instanceof Uint8Array ? "image/jpeg" : "application/json",
        "Idempotency-Key": key,
      },
      body:
        body instanceof Uint8Array
          ? new Uint8Array(body).buffer
          : body
            ? JSON.stringify(body)
            : undefined,
    },
    { ...env, DB: db } as never,
  );
}
// Minimal JPEG SOF for validation tests; browser tests use actual Canvas JPEGs.
const image = new Uint8Array([
  255, 216, 255, 192, 0, 17, 8, 0, 1, 0, 1, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 218, 0, 2, 255,
  217,
]);
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: ["DB"],
      compatibilityDate: "2026-10-02",
    }),
  );
  db = (await mf.getD1Database("DB")) as unknown as D1Database;
  const migration = ["0001_init.sql", "0002_platform.sql"]
    .map((file) => readFileSync(`migrations/${file}`, "utf8"))
    .join("\n");
  for (const statement of migration.split(/;\s*\n/).filter(Boolean)) {
    await db.prepare(statement.trim().replace(/;$/, "")).run();
  }
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
describe("local D1 API", () => {
  it("reuses the client id without replacing an existing item", async () => {
    const itemId = crypto.randomUUID();
    const first = await request("/items", "POST", { id: itemId, category: "phone" });
    const original = (await first.json()) as Item;
    const second = await request("/items", "POST", { id: itemId, category: "other" });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(original);
    expect(
      await db.prepare("SELECT count(*) AS n FROM items WHERE id=?").bind(itemId).first(),
    ).toEqual({ n: 1 });
  });
  it("photo activity updates ordering without invalidating the edit version", async () => {
    const itemId = crypto.randomUUID(),
      photoId = crypto.randomUUID();
    const created = (await (
      await request("/items", "POST", {
        id: itemId,
        category: "phone",
      })
    ).json()) as Item;
    const read = async () => {
      const state = (await (await request("/state")).json()) as { items: Item[] };
      return state.items.find((item) => item.id === itemId) as Item;
    };
    await db.prepare("UPDATE items SET updated_at=1 WHERE id=?").bind(itemId).run();
    expect((await request(`/items/${itemId}/photos/${photoId}`, "POST", image)).status).toBe(200);
    expect((await read()).updated_at).toBeGreaterThan(1);
    expect((await read()).version).toBe(created.version);
    await db.prepare("UPDATE items SET updated_at=2 WHERE id=?").bind(itemId).run();
    expect((await request(`/items/${itemId}/photos/${photoId}`, "DELETE")).status).toBe(200);
    expect((await read()).updated_at).toBeGreaterThan(2);
    expect((await read()).version).toBe(created.version);
    expect((await read()).photos).toEqual([]);
    // A repeated delete is a no-op, not new activity.
    await db.prepare("UPDATE items SET updated_at=3 WHERE id=?").bind(itemId).run();
    await request(`/items/${itemId}/photos/${photoId}`, "DELETE");
    expect((await read()).updated_at).toBe(3);
    await db.prepare("DELETE FROM events WHERE item_id=?").bind(itemId).run();
  });
  it("autosaves with fresh operation keys award each answer once and never finish text", async () => {
    const itemId = crypto.randomUUID();
    await request("/items", "POST", { id: itemId, category: "phone" });
    for (let version = 0; version < 3; version++) {
      expect(
        (
          await request(`/items/${itemId}`, "PUT", {
            version,
            category: "phone",
            answers: { model: `Pixel ${version}` },
            price: 0,
            shipping: 750,
            comps: [],
            finish: false,
          })
        ).status,
      ).toBe(200);
    }
    expect(
      await db
        .prepare(
          "SELECT type,count(*) AS n,sum(xp) AS xp FROM events WHERE item_id=? GROUP BY type",
        )
        .bind(itemId)
        .all(),
    ).toMatchObject({ results: [{ type: "answer", n: 1, xp: 5 }] });
    // Keep the existing suite's global XP assertions isolated.
    await db.prepare("DELETE FROM events WHERE item_id=?").bind(itemId).run();
  });
  it("changes platform and validates against the effective title limit", async () => {
    const itemId = crypto.randomUUID();
    await request("/items", "POST", { id: itemId, category: "other" });
    const body = { version: 0, category: "other", answers: {}, price: 0, shipping: 750, comps: [] };
    const changed = await request(`/items/${itemId}`, "PUT", {
      ...body,
      platform: "yahooFleamarket",
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ platform: "yahooFleamarket", version: 1 });
    const title = "あ".repeat(60);
    const accepted = await request(`/items/${itemId}`, "PUT", { ...body, version: 1, title });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ platform: "yahooFleamarket", title, version: 2 });
    const rejected = await request(`/items/${itemId}`, "PUT", {
      ...body,
      version: 2,
      platform: "mercari",
      title,
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: "apiError4" });
    const unchanged = await db
      .prepare("SELECT platform,title,version FROM items WHERE id=?")
      .bind(itemId)
      .first();
    expect(unchanged).toMatchObject({ platform: "yahooFleamarket", title, version: 2 });
    const truncated = await request(`/items/${itemId}`, "PUT", {
      ...body,
      version: 2,
      platform: "mercari",
      title: title.slice(0, 40),
    });
    expect(truncated.status).toBe(200);
    await db.prepare("DELETE FROM events WHERE item_id=?").bind(itemId).run();
  });
  it("validates sold prices for the stored platform and preserves a zero-price sale", async () => {
    for (const [platform, minPrice] of [
      ["yahooFleamarket", 100],
      ["yahooAuctions", 1],
      ["jmoty", 0],
    ] as const) {
      const itemId = crypto.randomUUID();
      await request("/items", "POST", { id: itemId, category: "other", platform });
      // An existing sale avoids adding global achievement awards to this shared DB.
      // A nonzero listing price also proves an explicit zero is not treated as missing.
      await db
        .prepare("UPDATE items SET status='trading',price=500,sold_price=500 WHERE id=?")
        .bind(itemId)
        .run();
      const invalid = await request(`/items/${itemId}/status`, "POST", {
        version: 0,
        status: "trading",
        soldPrice: minPrice - 1,
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "apiError4" });
      const valid = await request(`/items/${itemId}/status`, "POST", {
        version: 0,
        status: "trading",
        soldPrice: minPrice,
      });
      expect(valid.status).toBe(200);
      expect(await valid.json()).toMatchObject({ item: { sold_price: minPrice } });
      await db.prepare("DELETE FROM events WHERE item_id=?").bind(itemId).run();
    }
  });
  it("persists the default/explicit platform and rejects unregistered platforms", async () => {
    const explicit = await request("/items", "POST", {
      id: crypto.randomUUID(),
      category: "other",
      platform: "mercari",
    });
    expect(((await explicit.json()) as Item).platform).toBe("mercari");
    const fallback = await request("/items", "POST", {
      id: crypto.randomUUID(),
      category: "other",
    });
    expect(((await fallback.json()) as Item).platform).toBe("mercari");
    expect(
      (
        await request("/items", "POST", {
          id: crypto.randomUUID(),
          category: "other",
          platform: "unknown",
        })
      ).status,
    ).toBe(400);
  });
  it("health, JSON 404 and same-origin guard", async () => {
    expect((await request("/health")).status).toBe(200);
    expect((await request("/missing")).status).toBe(404);
    expect((await request("")).status).toBe(404);
    expect(
      (
        await request(
          "/items",
          "POST",
          { id, category: "phone" },
          undefined,
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
  });
  it("creates, saves, rejects stale writes and grants answer XP only once", async () => {
    expect((await request("/items", "POST", { id, category: "phone" })).status).toBe(200);
    const key = crypto.randomUUID(),
      input = {
        version: 0,
        category: "phone",
        answers: { brand: "Google", model: "Pixel 10 Pro Fold", capacity: "512GB" },
        price: 195000,
        shipping: 750,
        comps: [],
        finish: true,
      };
    expect((await request(`/items/${id}`, "PUT", input, key)).status).toBe(200);
    expect((await request(`/items/${id}`, "PUT", input, key)).status).toBe(200);
    expect((await request(`/items/${id}`, "PUT", input)).status).toBe(409);
    const count = await db
      .prepare("SELECT count(*) AS n FROM events WHERE type='answer'")
      .first<{ n: number }>();
    expect(count?.n).toBe(3);
  });
  it("stores private BLOB, enforces ten photos and six XP photos", async () => {
    const photo = crypto.randomUUID();
    expect((await request(`/items/${id}/photos/${photo}`, "POST", image)).status).toBe(200);
    expect((await request(`/items/${id}/photos/${photo}`, "POST", image)).status).toBe(200);
    const fetched = await request(`/photos/${photo}`);
    expect(fetched.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(image);
    for (let i = 1; i < 10; i++)
      expect(
        (await request(`/items/${id}/photos/${crypto.randomUUID()}`, "POST", image)).status,
      ).toBe(200);
    expect(
      (await request(`/items/${id}/photos/${crypto.randomUUID()}`, "POST", image)).status,
    ).toBe(409);
    expect(
      (
        await db
          .prepare("SELECT sum(xp) AS xp FROM events WHERE type='photo'")
          .first<{ xp: number }>()
      )?.xp,
    ).toBe(18);
  });
  it("atomically changes status, retries safely, and undoes without losing XP", async () => {
    const key = crypto.randomUUID();
    const body = { version: 1, status: "listed" };
    expect((await request(`/items/${id}/status`, "POST", body, key)).status).toBe(200);
    expect((await request(`/items/${id}/status`, "POST", body, key)).status).toBe(200);
    expect(
      (
        await db
          .prepare("SELECT count(*) AS n FROM events WHERE type='listed'")
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    expect(
      (await request(`/items/${id}/status`, "POST", { version: 2, status: "listed", undo: key }))
        .status,
    ).toBe(200);
    const item = await db
      .prepare("SELECT status FROM items WHERE id=?")
      .bind(id)
      .first<{ status: string }>();
    expect(item?.status).toBe("draft");
    expect(
      (
        await db
          .prepare("SELECT sum(xp) AS xp FROM events WHERE type='listed'")
          .first<{ xp: number }>()
      )?.xp,
    ).toBe(50);
  });
  it("reverses sales on undo and manual corrections without replaying sold XP", async () => {
    const key = crypto.randomUUID();
    expect(
      (
        await request(
          `/items/${id}/status`,
          "POST",
          { version: 3, status: "trading", soldPrice: 190000 },
          key,
        )
      ).status,
    ).toBe(200);
    const summary = async () =>
      (await (await request("/state")).json()) as { game: { sales: number; xp: number } };
    expect((await summary()).game.sales).toBe(190000);
    const xp = (await summary()).game.xp;
    expect(
      (await request(`/items/${id}/status`, "POST", { version: 4, status: "trading", undo: key }))
        .status,
    ).toBe(200);
    expect((await summary()).game.sales).toBe(0);
    expect((await summary()).game.xp).toBe(xp);
    expect(
      (
        await request(`/items/${id}/status`, "POST", {
          version: 5,
          status: "trading",
          soldPrice: 180000,
        })
      ).status,
    ).toBe(200);
    expect((await summary()).game.sales).toBe(180000);
    expect((await summary()).game.xp).toBe(xp);
  });
  it("only one concurrent edit can commit and earn XP", async () => {
    const input = {
      version: 6,
      category: "phone",
      answers: { model: "Pixel", color: "黒" },
      price: 195000,
      shipping: 750,
      comps: [],
    };
    const result = await Promise.all([
      request(`/items/${id}`, "PUT", input),
      request(`/items/${id}`, "PUT", { ...input, answers: { model: "Pixel", battery: "未確認" } }),
    ]);
    expect(result.map((r) => r.status).sort()).toEqual([200, 409]);
    const answers = await db
      .prepare("SELECT count(*) AS n FROM events WHERE key IN (?,?)")
      .bind(`${id}:answer:color`, `${id}:answer:battery`)
      .first<{ n: number }>();
    expect(answers?.n).toBe(1);
  });
  it("rejects invalid photo formats, huge payloads and invalid settings", async () => {
    expect(jpegDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(
      (await request(`/items/${id}/photos/${crypto.randomUUID()}`, "POST", new Uint8Array(307201)))
        .status,
    ).toBe(400);
    expect((await request("/settings", "PUT", { fee: -2 })).status).toBe(400);
  });
  it("AI disabled leaves the app working", async () => {
    expect((await request("/ai/photo", "POST", image)).status).toBe(503);
    expect((await request("/state")).status).toBe(200);
  });
  it("normalizes AI content parts and logs failures without image data", async () => {
    const run = vi.fn(
      async (): Promise<unknown> => ({
        choices: [
          {
            message: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    category: "Smartphone",
                    brand: "Google",
                    model: "Pixel",
                    color: "黒",
                    flaws: ["小傷", "擦れ"],
                  }),
                },
              ],
            },
          },
        ],
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const call = (kind = "photo") =>
      app.request(
        `http://localhost/api/ai/${kind}`,
        { method: "POST", headers: { Origin: "http://localhost" }, body: image },
        { ...env, DB: db, AI_ENABLED: "1", AI_DAILY_LIMIT: "10", AI: { run } } as never,
      );
    try {
      await db.prepare("DELETE FROM ai_usage").run();
      const success = await call();
      expect(success.status).toBe(200);
      expect(await success.json()).toEqual({
        suggestion: {
          category: "phone",
          brand: "Google",
          model: "Pixel",
          color: "黒",
          flaws: "小傷、擦れ",
        },
      });
      expect(run).toHaveBeenCalledWith(
        "@cf/google/gemma-4-26b-a4b-it",
        expect.objectContaining({
          max_completion_tokens: 1536,
          chat_template_kwargs: { enable_thinking: false },
        }),
      );

      run.mockResolvedValueOnce({
        choices: [
          {
            message: { content: "garbage".repeat(60) },
            finish_reason: "length",
          },
        ],
      });
      const failure = await call();
      expect(failure.status).toBe(502);
      expect(await failure.json()).toEqual({ error: "apiError21" });
      expect(error).toHaveBeenLastCalledWith(
        "ai failure",
        expect.objectContaining({
          kind: "photo",
          stage: "json",
          finishReason: "length",
          sample: "garbage".repeat(60).slice(0, 300),
          error: expect.any(String),
        }),
      );

      const encoded = btoa(String.fromCharCode(...image));
      run.mockResolvedValueOnce({ image: `data:image/jpeg;base64,${encoded}` });
      expect((await call()).status).toBe(502);
      expect(error).toHaveBeenLastCalledWith(
        "ai failure",
        expect.objectContaining({ stage: "shape" }),
      );
      run.mockRejectedValueOnce(new Error(`upstream data:image/jpeg;base64,${encoded}`));
      expect((await call()).status).toBe(502);
      expect(error).toHaveBeenLastCalledWith(
        "ai failure",
        expect.objectContaining({ stage: "ai-call" }),
      );
      expect(JSON.stringify(error.mock.calls)).not.toContain("base64");
      expect(JSON.stringify(error.mock.calls)).not.toContain(encoded);

      run.mockResolvedValueOnce({ response: "{}" });
      expect((await call()).status).toBe(200);
      expect(warn).toHaveBeenLastCalledWith(
        "ai failure",
        expect.objectContaining({ kind: "photo", stage: "empty" }),
      );
      run.mockResolvedValueOnce({ response: '{"prices":["unknown"]}' });
      const empty = await call("prices");
      expect(empty.status).toBe(200);
      expect(await empty.json()).toEqual({ suggestion: { prices: [] } });
      expect(warn).toHaveBeenLastCalledWith(
        "ai failure",
        expect.objectContaining({ kind: "prices", stage: "empty" }),
      );
      expect(run).toHaveBeenCalledTimes(6);
    } finally {
      error.mockRestore();
      warn.mockRestore();
      await db.prepare("DELETE FROM ai_usage").run();
    }
  });
  it("reserves AI calls atomically and does not retry failures", async () => {
    const run = vi.fn(async () => ({
      response: JSON.stringify({
        category: "phone",
        brand: "Google",
        model: "Pixel",
        color: "黒",
        flaws: "不明",
      }),
    }));
    const aiEnv = { ...env, DB: db, AI_ENABLED: "1", AI: { run } };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const call = () =>
      app.request(
        "http://localhost/api/ai/photo",
        { method: "POST", headers: { Origin: "http://localhost" }, body: image },
        aiEnv as never,
      );
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await db.prepare("DELETE FROM ai_usage").run();
      vi.setSystemTime(new Date("2026-10-01T14:59:59.999Z"));
      const results = await Promise.all([call(), call(), call()]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 429]);
      expect(run).toHaveBeenCalledTimes(2);
      expect(await db.prepare("SELECT day, calls FROM ai_usage").all()).toMatchObject({
        results: [{ day: "2026-10-01", calls: 2 }],
      });

      vi.setSystemTime(new Date("2026-10-01T15:00:00.000Z"));
      expect((await call()).status).toBe(200);
      expect(run).toHaveBeenCalledTimes(3);
      expect(await db.prepare("SELECT day, calls FROM ai_usage ORDER BY day").all()).toMatchObject({
        results: [
          { day: "2026-10-01", calls: 2 },
          { day: "2026-10-02", calls: 1 },
        ],
      });
      run.mockRejectedValueOnce(new Error("upstream unavailable"));
      expect((await call()).status).toBe(502);
      expect((await call()).status).toBe(429);
      expect(run).toHaveBeenCalledTimes(4);
      expect(await db.prepare("SELECT calls FROM ai_usage WHERE day='2026-10-02'").first()).toEqual(
        { calls: 2 },
      );
    } finally {
      error.mockRestore();
      vi.useRealTimers();
    }
  });
});
describe("Access security", () => {
  it("dev bypass requires development and loopback", () => {
    expect(devBypass(new Request("https://public.example/api/health"), env)).toBe(false);
    expect(
      devBypass(new Request("http://localhost/api/health"), { ...env, APP_ENV: "production" }),
    ).toBe(false);
  });
  it("fails closed when config or JWT is missing", async () => {
    expect(await authenticate(new Request("https://app.example/api/health"), env)).toBe(false);
  });
  it("validates RS256 issuer, expiry, audience and exact owner", async () => {
    const pair = await generateKeyPair("RS256"),
      jwk = await exportJWK(pair.publicKey);
    jwk.kid = "test";
    jwk.alg = "RS256";
    const domain = "harness-test.cloudflareaccess.com";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const auth = {
      APP_ENV: "staging",
      AUTH_MODE: "access",
      ACCESS_TEAM_DOMAIN: domain,
      ACCESS_AUD: "staging-aud",
      OWNER_EMAIL: "owner@example.com",
    };
    const token = async (
      aud = "staging-aud",
      email = "owner@example.com",
      exp = "1h",
      issuer = `https://${domain}`,
    ) =>
      new SignJWT({ email })
        .setProtectedHeader({ alg: "RS256", kid: "test" })
        .setIssuer(issuer)
        .setAudience(aud)
        .setExpirationTime(exp)
        .sign(pair.privateKey);
    const verify = async (t: string) =>
      authenticate(
        new Request("https://app.example/api/state", { headers: { "Cf-Access-Jwt-Assertion": t } }),
        auth,
      );
    expect(await verify(await token())).toBe(true);
    expect(await verify(await token("prod-aud"))).toBe(false);
    expect(await verify(await token(undefined, "other@example.com"))).toBe(false);
    expect(await verify(await token(undefined, undefined, "-1h"))).toBe(false);
    expect(
      await verify(await token(undefined, undefined, undefined, "https://other.example")),
    ).toBe(false);
    fetchMock.mockRestore();
  });
});

describe("Gemini listing drafts", () => {
  const key = "test-gemini-key-never-log";
  const modelDraft = {
    category: "smartphone",
    brand: " Google ",
    model: 9,
    color: ["黒"],
    flaws: "",
    title: "📱".repeat(45),
    description: "写".repeat(1050),
  };
  const envelope = (text: string, finishReason = "STOP") => ({
    candidates: [
      { finishReason, content: { parts: [{ thought: true, text: "ignore this" }, { text }] } },
    ],
  });
  const call = (itemId: string, overrides: Record<string, unknown> = {}, userKey?: string) =>
    app.request(
      "http://localhost/api/ai/listing",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
          ...(userKey === undefined ? {} : { "X-User-Gemini-Key": userKey }),
        },
        body: JSON.stringify({ id: itemId }),
      },
      { ...env, DB: db, GEMINI_API_KEY: key, AI_DAILY_LIMIT: "30", ...overrides } as never,
    );
  async function create(answers: Record<string, string> = { model: "Camera" }) {
    const itemId = crypto.randomUUID();
    const created = await request("/items", "POST", { id: itemId, category: "gadget" });
    const item = (await created.json()) as Item;
    const saved = await request(`/items/${itemId}`, "PUT", {
      version: item.version,
      category: item.category,
      answers,
      price: item.price,
      shipping: item.shipping,
      comps: item.comps,
    });
    await db.prepare("DELETE FROM events WHERE item_id=?").bind(itemId).run();
    return (await saved.json()) as Item;
  }
  async function isolated(
    run: (fetch: ReturnType<typeof vi.fn>, log: ReturnType<typeof vi.spyOn>) => Promise<void>,
  ) {
    await db.prepare("DELETE FROM ai_usage").run();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await run(fetch, log);
    } finally {
      vi.unstubAllGlobals();
      log.mockRestore();
      warn.mockRestore();
      await db.prepare("DELETE FROM ai_usage").run();
    }
  }
  const userKey = "AIzaUSERKEY_1234567890abcdefWXYZ";
  const usage = async () => (await db.prepare("SELECT * FROM ai_usage ORDER BY day").all()).results;
  it.each([1, 30])(
    "uses only the user key with %s server calls already consumed",
    async (limit) => {
      const item = await create();
      await isolated(async (fetch) => {
        await db
          .prepare("INSERT INTO ai_usage(day,calls) VALUES(?,?)")
          .bind(jstDay(Date.now()), limit)
          .run();
        const before = await usage();
        fetch.mockResolvedValue(Response.json(envelope(JSON.stringify(modelDraft))));
        const response = await call(item.id, { AI_DAILY_LIMIT: String(limit) }, userKey);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ source: "ai", keySource: "user" });
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch.mock.calls[0][1].headers["x-goog-api-key"]).toBe(userKey);
        expect(await usage()).toEqual(before);
      });
    },
  );
  it.each([401, 403, 400, 429, 402, 500, 200, 0])(
    "never retries a failed user key (%s) with server credentials",
    async (status) => {
      const item = await create();
      await isolated(async (fetch) => {
        const before = await usage();
        if (status === 0) fetch.mockRejectedValue(Error(`network ${userKey}`));
        else
          fetch.mockResolvedValue(
            new Response(status === 400 ? "API_KEY_INVALID" : "bad output", { status }),
          );
        const response = await call(item.id, {}, userKey);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          source: "template",
          keySource: "none",
          reason: "user-key-error",
          errorCode:
            status === 0
              ? "network"
              : [400, 401, 403].includes(status)
                ? "invalid-key"
                : status === 429
                  ? "quota"
                  : status === 402
                    ? "billing"
                    : "error",
        });
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch.mock.calls[0][1].headers["x-goog-api-key"]).toBe(userKey);
        expect(await usage()).toEqual(before);
      });
    },
  );
  it.each(["bad-key!", "", "a".repeat(129)])(
    "rejects a malformed user key without echoing it",
    async (invalid) => {
      const item = await create();
      await isolated(async (fetch) => {
        const response = await call(item.id, {}, invalid);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "apiError23" });
        expect(fetch).not.toHaveBeenCalled();
        expect(await usage()).toEqual([]);
      });
    },
  );
  it.each([401, 200, "escaped"] as const)(
    "does not leak an echoed user key through logs, responses or any D1 table (%s)",
    async (status) => {
      const item = await create();
      await isolated(async (fetch, errorLog) => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        try {
          let body = JSON.stringify(envelope(JSON.stringify({ ...modelDraft, title: userKey })));
          if (status === "escaped")
            body = body.replaceAll(
              userKey,
              [...userKey]
                .map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)
                .join(""),
            );
          fetch.mockResolvedValue(
            new Response(body, { status: status === "escaped" ? 200 : status }),
          );
          const response = await call(item.id, {}, userKey);
          const text = await response.text();
          expect(text).not.toContain(userKey);
          expect(JSON.parse(text)).toMatchObject({ reason: "user-key-error" });
          expect(
            JSON.stringify([
              log.mock.calls,
              vi.mocked(console.warn).mock.calls,
              errorLog.mock.calls,
            ]),
          ).not.toContain(userKey);
          const tables = await db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
            )
            .all<{ name: string }>();
          // App tables only; Miniflare's internal _cf_ metadata is not readable.
          expect(tables.results.map(({ name }) => name)).toEqual(
            expect.arrayContaining(["items", "events", "settings", "ai_usage", "operations"]),
          );
          for (const { name } of tables.results) {
            const rows = await db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all();
            expect(JSON.stringify(rows)).not.toContain(userKey);
          }
        } finally {
          log.mockRestore();
        }
      });
    },
  );
  it.each([200, 400, 401, 403, 429, 402, 500, 0])(
    "key-test makes one minimal user-key request (%s), without quota",
    async (status) => {
      await isolated(async (fetch) => {
        await db
          .prepare("INSERT INTO ai_usage(day,calls) VALUES(?,30)")
          .bind(jstDay(Date.now()))
          .run();
        const before = await usage();
        if (status === 0) fetch.mockRejectedValue(Error(userKey));
        else
          fetch.mockResolvedValue(
            new Response(status === 400 ? "API_KEY_INVALID" : userKey, { status }),
          );
        const response = await app.request(
          "http://localhost/api/ai/key-test",
          {
            method: "POST",
            headers: { Origin: "http://localhost", "X-User-Gemini-Key": userKey },
          },
          { ...env, DB: db, GEMINI_API_KEY: key, GEMINI_MODEL: " custom-model " } as never,
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(
          status === 200
            ? { ok: true }
            : {
                ok: false,
                code:
                  status === 0
                    ? "network"
                    : [400, 401, 403].includes(status)
                      ? "invalid-key"
                      : status === 429
                        ? "quota"
                        : status === 402
                          ? "billing"
                          : "error",
              },
        );
        expect(fetch).toHaveBeenCalledOnce();
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe(
          "https://generativelanguage.googleapis.com/v1beta/models/custom-model:generateContent",
        );
        expect(init.headers["x-goog-api-key"]).toBe(userKey);
        expect(JSON.parse(init.body)).toEqual({
          contents: [{ parts: [{ text: "ok" }] }],
          generationConfig: { maxOutputTokens: 1, thinkingConfig: { thinkingLevel: "LOW" } },
        });
        expect(await usage()).toEqual(before);
      });
    },
  );
  it.each([undefined, "", "malformed!"])(
    "key-test rejects missing or malformed headers: %s",
    async (value) => {
      await isolated(async (fetch) => {
        const response = await app.request(
          "http://localhost/api/ai/key-test",
          {
            method: "POST",
            headers: {
              Origin: "http://localhost",
              ...(value === undefined ? {} : { "X-User-Gemini-Key": value }),
            },
          },
          { ...env, DB: db, GEMINI_API_KEY: key } as never,
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "apiError23" });
        expect(fetch).not.toHaveBeenCalled();
        expect(await usage()).toEqual([]);
      });
    },
  );
  it("sends the default model, header credentials, ordered first three photos and reserves one call", async () => {
    const item = await create();
    const photos = [0, 1, 2, 3].map((position) => {
      const bytes = new Uint8Array(image);
      // Distinct square SOF dimensions let the request prove position ordering.
      bytes[8] = position + 1;
      bytes[10] = position + 1;
      return bytes;
    });
    for (const position of [3, 1, 2, 0]) {
      await db
        .prepare("INSERT INTO photos(id,item_id,position,data,created_at) VALUES(?,?,?,?,?)")
        .bind(crypto.randomUUID(), item.id, position, photos[position].buffer, position)
        .run();
    }
    await isolated(async (fetch) => {
      fetch.mockResolvedValue(Response.json(envelope(JSON.stringify(modelDraft))));
      const response = await call(item.id);
      expect(response.status).toBe(200);
      const result = (await response.json()) as {
        source: string;
        suggestion: typeof modelDraft;
        stripped: string[];
      };
      expect(result).toMatchObject({
        source: "ai",
        keySource: "server",
        suggestion: { category: "phone", brand: "Google", model: "9", color: "黒" },
        stripped: [],
        removed: [],
        boosters: copyBoosters(item.category, item.answers),
      });
      expect([...result.suggestion.title]).toHaveLength(40);
      expect([...result.suggestion.description]).toHaveLength(1000);
      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      );
      expect(url).not.toContain(key);
      expect(init.headers).toEqual({ "x-goog-api-key": key, "Content-Type": "application/json" });
      expect(init.method).toBe("POST");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const body = JSON.parse(init.body);
      expect(
        body.contents[0].parts
          .filter((p: { inline_data?: unknown }) => p.inline_data)
          .map((p: { inline_data: { data: string } }) => p.inline_data.data),
      ).toEqual(photos.slice(0, 3).map((bytes) => Buffer.from(bytes).toString("base64")));
      expect(init.body).not.toContain(key);
      expect(await db.prepare("SELECT calls FROM ai_usage").first()).toEqual({ calls: 1 });
      expect(
        ((await (await request("/state")).json()) as { items: Item[] }).items.find(
          (i) => i.id === item.id,
        ),
      ).toMatchObject({ title: item.title, description: item.description, version: item.version });
    });
  });
  it("trims the model override, skips invalid photos among the first three, and exposes enablement", async () => {
    const item = await create();
    const invalid = new Uint8Array(image);
    invalid[8] = 2; // Not square.
    const corrupt = new Uint8Array([1, 2, 3]);
    for (const [position, bytes] of [image, invalid, corrupt, image].entries()) {
      await db
        .prepare("INSERT INTO photos(id,item_id,position,data,created_at) VALUES(?,?,?,?,?)")
        .bind(crypto.randomUUID(), item.id, position, bytes.buffer, position)
        .run();
    }
    await isolated(async (fetch) => {
      fetch.mockResolvedValue(Response.json(envelope(JSON.stringify(modelDraft))));
      expect((await call(item.id, { GEMINI_MODEL: " custom-flash " })).status).toBe(200);
      expect(fetch.mock.calls[0][0]).toContain("models/custom-flash:generateContent");
      expect(JSON.parse(fetch.mock.calls[0][1].body).contents[0].parts).toHaveLength(2);
      for (const [apiKey, enabled] of [
        [key, true],
        ["  ", false],
        [undefined, false],
      ]) {
        const state = await app.request("http://localhost/api/state", {}, {
          ...env,
          DB: db,
          GEMINI_API_KEY: apiKey,
        } as never);
        expect(await state.json()).toMatchObject({ listingAiEnabled: enabled });
      }
    });
  });
  it.each([undefined, "", "  "])(
    "returns template without fetch or quota for key %j",
    async (apiKey) => {
      const item = await create();
      await isolated(async (fetch) => {
        const response = await call(item.id, { GEMINI_API_KEY: apiKey });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          source: "template",
          keySource: "none",
          reason: "no-key",
          stripped: [],
          removed: [],
          boosters: copyBoosters(item.category, item.answers),
          suggestion: {
            category: item.category,
            brand: "",
            model: "",
            color: "",
            flaws: "",
            title: item.title,
            description: item.description,
          },
        });
        expect(fetch).not.toHaveBeenCalled();
        expect(await db.prepare("SELECT calls FROM ai_usage").first()).toBeNull();
      });
    },
  );
  it("returns a template on HTTP errors and redacts log samples before truncating", async () => {
    const item = await create();
    await isolated(async (fetch, log) => {
      const encoded = Buffer.from(image).toString("base64");
      fetch.mockResolvedValue(
        new Response(`${key} ${encoded} ${"a".repeat(400)}`, { status: 500 }),
      );
      const response = await call(item.id);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ source: "template", reason: "ai-error" });
      expect(log).toHaveBeenCalledWith(
        "gemini failure",
        expect.objectContaining({ stage: "http", status: 500 }),
      );
      const logged = JSON.stringify(log.mock.calls);
      expect(logged).not.toContain(key);
      expect(logged).not.toContain(encoded);
      expect(
        String((log.mock.calls[0][1] as { sample: string }).sample).length,
      ).toBeLessThanOrEqual(300);
      expect(await db.prepare("SELECT calls FROM ai_usage").first()).toEqual({ calls: 1 });
      expect(fetch).toHaveBeenCalledOnce();
    });
  });
  it("reports removed copy and deterministic boosters in both response paths", async () => {
    const item = await create({
      model: "Camera",
      notes: "返品不可。即購入OKです。",
      shipping: "らくらくメルカリ便",
    });
    await isolated(async (fetch) => {
      const template = await (await call(item.id, { GEMINI_API_KEY: "" })).json();
      expect(template).toMatchObject({
        source: "template",
        removed: ["no-returns"],
        stripped: [],
        boosters: copyBoosters(item.category, item.answers),
      });
      fetch.mockResolvedValue(
        Response.json(
          envelope(
            JSON.stringify({
              ...modelDraft,
              title: "【激安】Camera",
              description: "写真に写っているカメラです。返品不可。即購入OKです。",
              boosters: [{ key: "invented", label: "ignore" }],
            }),
          ),
        ),
      );
      expect(await (await call(item.id)).json()).toMatchObject({
        source: "ai",
        stripped: [],
        removed: ["hype", "no-returns"],
        boosters: copyBoosters(item.category, item.answers),
        suggestion: { title: "Camera", description: "写真に写っているカメラです。即購入OKです。" },
      });
    });
  });
  it.each([
    ["garbage", "json"],
    [JSON.stringify({ title: "傷なし", description: "動作確認済み。付属品完備。" }), "validation"],
  ])("falls back on invalid model JSON/text %s", async (text, stage) => {
    const item = await create();
    await isolated(async (fetch, log) => {
      fetch.mockResolvedValue(Response.json(envelope(text)));
      const response = await call(item.id);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ source: "template", reason: "validation" });
      expect(log).toHaveBeenCalledWith("gemini failure", expect.objectContaining({ stage }));
    });
  });
  it.each(["MAX_TOKENS", "SAFETY"])("falls back for incomplete finish %s", async (reason) => {
    const item = await create();
    await isolated(async (fetch, log) => {
      fetch.mockResolvedValue(Response.json(envelope(JSON.stringify(modelDraft), reason)));
      expect(await (await call(item.id)).json()).toMatchObject({
        source: "template",
        reason: "ai-error",
      });
      expect(log).toHaveBeenCalledWith(
        "gemini failure",
        expect.objectContaining({ stage: "shape", finishReason: reason }),
      );
    });
  });
  it("counts a timeout without retry and handles blocked or malformed envelopes", async () => {
    const item = await create();
    await isolated(async (fetch, log) => {
      fetch.mockRejectedValueOnce(new Error(`Timeout ${key}`));
      expect(await (await call(item.id)).json()).toMatchObject({
        source: "template",
        reason: "ai-error",
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(JSON.stringify(log.mock.calls)).not.toContain(key);
      expect(await db.prepare("SELECT calls FROM ai_usage").first()).toEqual({ calls: 1 });
      for (const response of [{}, { promptFeedback: { blockReason: "SAFETY" } }]) {
        fetch.mockResolvedValueOnce(Response.json(response));
        expect(await (await call(item.id)).json()).toMatchObject({
          source: "template",
          reason: "ai-error",
        });
        expect(log).toHaveBeenLastCalledWith(
          "gemini failure",
          expect.objectContaining({ stage: "shape" }),
        );
      }
      fetch.mockResolvedValueOnce(new Response("not JSON"));
      expect(await (await call(item.id)).json()).toMatchObject({
        source: "template",
        reason: "validation",
      });
    });
  });
  it("strips unsupported claims and keeps answer-supported claims", async () => {
    const plain = await create();
    const supported = await create({
      flaws: "目立つ傷なし",
      operation: "動作確認済み",
      accessories: "付属品すべてあり",
    });
    await isolated(async (fetch) => {
      const description = "写真に写っている黒い商品です。傷なし。動作確認済み。付属品完備。";
      fetch.mockImplementation(async () =>
        Response.json(envelope(JSON.stringify({ ...modelDraft, title: "商品", description }))),
      );
      expect(await (await call(plain.id)).json()).toMatchObject({
        source: "ai",
        stripped: ["no-damage", "works-confirmed", "accessories-complete"],
        suggestion: { description: "写真に写っている黒い商品です。" },
      });
      expect(await (await call(supported.id)).json()).toMatchObject({
        source: "ai",
        stripped: [],
        suggestion: { description },
      });
      expect(console.warn).toHaveBeenCalledWith("gemini claims stripped", {
        stripped: ["no-damage", "works-confirmed", "accessories-complete"],
      });
    });
  });
  it("shares the quota with Gemma and refuses the second call without fetching", async () => {
    const item = await create();
    await isolated(async (fetch) => {
      fetch.mockResolvedValue(Response.json(envelope(JSON.stringify(modelDraft))));
      const options = { AI_DAILY_LIMIT: "1" };
      expect((await call(item.id, options)).status).toBe(200);
      const response = await call(item.id, options);
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: "apiError20" });
      expect(fetch).toHaveBeenCalledOnce();
      const run = vi.fn();
      const gemma = await app.request(
        "http://localhost/api/ai/photo",
        { method: "POST", headers: { Origin: "http://localhost" }, body: image.buffer },
        { ...env, DB: db, AI_ENABLED: "1", AI_DAILY_LIMIT: "1", AI: { run } } as never,
      );
      expect(gemma.status).toBe(429);
      expect(run).not.toHaveBeenCalled();
    });
  });
  it("rejects missing/invalid ids before spending quota", async () => {
    await isolated(async (fetch) => {
      const missing = await call(crypto.randomUUID());
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "apiError8" });
      expect((await call("invalid")).status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
      expect(await db.prepare("SELECT calls FROM ai_usage").first()).toBeNull();
    });
  });
  it("persists explicit text, checks stored text for finish, and builds omitted fields from answers", async () => {
    let item = await create();
    const put = async (input: Record<string, unknown>) =>
      request(`/items/${item.id}`, "PUT", {
        version: item.version,
        category: item.category,
        answers: item.answers,
        price: item.price,
        shipping: item.shipping,
        comps: item.comps,
        ...input,
      });
    const response = await put({
      title: "📷".repeat(40),
      description: "Custom description",
      finish: true,
    });
    expect(response.status).toBe(200);
    item = (await response.json()) as Item;
    expect(item.title).toBe("📷".repeat(40));
    expect(item.description).toBe("Custom description");
    expect(
      await db
        .prepare("SELECT type FROM events WHERE item_id=? AND type='text'")
        .bind(item.id)
        .first(),
    ).toEqual({ type: "text" });
    await db.prepare("DELETE FROM events WHERE item_id=?").bind(item.id).run();
    item = (await (await put({ title: "", description: "", finish: true })).json()) as Item;
    expect(
      await db
        .prepare("SELECT type FROM events WHERE item_id=? AND type='text'")
        .bind(item.id)
        .first(),
    ).toBeNull();
    expect((await put({ title: "a".repeat(41) })).status).toBe(400);
    expect((await put({ description: "a".repeat(1001) })).status).toBe(400);
    item = (await (await put({ answers: { model: "New model" } })).json()) as Item;
    expect(item.title).toBe("New model");
    expect(item.description).toContain("New model");
    await db.prepare("DELETE FROM events WHERE item_id=?").bind(item.id).run();
  });
});

describe("Stage D game events and awards", () => {
  const noon = Date.parse("2026-10-08T12:00:00+09:00");
  beforeEach(async () => {
    // This suite owns a clean game history; existing legacy API scenarios run above.
    await db.batch(
      ["events", "operations", "photos", "items", "settings"].map((table) =>
        db.prepare(`DELETE FROM ${table}`),
      ),
    );
    vi.spyOn(Date, "now").mockReturnValue(noon);
  });
  afterEach(() => vi.restoreAllMocks());
  async function create(status: Item["status"] = "listed", at = noon - 4 * calendar.dayMs) {
    const itemId = crypto.randomUUID();
    expect((await request("/items", "POST", { id: itemId, category: "other" })).status).toBe(200);
    await db
      .prepare("UPDATE items SET status=?,title='品物',price=1000,listed_at=? WHERE id=?")
      .bind(status, status === "draft" ? null : at, itemId)
      .run();
    return (await state()).items.find((item) => item.id === itemId) as Item;
  }
  async function state() {
    return (await (await request("/state")).json()) as {
      items: Item[];
      events: GameEvent[];
      game: ReturnType<typeof import("@mer/core").gameSummary>;
    };
  }
  function edit(item: Item, price: number, key = crypto.randomUUID()) {
    return request(
      `/items/${item.id}`,
      "PUT",
      {
        version: item.version,
        category: item.category,
        answers: item.answers,
        title: item.title,
        description: item.description,
        price,
        shipping: item.shipping,
        comps: [],
      },
      key,
    );
  }
  async function events(type: GameEvent["type"], itemId?: string) {
    return (await getEvents(db)).filter(
      (e) => e.type === type && (!itemId || e.item_id === itemId),
    );
  }
  function questDate(id: string) {
    return Array.from({ length: 6 }, (_, i) => noon + i * calendar.dayMs).find((at) =>
      dailyQuests([], [], at).some((q) => q.id === id),
    ) as number;
  }
  it.each(["listed", "shelf"] as const)(
    "records %s price drops once per version, caps XP and resets at JST midnight",
    async (status) => {
      vi.mocked(Date.now).mockReturnValue(Date.parse("2026-10-08T23:59:00+09:00"));
      let item = await create(status);
      const key = crypto.randomUUID();
      const first = await edit(item, 900, key);
      expect(first.status).toBe(200);
      expect((await edit(item, 900, key)).status).toBe(200);
      expect((await edit(item, 800)).status).toBe(409);
      item = (await first.json()) as Item;
      item = (await (await edit(item, 800)).json()) as Item;
      let drops = await events("price_drop", item.id);
      expect(drops).toHaveLength(2);
      expect(drops.map((e) => e.xp).sort((a, b) => b - a)).toEqual([XP.price_drop, 0]);
      expect(drops.find((e) => e.xp > 0)).toMatchObject({
        key: `price_drop:${item.id}:1`,
        rule_version: 1,
        meta: { from: 1000, to: 900, boss: true },
      });
      vi.mocked(Date.now).mockReturnValue(Date.parse("2026-10-09T00:01:00+09:00"));
      expect((await edit(item, 700)).status).toBe(200);
      drops = await events("price_drop", item.id);
      expect(drops).toHaveLength(3);
      expect(drops.reduce((sum, e) => sum + e.xp, 0)).toBe(2 * XP.price_drop);
      expect((await state()).game.unlocked).toContain("priceDrop");
    },
  );
  it("does not record increases, zero prices or edits outside listed/shelf", async () => {
    for (const status of ["draft", "trading", "to_ship", "done"] as const) {
      const item = await create(status);
      expect((await edit(item, 900)).status).toBe(200);
      expect(await events("price_drop", item.id)).toHaveLength(0);
    }
    let item = await create();
    for (const price of [1000, 1100, 0]) {
      const response = await edit(item, price);
      expect(response.status).toBe(200);
      item = (await response.json()) as Item;
    }
    expect(await events("price_drop", item.id)).toHaveLength(0);
  });
  it("only commits one competing price edit, and caps XP separately per item", async () => {
    const item = await create();
    const results = await Promise.all([edit(item, 900), edit(item, 800)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await events("price_drop", item.id)).toHaveLength(1);
    const other = await create();
    await edit(other, 900);
    expect((await events("price_drop")).reduce((sum, e) => sum + e.xp, 0)).toBe(2 * XP.price_drop);
  });
  it.each(["listed", "shelf"] as const)(
    "records photo plus capped retake on %s, and retry/delete/re-upload never replay XP",
    async (status) => {
      const item = await create(status),
        photoId = crypto.randomUUID();
      const upload = () => request(`/items/${item.id}/photos/${photoId}`, "POST", image);
      expect((await upload()).status).toBe(200);
      expect((await upload()).status).toBe(200);
      await request(`/items/${item.id}/photos/${photoId}`, "DELETE");
      expect((await upload()).status).toBe(200);
      expect(await events("photo", item.id)).toHaveLength(1);
      expect(await events("retake", item.id)).toHaveLength(1);
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          request(`/items/${item.id}/photos/${crypto.randomUUID()}`, "POST", image),
        ),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(await events("photo", item.id)).toHaveLength(4);
      const retakes = await events("retake", item.id);
      expect(retakes).toHaveLength(4);
      expect(retakes.reduce((sum, e) => sum + e.xp, 0)).toBe(caps.retakePerItemDay * XP.retake);
      expect(retakes.find((e) => e.key === `retake:${photoId}`)).toMatchObject({
        xp: XP.retake,
        rule_version: 1,
        meta: { boss: true },
      });
      expect((await state()).game.unlocked).toContain("retake2");
      vi.mocked(Date.now).mockReturnValue(Date.parse("2026-10-09T00:01:00+09:00"));
      expect(
        (await request(`/items/${item.id}/photos/${crypto.randomUUID()}`, "POST", image)).status,
      ).toBe(200);
      expect((await events("retake", item.id)).reduce((sum, e) => sum + e.xp, 0)).toBe(
        2 * XP.retake,
      );
    },
  );
  it("classifies retakes at upload time and never on draft or sold items", async () => {
    for (const status of ["draft", "trading", "to_ship", "done"] as const) {
      const item = await create(status),
        photoId = crypto.randomUUID();
      expect((await request(`/items/${item.id}/photos/${photoId}`, "POST", image)).status).toBe(
        200,
      );
      expect(await events("retake", item.id)).toHaveLength(0);
      expect(await events("photo", item.id)).toHaveLength(1);
      await db.prepare("UPDATE items SET status='listed' WHERE id=?").bind(item.id).run();
      // Retrying a draft photo after listing does not turn it into a retake.
      await request(`/items/${item.id}/photos/${photoId}`, "POST", image);
      expect(await events("retake", item.id)).toHaveLength(0);
      await request(`/items/${item.id}/photos/${crypto.randomUUID()}`, "POST", image);
      expect(await events("retake", item.id)).toHaveLength(1);
    }
  });
  it("awards each completed quest exactly once despite concurrent awards, retries and state reads", async () => {
    const at = questDate("photo");
    vi.mocked(Date.now).mockReturnValue(at);
    const item = await create("draft");
    const photos = Array.from({ length: 4 }, () => crypto.randomUUID());
    const results = await Promise.all(
      photos.map((id) => request(`/items/${item.id}/photos/${id}`, "POST", image)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    await request(`/items/${item.id}/photos/${photos[0]}`, "POST", image);
    await edit(item, 1000);
    await state();
    const rewards = (await events("quest")).filter((e) => e.key === `quest:${jstDay(at)}:photo`);
    const quest = dailyQuests([], [], at).find((q) => q.id === "photo");
    expect(rewards).toHaveLength(1);
    expect(rewards[0].xp).toBe(quest?.rewardXp);
    expect((await state()).game.quests.find((q) => q.id === "photo")).toMatchObject({
      done: true,
      progress: quest?.target,
    });
    vi.mocked(Date.now).mockReturnValue(at + 6 * calendar.dayMs);
    for (let i = 0; i < 3; i++)
      await request(`/items/${item.id}/photos/${crypto.randomUUID()}`, "POST", image);
    expect((await events("quest")).filter((e) => e.meta.quest === "photo")).toHaveLength(2);
  });
  it("awards boss XP and its badge on sale once, layers the defeat flag, and preserves XP on undo", async () => {
    const created = await create(),
      key = crypto.randomUUID();
    // Undo back to listed requires a listable item (title, price and a photo).
    await request(`/items/${created.id}/photos/${crypto.randomUUID()}`, "POST", image);
    const item = (await state()).items.find((i) => i.id === created.id) as Item;
    const body = { version: item.version, status: "trading", soldPrice: 900 };
    const response = await request(`/items/${item.id}/status`, "POST", body, key);
    expect(response.status).toBe(200);
    const sale = (await response.json()) as { item: Item; bossDefeated: boolean };
    expect(sale.bossDefeated).toBe(true);
    expect((await request(`/items/${item.id}/status`, "POST", body, key)).status).toBe(200);
    expect(await events("boss", item.id)).toHaveLength(1);
    expect((await events("boss", item.id))[0]).toMatchObject({
      key: `boss:${item.id}`,
      xp: XP.boss,
      rule_version: 1,
    });
    const initial = await state();
    expect(initial.game.unlocked).toContain("bossSlayer");
    expect(initial.game.bosses.find((b) => b.itemId === item.id)).toMatchObject({
      defeated: true,
      hp: 0,
    });
    expect(initial.game.weekly.current.bossesDefeated).toBe(1);
    const undone = await request(`/items/${item.id}/status`, "POST", {
      version: sale.item.version,
      status: "listed",
      undo: key,
    });
    expect(undone.status).toBe(200);
    const restored = ((await undone.json()) as { item: Item }).item;
    await request(`/items/${item.id}/status`, "POST", {
      version: restored.version,
      status: "trading",
      soldPrice: 900,
    });
    expect(await events("boss", item.id)).toHaveLength(1);
    expect((await state()).game.xp).toBe(initial.game.xp);
  });
  it("does not award boss XP on a young sale or a stale losing transition", async () => {
    const young = await create("listed", noon - (bossConfig.minimumDays - 1) * calendar.dayMs);
    await request(`/items/${young.id}/status`, "POST", { version: 0, status: "trading" });
    expect(await events("boss", young.id)).toHaveLength(0);
    const item = await create();
    await edit(item, 900);
    expect(
      (await request(`/items/${item.id}/status`, "POST", { version: 0, status: "trading" })).status,
    ).toBe(409);
    expect(await events("boss", item.id)).toHaveLength(0);
  });
  it("records every relisting for streak/boss age without replaying previously earned listing XP", async () => {
    let item = await create("shelf");
    await request(`/items/${item.id}/photos/${crypto.randomUUID()}`, "POST", image);
    for (let i = 0; i < 2; i++) {
      vi.mocked(Date.now).mockReturnValue(noon + i * calendar.dayMs);
      const listed = await request(`/items/${item.id}/status`, "POST", {
        version: item.version,
        status: "listed",
      });
      expect(listed.status).toBe(200);
      item = ((await listed.json()) as { item: Item }).item;
      if (i === 0) {
        const shelved = await request(`/items/${item.id}/status`, "POST", {
          version: item.version,
          status: "shelf",
        });
        item = ((await shelved.json()) as { item: Item }).item;
      }
    }
    expect(await events("relisted", item.id)).toHaveLength(2);
    expect((await events("relisted", item.id)).reduce((sum, e) => sum + e.xp, 0)).toBe(XP.relisted);
    expect((await state()).game.listingStreak).toMatchObject({ current: 2, listedToday: true });
    expect((await state()).game.bosses).toHaveLength(0);
  });
});

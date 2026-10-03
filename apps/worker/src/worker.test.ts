import { readFileSync } from "node:fs";
import { copyBoosters, type Item } from "@mer/core";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authenticate, devBypass } from "./auth";
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
  const call = (itemId: string, overrides: Record<string, unknown> = {}) =>
    app.request(
      "http://localhost/api/ai/listing",
      {
        method: "POST",
        headers: { Origin: "http://localhost", "Content-Type": "application/json" },
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

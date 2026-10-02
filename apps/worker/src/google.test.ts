import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authConfigured, authenticate, sessionCookie, verifyGoogle } from "./auth";
import app from "./index";

const env = {
  APP_ENV: "staging",
  AUTH_MODE: "google",
  GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com",
  OWNER_EMAIL: "owner@example.com",
  SESSION_SECRET: "test-secret-with-at-least-32-bytes-of-entropy",
  // Unused Access placeholders must not disable Google mode.
  ACCESS_AUD: "REPLACE_WITH_ACCESS_AUD",
  ACCESS_TEAM_DOMAIN: "REPLACE_WITH_ACCESS_TEAM_DOMAIN",
};
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  pair = await generateKeyPair("RS256");
  const key = await exportJWK(pair.publicKey);
  key.kid = "google-test";
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    expect(String(input)).toBe("https://www.googleapis.com/oauth2/v3/certs");
    return new Response(JSON.stringify({ keys: [key] }), {
      headers: { "Content-Type": "application/json" },
    });
  });
});
afterAll(() => vi.restoreAllMocks());
async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    email: env.OWNER_EMAIL,
    email_verified: true,
    sub: "google-owner",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: "https://accounts.google.com",
    aud: env.GOOGLE_CLIENT_ID,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "google-test" })
    .sign(pair.privateKey);
}
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
  origin = "https://app.example",
) =>
  app.request(
    `https://app.example/api${path}`,
    {
      method,
      headers: { Origin: origin, Cookie: cookie || "", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    env as never,
  );
describe("Google sign-in and signed sessions", () => {
  it("accepts both Google issuers and rejects invalid claims", async () => {
    expect(await verifyGoogle(await token(), env)).toBe(true);
    expect(await verifyGoogle(await token({ iss: "accounts.google.com" }), env)).toBe(true);
    for (const bad of [
      { aud: "other-client" },
      { iss: "https://evil.example" },
      { email: "other@example.com" },
      { email_verified: false },
      { email_verified: "true" },
      { exp: 1 },
      { sub: undefined },
    ])
      expect(await verifyGoogle(await token(bad), env)).toBe(false);
    const forged = await new SignJWT({ email: env.OWNER_EMAIL })
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode(env.SESSION_SECRET));
    expect(await verifyGoogle(forged, env)).toBe(false);
    const otherPair = await generateKeyPair("RS256");
    const wrongSignature = await new SignJWT({ email: env.OWNER_EMAIL })
      .setProtectedHeader({ alg: "RS256", kid: "google-test" })
      .sign(otherPair.privateKey);
    expect(await verifyGoogle(wrongSignature, env)).toBe(false);
  });
  it("fails closed for missing config, unknown mode, and deployed bypass", async () => {
    for (const field of ["AUTH_MODE", "OWNER_EMAIL", "SESSION_SECRET", "GOOGLE_CLIENT_ID"]) {
      const missing = { ...env, [field]: "" };
      expect(authConfigured(missing)).toBe(false);
      expect(await verifyGoogle(await token(), missing)).toBe(false);
    }
    expect(authConfigured({ ...env, AUTH_MODE: "other" })).toBe(false);
    expect(authConfigured({ ...env, SESSION_SECRET: "short" })).toBe(false);
    expect(authConfigured({ ...env, GOOGLE_CLIENT_ID: "REPLACE_WITH_GOOGLE_CLIENT_ID" })).toBe(
      false,
    );
    expect(
      await authenticate(new Request("http://localhost/api/health"), {
        ...env,
        DEV_AUTH_BYPASS: "1",
      }),
    ).toBe(false);
  });
  it("issues a secure 30-day cookie and authenticates protected API routes", async () => {
    expect((await request("/health")).status).toBe(401);
    const response = await request("/auth/google", "POST", { credential: await token() });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("Set-Cookie") || "";
    for (const flag of [
      "__Host-harness-session=",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Path=/",
      "Max-Age=2592000",
    ])
      expect(cookie).toContain(flag);
    expect((await request("/health", "GET", undefined, cookie.split(";")[0])).status).toBe(200);
    expect(
      (await request("/health", "GET", undefined, cookie.replace("session=", "session=x"))).status,
    ).toBe(401);
    const expired = await new SignJWT({ email: env.OWNER_EMAIL })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("mer-harness")
      .setAudience(env.GOOGLE_CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("-1s")
      .sign(new TextEncoder().encode(env.SESSION_SECRET));
    expect(
      (await request("/health", "GET", undefined, `__Host-harness-session=${expired}`)).status,
    ).toBe(401);
    const req = new Request("https://app.example/api/health", { headers: { Cookie: cookie } });
    expect(await authenticate(req, { ...env, OWNER_EMAIL: "changed@example.com" })).toBe(false);
    expect(
      await authenticate(req, { ...env, SESSION_SECRET: `${env.SESSION_SECRET}-rotated` }),
    ).toBe(false);
  });
  it("blocks login/logout CSRF and clears cookie on logout", async () => {
    const credential = await token();
    expect(
      (await request("/auth/google", "POST", { credential }, undefined, "https://evil.example"))
        .status,
    ).toBe(403);
    expect((await request("/auth/google", "POST", { credential }, undefined, "")).status).toBe(403);
    expect(
      (await request("/auth/logout", "POST", {}, undefined, "https://evil.example")).status,
    ).toBe(403);
    const response = await request("/auth/logout", "POST", {}, await sessionCookie(env));
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await request("/health", "GET", undefined, "__Host-harness-session=")).status).toBe(
      401,
    );
    const config = (await (await request("/auth/config")).json()) as Record<string, unknown>;
    expect(config.clientId).toBe(env.GOOGLE_CLIENT_ID);
    expect(JSON.stringify(config)).not.toContain(env.SESSION_SECRET);
    expect(JSON.stringify(config)).not.toContain(env.OWNER_EMAIL);
  });
});

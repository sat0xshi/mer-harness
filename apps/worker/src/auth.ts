import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
export interface AuthEnv {
  APP_ENV: string;
  AUTH_MODE?: string;
  DEV_AUTH_BYPASS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  GOOGLE_CLIENT_ID?: string;
  SESSION_SECRET?: string;
  OWNER_EMAIL?: string;
}
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const sessionName = "__Host-harness-session";
const sessionSeconds = 30 * 24 * 60 * 60;
const configured = (value?: string): value is string =>
  !!value?.trim() && !value.startsWith("REPLACE_WITH_");
export function authConfigured(env: AuthEnv) {
  if (!configured(env.OWNER_EMAIL)) return false;
  if (env.AUTH_MODE === "google")
    return (
      configured(env.GOOGLE_CLIENT_ID) &&
      configured(env.SESSION_SECRET) &&
      env.SESSION_SECRET.length >= 32
    );
  return (
    env.AUTH_MODE === "access" &&
    configured(env.ACCESS_AUD) &&
    !!env.ACCESS_TEAM_DOMAIN &&
    /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN)
  );
}
function jwks(url: string) {
  let key = keys.get(url);
  if (!key) {
    key = createRemoteJWKSet(new URL(url));
    keys.set(url, key);
  }
  return key;
}
export function devBypass(request: Request, env: AuthEnv) {
  return (
    env.APP_ENV === "development" &&
    env.DEV_AUTH_BYPASS === "1" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)
  );
}
export async function verifyGoogle(token: string, env: AuthEnv) {
  if (env.AUTH_MODE !== "google" || !authConfigured(env)) return false;
  try {
    const { payload } = await jwtVerify(token, jwks("https://www.googleapis.com/oauth2/v3/certs"), {
      algorithms: ["RS256"],
      audience: env.GOOGLE_CLIENT_ID,
      issuer: ["accounts.google.com", "https://accounts.google.com"],
      requiredClaims: ["exp", "iat", "sub", "email", "email_verified"],
    });
    return payload.email_verified === true && payload.email === env.OWNER_EMAIL;
  } catch {
    return false;
  }
}
export async function sessionCookie(env: AuthEnv) {
  if (env.AUTH_MODE !== "google" || !authConfigured(env))
    throw new Error("Auth configuration missing");
  const token = await new SignJWT({ email: env.OWNER_EMAIL })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${sessionSeconds}s`)
    .setIssuer("mer-harness")
    .setAudience(env.GOOGLE_CLIENT_ID as string)
    .sign(new TextEncoder().encode(env.SESSION_SECRET));
  return `${sessionName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionSeconds}`;
}
export const logoutCookie = () =>
  `${sessionName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export async function authenticate(request: Request, env: AuthEnv) {
  if (devBypass(request, env)) return true;
  if (!authConfigured(env)) return false;
  try {
    if (env.AUTH_MODE === "google") {
      const token =
        request.headers
          .get("Cookie")
          ?.split(";")
          .map((v) => v.trim())
          .find((v) => v.startsWith(`${sessionName}=`))
          ?.slice(sessionName.length + 1) || "";
      const { payload } = await jwtVerify(token, new TextEncoder().encode(env.SESSION_SECRET), {
        algorithms: ["HS256"],
        issuer: "mer-harness",
        audience: env.GOOGLE_CLIENT_ID,
        requiredClaims: ["exp", "iat", "email"],
        maxTokenAge: `${sessionSeconds}s`,
      });
      return payload.email === env.OWNER_EMAIL;
    }
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
    const { payload } = await jwtVerify(
      request.headers.get("Cf-Access-Jwt-Assertion") || "",
      jwks(`${issuer}/cdn-cgi/access/certs`),
      {
        issuer,
        audience: env.ACCESS_AUD,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "email"],
      },
    );
    return payload.email === env.OWNER_EMAIL;
  } catch {
    return false;
  }
}
export function sameOrigin(request: Request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

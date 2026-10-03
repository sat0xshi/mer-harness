export const userKeyStorageKey = "fh.geminiKey.v1";
export const validUserKey = (key: string) => /^[A-Za-z0-9_-]{20,128}$/.test(key);
export function readUserKey(storage: Pick<Storage, "getItem">) {
  try {
    const key = storage.getItem(userKeyStorageKey);
    return key && validUserKey(key) ? key : null;
  } catch {
    return null;
  }
}
export function saveUserKey(storage: Pick<Storage, "setItem">, key: string) {
  const trimmed = key.trim();
  if (!validUserKey(trimmed)) return false;
  try {
    storage.setItem(userKeyStorageKey, trimmed);
    return true;
  } catch {
    return false;
  }
}
export function clearUserKey(storage: Pick<Storage, "removeItem">) {
  try {
    storage.removeItem(userKeyStorageKey);
    return true;
  } catch {
    return false;
  }
}
export function maskKey(key: string) {
  return `••••${key.length > 4 ? key.slice(-4) : ""}`;
}
// Explicit allowlist: never attach the credential to a general API request.
export function userKeyHeaders(
  storage: Pick<Storage, "getItem">,
  path: string,
  method: string,
): Record<string, string> {
  if (method !== "POST" || !["/ai/listing", "/ai/key-test"].includes(path)) return {};
  const key = readUserKey(storage);
  return key ? { "X-User-Gemini-Key": key } : {};
}

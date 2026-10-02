import type { GameEvent, gameSummary, Item } from "@mer/core";
import { apiErrorMessage, type ja, t } from "./i18n/ja";
export interface Settings {
  sound: boolean;
  soundAsked: boolean;
  volume: number;
  quiet: boolean;
  night: boolean;
  soft: boolean;
  haptics: boolean;
  hapticScale: number;
  fx: typeof ja.fxVivid | typeof ja.fxNormal | typeof ja.fxSubtle | typeof ja.fxOff;
  theme: "system" | "light" | "dark";
  zone: string;
}
export const defaults: Settings = {
  sound: false,
  soundAsked: false,
  volume: 0.5,
  quiet: false,
  night: true,
  soft: false,
  haptics: true,
  hapticScale: 1,
  fx: t("fxNormal"),
  theme: "system",
  zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};
export interface State {
  items: Item[];
  events: GameEvent[];
  game: ReturnType<typeof gameSummary>;
  settings: Settings | null;
  aiEnabled: boolean;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: unknown,
  ) {
    super(apiErrorMessage(code));
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof Blob
        ? { "Content-Type": "image/jpeg" }
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw Error(t("loginRequired"));
  if (response.status === 401) window.dispatchEvent(new Event("auth-expired"));
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(response.status, (body as { error?: unknown } | null)?.error);
  return body as T;
}
export const json = (
  body: unknown,
  method = "POST",
  key: string = crypto.randomUUID(),
): RequestInit => ({
  method,
  headers: { "Idempotency-Key": key },
  body: JSON.stringify(body),
});

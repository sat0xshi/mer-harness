import { mercari } from "./mercari";
import type { PlatformConfig } from "./types";

export type { PlatformConfig } from "./types";
export const platforms = { mercari } as const;
export type PlatformId = keyof typeof platforms;
export const defaultPlatform = mercari;
export function getPlatform(id: string): PlatformConfig {
  if (!Object.hasOwn(platforms, id)) throw new Error(`Unknown platform: ${id}`);
  return platforms[id as PlatformId];
}
export function formatCurrency(value: number, platform = defaultPlatform) {
  return new Intl.NumberFormat(platform.locale, {
    style: "currency",
    currency: platform.currency,
  }).format(value);
}

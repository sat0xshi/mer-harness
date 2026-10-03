import { shared } from "./shared";
import type { PlatformConfig } from "./types";

export const jmoty: PlatformConfig = {
  ...shared,
  id: "jmoty",
  // Source: https://jmty.jp — service identity.
  serviceName: "ジモティー",
  // Generic app category; used outside the picker and search links.
  name: "地域掲示板",
  // No selling fee (free classifieds; https://jmty.jp/support/how_to_use/).
  feeRate: 0,
  limits: {
    // Source: https://jmty.jp
    // TODO(verify): limit not published; use an app-side cap.
    title: 40,
    // Source: https://jmty.jp
    // TODO(verify): limit not published; use an app-side cap.
    description: 1000,
    // 0円 = giveaway (https://jmty.jp/info/guideline/post_article).
    minPrice: 0,
    // Source: https://jmty.jp/articles/new
    // TODO(verify): confirm the maximum price; inherited app ceiling.
    maxPrice: 9999999,
  },
  // Source: https://jmty.jp/all/sale?keyword=Pixel — checked 2026-10-03.
  soldSearchUrl: (keyword) => `https://jmty.jp/all/sale?keyword=${encodeURIComponent(keyword)}`,
  // Same search source: no sold/closed filter exists.
  hasSoldFilter: false,
  searchLabel: "ジモティーで検索 ↗",
  // Source: https://jmty.jp/articles/new
  sellUrl: "https://jmty.jp/articles/new",
  // App default for local pickup; shared delivery options remain available.
  defaultShipping: 0,
  shippingMethods: ["手渡し", ...shared.shippingMethods],
  searchHint: "近くの同じ品を見て、相場をメモしよう。",
};

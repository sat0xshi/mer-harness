import { shared } from "./shared";
import type { PlatformConfig } from "./types";

export const mercari: PlatformConfig = {
  ...shared,
  id: "mercari",
  // Source: https://jp.mercari.com — service identity.
  serviceName: "メルカリ",
  // Generic app category; used outside the picker and search links.
  name: "フリマ",
  // Source: https://jp.mercari.com — selling fee (data checked 2026-10-03).
  feeRate: 10,
  limits: {
    // Source: https://jp.mercari.com — title limit (2026-10-03).
    title: 40,
    // Source: https://jp.mercari.com — description limit (2026-10-03).
    description: 1000,
    // Source: https://jp.mercari.com/sell — price floor (2026-10-03).
    minPrice: 300,
    // Source: https://jp.mercari.com/sell
    maxPrice: 9999999,
  },
  // Source: https://jp.mercari.com/search?keyword=Pixel&status=sold_out — checked 2026-10-03.
  soldSearchUrl: (keyword) =>
    `https://jp.mercari.com/search?keyword=${encodeURIComponent(keyword)}&status=sold_out`,
  // Same search source: sold/closed results confirmed.
  hasSoldFilter: true,
  searchLabel: "メルカリで売り切れを検索 ↗",
  // Source: https://jp.mercari.com/sell
  sellUrl: "https://jp.mercari.com/sell",
};

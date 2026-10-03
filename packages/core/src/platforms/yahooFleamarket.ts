import { shared } from "./shared";
import type { PlatformConfig } from "./types";

export const yahooFleamarket: PlatformConfig = {
  ...shared,
  id: "yahooFleamarket",
  // Source: https://paypayfleamarket.yahoo.co.jp — service identity.
  serviceName: "Yahoo!フリマ",
  // Generic app category; used outside the picker and search links.
  name: "フリマ",
  // Source (secondary): https://baseu.jp/38800 — flat 5% selling fee (checked 2026-10-03).
  feeRate: 5,
  limits: {
    // Source: https://paypayfleamarket.yahoo.co.jp/notice/function/266/ — 40 → 65.
    title: 65,
    // Source: https://paypayfleamarket.yahoo.co.jp
    // TODO(verify): 1000 is supported only by secondary sources.
    description: 1000,
    // Source (secondary): https://tinpanblog.com/furima-app-comparison-2026/ — 100円 floor.
    // TODO(verify): confirm on the official help pages.
    minPrice: 100,
    // Source: https://paypayfleamarket.yahoo.co.jp/sell
    // TODO(verify): confirm the maximum price; inherited app ceiling.
    maxPrice: 9999999,
  },
  // Source: https://paypayfleamarket.yahoo.co.jp/search/Pixel?sold=1 — checked 2026-10-03.
  soldSearchUrl: (keyword) =>
    `https://paypayfleamarket.yahoo.co.jp/search/${encodeURIComponent(keyword)}?sold=1`,
  // Same search source: sold/closed results confirmed.
  hasSoldFilter: true,
  searchLabel: "Yahoo!フリマで売り切れを検索 ↗",
  // Source: https://paypayfleamarket.yahoo.co.jp/sell
  sellUrl: "https://paypayfleamarket.yahoo.co.jp/sell",
};

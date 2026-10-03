import { shared } from "./shared";
import type { PlatformConfig } from "./types";

export const rakuma: PlatformConfig = {
  ...shared,
  id: "rakuma",
  // Source: https://fril.jp — service identity.
  serviceName: "ラクマ",
  // Generic app category; used outside the picker and search links.
  name: "フリマ",
  // Source: https://faq.fril.jp/hc/ja/articles/39005403463821
  // Monthly sales determine a 4.5–10% rate; use the conservative 10% estimate.
  feeRate: 10,
  limits: {
    // Sources (secondary): https://fril-love.com/description-of-item/, https://www.colotanblog.com/entry/rakuma-shouhinmei
    title: 40,
    // Sources: https://fril-love.com, https://colotanblog.com
    // TODO(verify): confirm the 1000-character limit with an official source.
    description: 1000,
    // Source (secondary): https://rieki-calc.com/guides/rakuma-300-yen-profit/ — 300円 floor.
    // TODO(verify): confirm on the official guide.
    minPrice: 300,
    // Source: https://fril.jp/item/new
    // TODO(verify): confirm the maximum price; inherited app ceiling.
    maxPrice: 9999999,
  },
  // Source: https://fril.jp/s?query=Pixel&transaction=soldout — checked 2026-10-03.
  soldSearchUrl: (keyword) =>
    `https://fril.jp/s?query=${encodeURIComponent(keyword)}&transaction=soldout`,
  // Same search source: sold/closed results confirmed.
  hasSoldFilter: true,
  searchLabel: "ラクマで売り切れを検索 ↗",
  // Source: https://fril.jp/item/new
  sellUrl: "https://fril.jp/item/new",
};

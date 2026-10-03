import { shared } from "./shared";
import type { PlatformConfig } from "./types";

export const yahooAuctions: PlatformConfig = {
  ...shared,
  id: "yahooAuctions",
  // Source: https://auctions.yahoo.co.jp — service identity.
  serviceName: "Yahoo!オークション",
  // Generic app category; used outside the picker and search links.
  name: "オークション",
  // Standard 10% selling fee (well known; not re-checked on an official page 2026-10-03).
  // TODO(verify): LYPプレミアム members may pay 8.8%; retain the standard 10% estimate.
  feeRate: 10,
  limits: {
    // Sources (secondary): https://aqcg.jp/yahootitle/, https://cktt.jp/97086 — 全角65文字 since 2017.
    title: 65,
    // Source: https://auctions.yahoo.co.jp
    // TODO(verify): no documented hard cap (HTML allowed); 1000 is an app-side cap.
    description: 1000,
    // 1円 start price is allowed for auctions.
    // TODO(verify): confirm on the official help pages.
    minPrice: 1,
    // Source: https://auctions.yahoo.co.jp/sell/jp/show/submit
    // TODO(verify): confirm the maximum price; inherited app ceiling.
    maxPrice: 9999999,
  },
  // Source: https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=Pixel — checked 2026-10-03.
  soldSearchUrl: (keyword) =>
    `https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=${encodeURIComponent(keyword)}`,
  // Same search source: sold/closed results confirmed.
  hasSoldFilter: true,
  searchLabel: "ヤフオク!で落札相場を検索 ↗",
  // Source: https://auctions.yahoo.co.jp/sell/jp/show/submit
  sellUrl: "https://auctions.yahoo.co.jp/sell/jp/show/submit",
  // Source: https://auctions.yahoo.co.jp — top-page search form action.
  activeSearchUrl: (keyword) =>
    `https://auctions.yahoo.co.jp/search/search?p=${encodeURIComponent(keyword)}`,
  openLabel: "オークションの出品ページを開く ↗",
};

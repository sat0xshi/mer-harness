import { defaultPlatform, getPlatform, type PlatformId } from "./platforms";
export const categories = {
  phone: "categoryPhone",
  gadget: "categoryGadget",
  clothing: "categoryClothing",
  other: "categoryOther",
} as const;
export type Category = keyof typeof categories;
export const statuses = {
  draft: "statusDraft",
  listed: "statusListed",
  trading: "statusTrading",
  to_ship: "statusToShip",
  done: "statusDone",
  shelf: "statusShelf",
} as const;
export type Status = keyof typeof statuses;
export type Answers = Record<string, string>;
export interface Question {
  key: string;
  label: string;
  hint?: string;
  options?: string[];
}
const identity: Question[] = [
  { key: "brand", label: "questionBrand", hint: "hintBrand" },
  {
    key: "model",
    label: "questionModel",
    hint: "hintModel",
  },
  {
    key: "condition",
    label: "questionCondition",
    options: [...defaultPlatform.conditionLabels],
  },
];
const common: Question[] = [
  {
    key: "flaws",
    label: "questionFlaws",
    hint: "hintFlaws",
  },
  {
    key: "accessories",
    label: "questionAccessories",
    hint: "hintAccessories",
  },
  {
    key: "shipping",
    label: "questionShipping",
    options: [...defaultPlatform.shippingMethods],
  },
  {
    key: "negotiation",
    label: "questionNegotiation",
    options: ["negotiationAllowed", "negotiationDeclined"],
  },
];
export const questions: Record<Category, Question[]> = {
  phone: [
    ...identity,
    { key: "capacity", label: "questionCapacity", hint: "hintCapacity" },
    { key: "color", label: "questionColor" },
    {
      key: "sim",
      label: "questionSim",
      hint: "hintSim",
    },
    { key: "battery", label: "questionBattery", hint: "hintBattery" },
    {
      key: "reset",
      label: "questionResetAccounts",
      options: ["resetBothDone", "resetBeforeShipping", "unknownCondition"],
    },
    { key: "purchase", label: "questionPurchase" },
    ...common,
  ],
  gadget: [
    ...identity,
    { key: "edition", label: "questionEdition", hint: "hintEdition" },
    { key: "color", label: "questionColor" },
    { key: "operation", label: "questionOperation", hint: "hintOperation" },
    { key: "usage", label: "questionUsage" },
    {
      key: "reset",
      label: "questionReset",
      options: ["statusDone", "resetBeforeShipping", "unknownCondition"],
    },
    ...common,
  ],
  clothing: [
    ...identity,
    { key: "size", label: "questionSize", hint: "hintSize" },
    {
      key: "measurements",
      label: "questionMeasurements",
      hint: "hintMeasurements",
    },
    { key: "color", label: "questionColor" },
    { key: "material", label: "questionMaterial", hint: "hintMaterial" },
    { key: "usage", label: "questionWearCount" },
    { key: "storage", label: "questionStorage", hint: "hintStorage" },
    ...common,
  ],
  other: [
    ...identity,
    { key: "size", label: "questionDimensions" },
    { key: "color", label: "questionColor" },
    { key: "operation", label: "questionOperationOther" },
    ...common,
  ],
};
export const charCount = (value: string) => [...value].length;
export const truncate = (value: string, length: number) => [...value].slice(0, length).join("");
export function platformQuestions(category: Category, platformId: PlatformId = "mercari") {
  const platform = getPlatform(platformId);
  return questions[category].map((q) =>
    q.key === "condition"
      ? { ...q, options: [...platform.conditionLabels] }
      : q.key === "shipping"
        ? { ...q, options: [...platform.shippingMethods] }
        : q,
  );
}
export function buildListing(
  category: Category,
  answers: Answers,
  platformId: PlatformId = "mercari",
) {
  const platform = getPlatform(platformId);
  const cards = platformQuestions(category, platformId);
  const title = truncate(
    platform.titleFields
      .map((k) => answers[k]?.trim())
      .filter(Boolean)
      .join(" "),
    platform.limits.title,
  );
  const rows = platform.descriptionFields.flatMap((key) => {
    const q = cards.find((q) => q.key === key);
    return q && answers[key]?.trim() ? [{ label: q.label, value: answers[key].trim() }] : [];
  });
  const description = truncate(
    platform.formatDescription(rows, answers.notes?.trim() || ""),
    platform.limits.description,
  );
  const answered = cards.filter((q) => answers[q.key]?.trim()).length;
  return { title, description, answered, total: cards.length, complete: answered === cards.length };
}
export interface Comp {
  price: number;
  sold: boolean;
}
export function prices(comps: Comp[], platform = defaultPlatform) {
  const sorted = comps
    .filter((c) => c.sold && Number.isFinite(c.price) && c.price > 0)
    .map((c) => c.price)
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const n = sorted.length,
    median = (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2;
  const round = (v: number) =>
    Math.max(
      platform.limits.minPrice,
      Math.round(v / (v >= 100000 ? 1000 : v >= 10000 ? 100 : v >= 1000 ? 50 : 10)) *
        (v >= 100000 ? 1000 : v >= 10000 ? 100 : v >= 1000 ? 50 : 10),
    );
  return {
    low: round(median * 0.94),
    recommended: round(median),
    high: round(median * 1.07),
    min: sorted[0],
    max: sorted[n - 1],
  };
}
export const netProceeds = (price: number, fee = defaultPlatform.feeRate, shipping = 0) =>
  price - Math.floor((price * fee) / 100) - shipping;
export const searchUrl = defaultPlatform.soldSearchUrl;
export const shippingTable = defaultPlatform.shippingTable;
export interface Photo {
  id: string;
  position: number;
}
export interface Item {
  platform: PlatformId;
  id: string;
  category: Category;
  status: Status;
  answers: Answers;
  title: string;
  description: string;
  price: number;
  shipping: number;
  comps: Comp[];
  photos: Photo[];
  version: number;
  listed_at: number | null;
  sold_at: number | null;
  shipped_at: number | null;
  completed_at: number | null;
  sold_price: number;
  created_at: number;
  updated_at: number;
}

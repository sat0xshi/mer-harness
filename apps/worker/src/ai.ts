import { defaultPlatform } from "@mer/core";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value
      .map((part) => record(part).text)
      .filter((text) => typeof text === "string")
      .join("");
  return "";
}

export function extractText(result: unknown): string {
  if (typeof result === "string") return result;
  const r = record(result);
  if (typeof r.response === "string" && r.response.trim()) return r.response;
  if (r.response !== null && typeof r.response === "object") return JSON.stringify(r.response);
  const choice = record(Array.isArray(r.choices) ? r.choices[0] : undefined);
  const message = record(choice.message);
  for (const value of [
    message.content,
    choice.text,
    message.reasoning_content,
    message.reasoning,
  ]) {
    const text = contentText(value);
    if (text.trim()) return text;
  }
  return r.result === undefined ? "" : extractText(r.result);
}

export class AiJsonError extends Error {
  constructor() {
    super("No valid JSON object in model output");
    this.name = "AiJsonError";
  }
}

export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/```(?:json)?/gi, "")
    .replace(
      /<\|channel>(?:thought|analysis|final|answer)?|<channel\|>|<\|[^>]*\|>|<\/?think>/g,
      "",
    );
  let depth = 0;
  let start = 0;
  let quoted = false;
  let escaped = false;
  let found: unknown;
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (depth === 0) {
      if (char !== "{") continue;
      start = i;
      depth = 1;
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try {
        found = JSON.parse(cleaned.slice(start, i + 1));
      } catch {
        // Prose can contain balanced braces too; keep looking for the final answer.
      }
    }
  }
  if (found === undefined) throw new AiJsonError();
  return found;
}

function field(value: unknown): string {
  if (Array.isArray(value)) return value.map(field).filter(Boolean).join("、");
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function normalizePhoto(parsed: unknown) {
  const r = record(parsed);
  const category = field(r.category).toLowerCase();
  return {
    category: ["phone", "smartphone", "tablet", "スマホ", "携帯", "タブレット"].includes(category)
      ? "phone"
      : ["gadget", "electronics", "camera", "headphones", "ガジェット", "家電"].includes(category)
        ? "gadget"
        : ["clothing", "clothes", "apparel", "fashion", "服", "衣類"].includes(category)
          ? "clothing"
          : "other",
    brand: field(r.brand).slice(0, 100),
    model: field(r.model).slice(0, 100),
    color: field(r.color).slice(0, 100),
    flaws: field(r.flaws).slice(0, 500),
  };
}

export function normalizePrices(parsed: unknown): { prices: number[] } {
  const values = Array.isArray(parsed) ? parsed : record(parsed).prices;
  const prices: number[] = [];
  if (Array.isArray(values)) {
    for (const value of values) {
      const number =
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? Number(value.replace(/[¥￥円,\s]/g, ""))
            : NaN;
      const price = Math.round(number);
      if (
        Number.isFinite(price) &&
        price >= defaultPlatform.limits.minPrice &&
        price <= defaultPlatform.limits.maxPrice
      ) {
        prices.push(price);
        if (prices.length === 50) break;
      }
    }
  }
  return { prices };
}

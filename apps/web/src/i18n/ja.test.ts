import { describe, expect, it } from "vitest";
import { apiErrorMessage, ja } from "./ja";

describe("API error messages", () => {
  it.each(Array.from({ length: 22 }, (_, i) => `apiError${i + 1}`))("translates %s", (code) => {
    expect(apiErrorMessage(code)).toBe(ja[code as keyof typeof ja]);
    expect(apiErrorMessage(code)).not.toBe(code);
    expect(apiErrorMessage(code)).not.toBe(ja.apiErrorUnknown);
  });
  it.each(["apiError999", "apiError0", "unknown", "toString", "hintModel", "", null, undefined, 1])(
    "uses the fallback for %s",
    (code) => {
      expect(apiErrorMessage(code)).toBe(ja.apiErrorUnknown);
    },
  );
});

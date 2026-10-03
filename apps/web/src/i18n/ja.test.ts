import { copyAnswer, questions } from "@mer/core";
import { describe, expect, it } from "vitest";
import { apiErrorMessage, ja, t } from "./ja";
import { platformQuestions } from "./models";

describe("copy question translations", () => {
  it("renders new labels and option keys as the same text used by copy generation", () => {
    const cards = platformQuestions("phone", "mercari");
    for (const key of ["shipDays", "reason", "network", "smokePet"]) {
      const question = questions.phone.find((q) => q.key === key);
      const card = cards.find((q) => q.key === key);
      expect(question).toBeDefined();
      expect(card?.label).toBe(t(question?.label || ""));
      expect(card?.label).not.toBe(question?.label);
      expect(card?.options).toEqual(question?.options?.map(copyAnswer));
    }
  });
});

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

it("keeps service names out of the Japanese UI catalog", () => {
  for (const value of Object.values(ja))
    expect(value).not.toMatch(/メルカリ|ラクマ|ヤフオク|ジモティー|Yahoo[!！]フリマ/);
});

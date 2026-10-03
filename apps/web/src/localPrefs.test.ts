import { describe, expect, it } from "vitest";
import { defaults } from "./api";
import { t } from "./i18n/ja";
import { applyLocalPrefs, localPrefsKey, readLocalPrefs, writeLocalPrefs } from "./localPrefs";

describe("local preferences", () => {
  const storage = (value: string | null) => ({ getItem: () => value });
  it("defaults to flashy and preserves the server sound/vibration choices", () => {
    expect(readLocalPrefs(storage(null))).toEqual({
      effects: "flashy",
      sound: false,
      vibration: true,
      soundAsked: false,
    });
    expect(
      readLocalPrefs(storage(null), {
        ...defaults,
        sound: true,
        haptics: false,
        fx: t("fxOff"),
        soundAsked: true,
      }),
    ).toEqual({ effects: "flashy", sound: true, vibration: false, soundAsked: true });
  });
  it.each([
    "{",
    "null",
    "[]",
    "123",
    "{}",
    '{"effects":"subtle","sound":true,"vibration":true}',
    '{"effects":"normal","sound":"true","vibration":true}',
  ])("validates the whole stored object: %s", (value) => {
    expect(readLocalPrefs(storage(value))).toEqual(readLocalPrefs(storage(null)));
  });
  it("never throws if storage is blocked", () => {
    expect(
      readLocalPrefs({
        getItem() {
          throw Error();
        },
      }),
    ).toEqual(readLocalPrefs(storage(null)));
    expect(
      writeLocalPrefs(
        {
          setItem() {
            throw Error();
          },
        },
        readLocalPrefs(storage(null)),
      ),
    ).toBe(false);
  });
  it.each([
    ["none", "fxOff"],
    ["normal", "fxNormal"],
    ["flashy", "fxVivid"],
  ] as const)("round trips and applies %s without changing other settings", (effects, fx) => {
    const prefs = { effects, sound: true, vibration: false };
    let stored = "";
    expect(
      writeLocalPrefs(
        {
          setItem(key, value) {
            expect(key).toBe(localPrefsKey);
            stored = value;
          },
        },
        prefs,
      ),
    ).toBe(true);
    expect(JSON.parse(stored)).toEqual(prefs);
    const read = readLocalPrefs(storage(stored));
    expect(applyLocalPrefs(defaults, read)).toEqual({
      ...defaults,
      fx: t(fx),
      sound: true,
      soundAsked: true,
      haptics: false,
    });
    expect(defaults.sound).toBe(false);
  });
});

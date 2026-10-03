import { defaults, type Settings } from "./api";
import { t } from "./i18n/ja";

export interface LocalPrefs {
  effects: "none" | "normal" | "flashy";
  sound: boolean;
  vibration: boolean;
  // Read-time metadata only; the persisted object has exactly three fields.
  soundAsked?: boolean;
}
export const localPrefsKey = "fh.fx.v1";
export const browserStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};
export function readLocalPrefs(
  storage: Pick<Storage, "getItem">,
  serverSettings = defaults,
): LocalPrefs {
  try {
    const value = JSON.parse(storage.getItem(localPrefsKey) || "null");
    if (
      value &&
      ["none", "normal", "flashy"].includes(value.effects) &&
      typeof value.sound === "boolean" &&
      typeof value.vibration === "boolean"
    )
      return {
        effects: value.effects,
        sound: value.sound,
        vibration: value.vibration,
        soundAsked: true,
      };
  } catch {
    /* Unavailable storage or invalid JSON uses defaults. */
  }
  return {
    effects: "flashy",
    sound: serverSettings.sound,
    vibration: serverSettings.haptics,
    soundAsked: serverSettings.soundAsked,
  };
}
export function writeLocalPrefs(storage: Pick<Storage, "setItem">, prefs: LocalPrefs) {
  try {
    storage.setItem(
      localPrefsKey,
      JSON.stringify({ effects: prefs.effects, sound: prefs.sound, vibration: prefs.vibration }),
    );
    return true;
  } catch {
    return false;
  }
}
export function applyLocalPrefs(settings: Settings, prefs: LocalPrefs): Settings {
  return {
    ...settings,
    fx: { none: t("fxOff"), normal: t("fxNormal"), flashy: t("fxVivid") }[prefs.effects],
    sound: prefs.sound,
    haptics: prefs.vibration,
    soundAsked: prefs.soundAsked ?? true,
  };
}

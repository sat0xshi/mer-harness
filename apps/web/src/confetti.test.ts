import { describe, expect, it } from "vitest";
import type { CelebrationType } from "./celebrate";
import {
  createBurst,
  desktopFeedback,
  particleCount,
  saleAmount,
  shouldVibrate,
  stepParticles,
  viewportScale,
} from "./confetti";
import { t } from "./i18n/ja";

const counts: [CelebrationType, number, number][] = [
  ["listed", 240, 288],
  ["sold", 320, 384],
  ["shipped", 80, 96],
  ["levelup", 150, 150],
  ["badge", 150, 150],
  ["streak", 50, 60],
  ["combo", 30, 36],
  ["answer", 0, 0],
  ["photo", 0, 0],
  ["copy", 0, 0],
  ["buckle", 0, 0],
];
const viewport = { width: 1000, height: 800 };

// Deterministic variation keeps these tests independent of Math.random and the DOM.
function random() {
  let seed = 42;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe("confetti", () => {
  it.each(counts)(
    "respects every effect level and reduced motion for %s",
    (type, normal, vivid) => {
      expect(particleCount(type, t("fxNormal"), false)).toBe(normal);
      expect(particleCount(type, t("fxVivid"), false)).toBe(vivid);
      for (const fx of [t("fxOff"), t("fxSubtle")]) expect(particleCount(type, fx, false)).toBe(0);
      for (const fx of [t("fxOff"), t("fxSubtle"), t("fxNormal"), t("fxVivid")])
        expect(particleCount(type, fx, true)).toBe(0);
    },
  );

  it.each(["listed", "sold"] as const)(
    "launches %s from both corners and across the top",
    (type) => {
      const config = { ...viewport, type, count: particleCount(type, t("fxNormal"), false) };
      const particles = createBurst(config, random());
      expect(particles).toHaveLength(config.count);
      expect(createBurst(config, random())).toEqual(particles);
      expect(particles[0]).toMatchObject({ x: 8, y: 792 });
      expect(particles[0].vx).toBeGreaterThan(0);
      expect(particles[0].vy).toBeLessThan(0);
      expect(particles[1]).toMatchObject({ x: 992, y: 792 });
      expect(particles[1].vx).toBeLessThan(0);
      expect(particles[1].vy).toBeLessThan(0);
      const shower = particles.filter((_, i) => i % 3 === 2);
      expect(shower.every((p) => p.y <= 0 && p.vy > 0)).toBe(true);
      expect(Math.min(...shower.map((p) => p.x))).toBeLessThan(100);
      expect(Math.max(...shower.map((p) => p.x))).toBeGreaterThan(900);
      expect(new Set(particles.map((p) => p.shape))).toEqual(
        new Set(["circle", "rectangle", "ribbon", "star"]),
      );
    },
  );

  it("applies gravity, drag, rotation and fade without mutating its input", () => {
    const [particle] = createBurst({ ...viewport, type: "listed", count: 1 }, random());
    const initial = { ...particle, x: 500, y: 100, vx: 80, vy: 0, gravity: 100, lifetime: 2.5 };
    const [falling] = stepParticles([initial], 2, viewport);
    expect(initial).toMatchObject({ age: 0, y: 100, opacity: 1 });
    expect(falling.y).toBeGreaterThan(initial.y);
    expect(falling.vy).toBeGreaterThan(initial.vy);
    expect(falling.vx).toBeLessThan(initial.vx);
    expect(falling.rotation).not.toBe(initial.rotation);
    expect(falling.opacity).toBeGreaterThan(0);
    expect(falling.opacity).toBeLessThan(1);
    expect(stepParticles([falling], 0.5, viewport)).toEqual([]);
  });

  it("waits for delayed particles and integrates consistently at different frame rates", () => {
    const [particle] = createBurst({ ...viewport, type: "sold", count: 1 }, random());
    const initial = { ...particle, delay: 0.25 };
    const [waiting] = stepParticles([initial], 0.2, viewport);
    expect(waiting.x).toBe(initial.x);
    expect(waiting.y).toBe(initial.y);
    const [single] = stepParticles([initial], 0.5, viewport);
    let frames = [initial];
    for (let i = 0; i < 30; i++) frames = stepParticles(frames, 1 / 60, viewport);
    expect(frames[0].x).toBeCloseTo(single.x, 8);
    expect(frames[0].y).toBeCloseTo(single.y, 8);
  });

  it("removes off-screen particles, lets particles above the screen return, and ends by 2.8s", () => {
    const particles = createBurst({ ...viewport, type: "sold", count: 320 }, random());
    const p = particles[0];
    expect(stepParticles([{ ...p, y: 850, vy: 1 }], 0, viewport)).toEqual([]);
    expect(stepParticles([{ ...p, x: -50, vx: -1 }], 0, viewport)).toEqual([]);
    expect(stepParticles([{ ...p, x: 1050, vx: 1 }], 0, viewport)).toEqual([]);
    expect(stepParticles([{ ...p, y: -100, vy: 1 }], 0, viewport)).toHaveLength(1);
    expect(stepParticles(particles, 2.8, viewport)).toEqual([]);
    expect(createBurst({ ...viewport, type: "sold", count: 0 }, random())).toEqual([]);
  });
});

describe("celebration guards", () => {
  it("vibrates only when every preference and runtime condition allows it", () => {
    for (const haptics of [true, false])
      for (const quiet of [true, false])
        for (const reducedMotion of [true, false])
          for (const visible of [true, false])
            for (const supported of [true, false])
              expect(shouldVibrate({ haptics, quiet }, { reducedMotion, visible, supported })).toBe(
                haptics && !quiet && !reducedMotion && visible && supported,
              );
  });

  it.each([undefined, null, 0, -0, -1, Number.NaN, Infinity, -Infinity, "1200", {}, true])(
    "does not display or invent a sale amount for %s",
    (n) => expect(saleAmount(n)).toBeUndefined(),
  );
  it.each([1, 300, 195000, 123.45])("preserves the actual positive sale price %s", (n) => {
    expect(saleAmount(n)).toBe(n);
  });
});

describe("desktop parity", () => {
  it.each(["listed", "sold"] as const)(
    "scales %s for every effect level without overriding reduced motion",
    (type) => {
      const phone = { width: 390, height: 844 };
      const desktop = { width: 1920, height: 1080 };
      expect(viewportScale(phone.width, phone.height)).toEqual({ count: 1, size: 1 });
      expect(viewportScale(desktop.width, desktop.height).count).toBeCloseTo(2.19, 2);
      expect(viewportScale(desktop.width, desktop.height).size).toBeCloseTo(1.5, 1);
      for (const fx of [t("fxOff"), t("fxSubtle"), t("fxNormal"), t("fxVivid")]) {
        const base = particleCount(type, fx, false);
        expect(particleCount(type, fx, false, phone)).toBe(base);
        expect(particleCount(type, fx, false, desktop)).toBe(
          Math.round(base * viewportScale(1920, 1080).count),
        );
        for (const viewport of [phone, desktop])
          expect(particleCount(type, fx, true, viewport)).toBe(0);
        expect(particleCount(type, fx, false, { width: 10000, height: 10000 })).toBeLessThanOrEqual(
          900,
        );
      }
      const small = createBurst({ ...phone, count: 1, type }, () => 0.5)[0];
      const large = createBurst({ ...desktop, count: 1, type }, () => 0.5)[0];
      expect(large.size / small.size).toBeCloseTo(viewportScale(1920, 1080).size);
    },
  );
  it("uses visual substitutes on desktops and never enables sound on its own", () => {
    for (const canVibrate of [true, false])
      for (const coarsePointer of [true, false])
        for (const reducedMotion of [true, false])
          for (const sound of [true, false])
            for (const effects of [t("fxOff"), t("fxSubtle"), t("fxNormal"), t("fxVivid")]) {
              const flash =
                (!canVibrate || !coarsePointer) &&
                (effects === t("fxNormal") || effects === t("fxVivid"));
              expect(
                desktopFeedback({ canVibrate, coarsePointer, reducedMotion, sound, effects }),
              ).toEqual({ flash, shake: flash && !reducedMotion, sound });
            }
  });
});

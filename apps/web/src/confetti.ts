import { effectConfig, effectTier } from "@mer/core";
import type { Settings } from "./api";
import type { CelebrationType } from "./celebrate";
import { t } from "./i18n/ja";

export function viewportScale(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= effectConfig.viewport.phoneWidth ||
    height <= 0
  )
    return { count: 1, size: 1 };
  const count = Math.max(
    1,
    Math.min(
      effectConfig.viewport.maxScale,
      Math.sqrt(
        (width * height) /
          (effectConfig.viewport.phoneWidth * effectConfig.viewport.referenceHeight),
      ),
    ),
  );
  return {
    count,
    size: 1 + ((count - 1) / (effectConfig.viewport.maxScale - 1)) * effectConfig.viewport.sizeGain,
  };
}
export function desktopFeedback(environment: {
  canVibrate: boolean;
  coarsePointer: boolean;
  effects: Settings["fx"];
  reducedMotion: boolean;
  sound: boolean;
}) {
  const desktop = !environment.canVibrate || !environment.coarsePointer;
  const flash = desktop && [t("fxNormal"), t("fxVivid")].some((fx) => fx === environment.effects);
  return { flash, shake: flash && !environment.reducedMotion, sound: environment.sound };
}
export function particleCount(
  type: CelebrationType,
  fx: Settings["fx"],
  reducedMotion: boolean,
  viewport?: Viewport,
) {
  if (reducedMotion || fx === t("fxOff") || fx === t("fxSubtle")) return 0;
  const profile = effectProfile(type, fx);
  return Math.min(
    effectConfig.maxParticles,
    Math.round(
      profile.particles * (viewport ? viewportScale(viewport.width, viewport.height).count : 1),
    ),
  );
}

export function effectProfile(type: CelebrationType, fx: Settings["fx"]) {
  const tier = effectTier[type];
  const profile = effectConfig.tiers[Math.max(0, tier)];
  const enabled = fx === t("fxNormal") || fx === t("fxVivid");
  return {
    ...profile,
    particles:
      enabled && tier >= 0
        ? Math.round(profile.particles * (fx === t("fxVivid") ? effectConfig.vividMultiplier : 1))
        : 0,
    durationMs: tier < 0 ? effectConfig.minorDurationMs : profile.durationMs,
    shakePx: enabled
      ? profile.shakePx * (fx === t("fxVivid") ? effectConfig.vividMultiplier : 1)
      : 0,
    flash: enabled ? profile.flash : 0,
  };
}

export function shouldVibrate(
  settings: Pick<Settings, "haptics" | "quiet">,
  environment: { reducedMotion: boolean; visible: boolean; supported: boolean },
) {
  return (
    settings.haptics &&
    !settings.quiet &&
    !environment.reducedMotion &&
    environment.visible &&
    environment.supported
  );
}

export function saleAmount(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

interface Viewport {
  width: number;
  height: number;
}
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  rotation: number;
  spin: number;
  size: number;
  color: string;
  shape: "circle" | "rectangle" | "ribbon" | "star";
  age: number;
  lifetime: number;
  delay: number;
  opacity: number;
}

// Positions are CSS pixels; time and velocities use seconds, independent of refresh rate.
export function createBurst(
  config: Viewport & { count: number; type: CelebrationType },
  rng: () => number,
): Particle[] {
  const { width, height, count, type } = config;
  const wide = type === "listed" || type === "sold" || type === "bossDefeat";
  const colors = effectConfig.colors;
  const shapes = effectConfig.shapes;
  return Array.from({ length: count }, (_, i) => {
    const source = i % 3;
    const shower = wide && source === 2;
    return {
      x: wide ? (shower ? rng() * width : source === 0 ? 8 : width - 8) : width / 2,
      y: wide ? (shower ? -rng() * 80 : height - 8) : height * 0.35,
      vx: wide
        ? shower
          ? (rng() - 0.5) * 100
          : (source === 0 ? 1 : -1) * width * (0.2 + rng() * 0.45)
        : (rng() - 0.5) * 1000,
      vy: wide ? (shower ? 80 + rng() * 160 : -height * (1.1 + rng() * 0.3)) : -180 - rng() * 600,
      gravity: wide ? height : 1260,
      rotation: rng() * Math.PI * 2,
      spin: (rng() - 0.5) * 12,
      size: (3 + rng() * 4) * viewportScale(width, height).size,
      color: colors[Math.floor(rng() * colors.length)],
      shape: shapes[Math.floor(rng() * shapes.length)],
      age: 0,
      lifetime:
        (effectProfile(type, t("fxNormal")).durationMs - effectConfig.particleTailMs) / 1000 -
        rng() * effectConfig.particleLifetimeVariation,
      delay: shower ? rng() * 0.3 : type === "sold" && i % 2 ? 0.25 : 0,
      opacity: 1,
    };
  });
}

export function stepParticles(particles: readonly Particle[], dt: number, viewport: Viewport) {
  return particles.flatMap((p) => {
    const age = p.age + Math.max(0, dt);
    const elapsed = Math.max(0, age - p.delay);
    if (elapsed >= p.lifetime) return [];
    const delta = elapsed - Math.max(0, p.age - p.delay);
    const drag = Math.exp(-0.5 * delta);
    const next = {
      ...p,
      age,
      x: p.x + (p.vx * (1 - drag)) / 0.5,
      y: p.y + p.vy * delta + 0.5 * p.gravity * delta ** 2,
      vx: p.vx * drag,
      vy: p.vy + p.gravity * delta,
      rotation: p.rotation + p.spin * delta,
      opacity: Math.min(1, Math.max(0, (p.lifetime - elapsed) / 0.8)),
    };
    // Particles above the viewport may still fall back into view.
    if (
      (next.y > viewport.height + 40 && next.vy > 0) ||
      (next.x < -40 && next.vx <= 0) ||
      (next.x > viewport.width + 40 && next.vx >= 0)
    )
      return [];
    return [next];
  });
}

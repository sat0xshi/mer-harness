import {
  effectConfig,
  type effectTier,
  formatCurrency,
  celebrationHaptics as haptics,
  celebrationPriority as priority,
  celebrationSounds as sounds,
} from "@mer/core";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { Settings } from "./api";
import {
  createBurst,
  desktopFeedback,
  effectProfile,
  particleCount,
  saleAmount,
  shouldVibrate,
  stepParticles,
} from "./confetti";
import { t } from "./i18n/ja";
import { playSound } from "./sound";
export type CelebrationType = keyof typeof effectTier;
interface Celebration {
  type: CelebrationType;
  text: string;
  n?: number;
  time: number;
}
const bus = new EventTarget();
export function celebrate(type: CelebrationType, text: string, n?: number) {
  bus.dispatchEvent(new CustomEvent("celebrate", { detail: { type, text, n, time: Date.now() } }));
}
export function CelebrationHost({ settings, onAsk }: { settings: Settings; onAsk: () => void }) {
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const stopHaptics = useRef<() => void>(() => {});
  const [active, setActive] = useState<Celebration | null>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    queue = useRef<Celebration[]>([]),
    busy = useRef(false),
    config = useRef(settings),
    ask = useRef(onAsk),
    asked = useRef(false),
    skip = useRef<() => void>(() => {});
  config.current = settings;
  ask.current = onAsk;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let vibrating = false;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const cancelVibration = () => {
      if (vibrating) navigator.vibrate(0);
      vibrating = false;
    };
    stopHaptics.current = cancelVibration;
    const motionChanged = () => {
      setReducedMotion(motion.matches);
      if (motion.matches) cancelVibration();
    };
    const visibilityChanged = () => {
      if (document.visibilityState !== "visible") cancelVibration();
    };
    motionChanged();
    motion.addEventListener("change", motionChanged);
    document.addEventListener("visibilitychange", visibilityChanged);
    const next = () => {
      if (busy.current || !queue.current.length) return;
      queue.current.sort((a, b) => priority[b.type] - priority[a.type]);
      const e = queue.current.shift();
      if (!e) return;
      busy.current = true;
      setActive(e);
      if (!config.current.soundAsked && !asked.current) {
        asked.current = true;
        ask.current();
      }
      // Queued feedback may be visual, but stale/background events must never make sound.
      if (Date.now() - e.time < effectConfig.staleSoundMs) {
        const feedback = desktopFeedback({
          canVibrate: "vibrate" in navigator,
          coarsePointer: matchMedia("(pointer: coarse)").matches,
          effects: config.current.fx,
          reducedMotion: motion.matches,
          sound: config.current.sound,
        });
        if (feedback.sound) playSound(sounds[e.type], config.current, e.n);
        if (
          shouldVibrate(config.current, {
            reducedMotion: motion.matches,
            visible: document.visibilityState === "visible",
            supported: "vibrate" in navigator && matchMedia("(pointer: coarse)").matches,
          })
        ) {
          vibrating = true;
          navigator.vibrate(
            haptics[e.type].map((v, i) => (i % 2 ? v : Math.round(v * config.current.hapticScale))),
          );
        }
      }
      timer = setTimeout(finish, effectProfile(e.type, config.current.fx).durationMs);
    };
    const finish = () => {
      clearTimeout(timer);
      cancelVibration();
      setActive(null);
      busy.current = false;
      next();
    };
    skip.current = finish;
    const listener = (event: Event) => {
      queue.current.push((event as CustomEvent<Celebration>).detail);
      if (queue.current.length > effectConfig.maxQueue) queue.current.shift();
      next();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busy.current) finish();
    };
    window.addEventListener("keydown", keydown);
    bus.addEventListener("celebrate", listener);
    return () => {
      window.removeEventListener("keydown", keydown);
      bus.removeEventListener("celebrate", listener);
      clearTimeout(timer);
      cancelVibration();
      motion.removeEventListener("change", motionChanged);
      document.removeEventListener("visibilitychange", visibilityChanged);
      queue.current = [];
      busy.current = false;
      skip.current = () => {};
      stopHaptics.current = () => {};
    };
  }, []);
  useEffect(() => {
    if (!settings.haptics || settings.quiet) stopHaptics.current();
  }, [settings.haptics, settings.quiet]);
  useEffect(() => {
    if (!active || !canvas.current) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let count = particleCount(active.type, settings.fx, reducedMotion || motion.matches);
    if (!count) return;
    const cv = canvas.current,
      ctx = cv.getContext("2d");
    if (!ctx) return;
    let viewport = { width: innerWidth, height: innerHeight };
    count = particleCount(active.type, settings.fx, false, viewport);
    let particles = createBurst({ ...viewport, count, type: active.type }, Math.random);
    let frame = 0,
      previous = performance.now(),
      drops = 0,
      stopped = false;
    const start = previous;
    const duration = effectProfile(active.type, settings.fx).durationMs;
    const clear = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
    };
    const resize = () => {
      const next = { width: innerWidth, height: innerHeight };
      particles = particles.map((p) => ({
        ...p,
        x: (p.x * next.width) / viewport.width,
        y: (p.y * next.height) / viewport.height,
        vx: (p.vx * next.width) / viewport.width,
        vy: (p.vy * next.height) / viewport.height,
        gravity: (next.height / viewport.height) * p.gravity,
      }));
      viewport = next;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(viewport.width * dpr);
      cv.height = Math.round(viewport.height * dpr);
    };
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      clear();
      particles = [];
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibilityChanged);
      motion.removeEventListener("change", motionChanged);
    };
    const visibilityChanged = () => {
      if (document.hidden) stop();
    };
    const motionChanged = () => {
      if (motion.matches) stop();
    };
    const draw = (now: number) => {
      if (stopped || document.hidden || motion.matches || now - start >= duration) {
        stop();
        return;
      }
      if (now - previous > 30 && ++drops >= 3) {
        particles = particles.slice(0, Math.ceil(particles.length / 2));
        drops = 0;
      }
      particles = stepParticles(particles, (now - previous) / 1000, viewport);
      previous = now;
      clear();
      ctx.setTransform(cv.width / viewport.width, 0, 0, cv.height / viewport.height, 0, 0);
      for (const p of particles) {
        if (p.age < p.delay) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity;
        if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === "star") {
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const angle = (i * Math.PI) / 5 - Math.PI / 2;
            const radius = i % 2 ? p.size * 0.45 : p.size;
            ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
          }
          ctx.closePath();
          ctx.fill();
        } else if (p.shape === "ribbon") {
          ctx.scale(Math.cos(p.age * 8) * 0.4 + 0.6, 1);
          ctx.fillRect(-p.size / 3, -p.size * 1.5, p.size * 0.65, p.size * 3);
        } else ctx.fillRect(-p.size / 2, -p.size, p.size, p.size * 2);
        ctx.restore();
      }
      if (particles.length) frame = requestAnimationFrame(draw);
      else stop();
    };
    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibilityChanged);
    motion.addEventListener("change", motionChanged);
    frame = requestAnimationFrame(draw);
    return stop;
  }, [active, settings.fx, reducedMotion]);
  const feedback = desktopFeedback({
    canVibrate: "vibrate" in navigator,
    coarsePointer: matchMedia("(pointer: coarse)").matches,
    effects: settings.fx,
    reducedMotion,
    sound: settings.sound,
  });
  const major =
    active?.type === "listed" || active?.type === "sold" || active?.type === "bossDefeat";
  const profile = effectProfile(active?.type ?? "answer", settings.fx);
  useEffect(() => {
    if (!active || !major || !feedback.shake || document.hidden) return;
    const main = document.querySelector("main");
    const className = "feedback-shake-listed";
    main?.style.setProperty("--shake-distance", `${profile.shakePx}px`);
    main?.classList.add(className);
    main?.parentElement?.classList.add("feedback-clip");
    const cleanup = () => {
      main?.style.removeProperty("--shake-distance");
      main?.classList.remove(className);
      main?.parentElement?.classList.remove("feedback-clip");
    };
    const timer = setTimeout(cleanup, effectConfig.shakeDurationMs);
    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, [active, major, feedback.shake, profile.shakePx]);
  const amount =
    active?.type === "sold" || active?.type === "bossDefeat" ? saleAmount(active.n) : undefined;
  const big = major && settings.fx !== t("fxOff") && settings.fx !== t("fxSubtle");
  return (
    <>
      {active && major && feedback.flash && !document.hidden && (
        <div
          key={`flash:${active.time}:${active.type}`}
          className="feedback-flash"
          style={
            {
              "--flash-opacity": reducedMotion ? effectConfig.reducedFlash : profile.flash,
            } as CSSProperties
          }
          data-reduced-motion={reducedMotion}
          aria-hidden="true"
        />
      )}
      <canvas className="confetti" aria-hidden="true" tabIndex={-1} ref={canvas} />
      <div
        className="celebration-region"
        data-big={big}
        role="status"
        aria-live="polite"
        style={
          {
            "--celebration-duration": `${profile.durationMs}ms`,
            "--text-scale": profile.textScale,
          } as CSSProperties
        }
      >
        {active && (
          <button
            key={`${active.time}:${active.type}`}
            className={`celebration ${settings.fx === t("fxOff") ? "plain" : ""}`}
            data-reduced-motion={reducedMotion}
            onClick={() => skip.current()}
          >
            {active.type === "bossDefeat" && (
              <strong className="boss-defeat-label">{t("bossDefeated")}</strong>
            )}
            {active.text}
            {amount !== undefined && <strong className="sales">{formatCurrency(amount)}</strong>}
            <small>{t("dismissCelebration")}</small>
          </button>
        )}
      </div>
    </>
  );
}

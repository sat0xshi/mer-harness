import { formatCurrency } from "@mer/core";
import { useEffect, useRef, useState } from "react";
import type { Settings } from "./api";
import { createBurst, particleCount, saleAmount, shouldVibrate, stepParticles } from "./confetti";
import { t } from "./i18n/ja";
import { playSound, type Sound } from "./sound";
export type CelebrationType =
  | "answer"
  | "photo"
  | "copy"
  | "listed"
  | "sold"
  | "shipped"
  | "levelup"
  | "streak"
  | "combo"
  | "badge"
  | "buckle";
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
const priority: Record<CelebrationType, number> = {
  levelup: 9,
  badge: 8,
  sold: 7,
  shipped: 6,
  listed: 5,
  combo: 3,
  streak: 2,
  photo: 1,
  answer: 0,
  copy: 0,
  buckle: 0,
};
const sounds: Record<CelebrationType, Sound> = {
  levelup: "levelup",
  badge: "levelup",
  sold: "sold",
  shipped: "ship",
  listed: "pikon",
  combo: "combo",
  streak: "streak",
  photo: "check",
  answer: "tap",
  copy: "check",
  buckle: "buckle",
};
const haptics: Record<CelebrationType, number[]> = {
  answer: [10],
  photo: [10],
  copy: [12, 40, 12],
  buckle: [8, 30, 20],
  listed: [15, 50, 25],
  shipped: [15, 40, 15, 40, 60],
  sold: [15, 50, 15, 50, 30],
  levelup: [20, 40, 20, 40, 20, 40, 120],
  badge: [20, 40, 20],
  streak: [25, 80, 25],
  combo: [10, 30, 10],
};
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
    skip = useRef<() => void>(() => {}),
    last = useRef<Record<string, number>>({});
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
      if (Date.now() - e.time < 900) {
        playSound(sounds[e.type], config.current, e.n);
        if (
          shouldVibrate(config.current, {
            reducedMotion: motion.matches,
            visible: document.visibilityState === "visible",
            supported: "vibrate" in navigator,
          })
        ) {
          vibrating = true;
          navigator.vibrate(
            haptics[e.type].map((v, i) => (i % 2 ? v : Math.round(v * config.current.hapticScale))),
          );
        }
      }
      timer = setTimeout(
        finish,
        e.type === "listed" || e.type === "sold" ? 2800 : priority[e.type] >= 5 ? 2000 : 700,
      );
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
      if (queue.current.length > 12) queue.current.shift();
      next();
    };
    bus.addEventListener("celebrate", listener);
    return () => {
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
    // Apply the existing frequency caps before the vivid multiplier.
    count = particleCount(active.type, t("fxNormal"), false);
    if (active.type === "streak" && ![7, 30, 100].includes(active.n || 0)) count = 0;
    if (active.type === "combo" && active.n !== 4) count = 0;
    if (Date.now() - (last.current[active.type] || 0) < 10000) count = Math.min(60, count);
    last.current[active.type] = Date.now();
    if (count === 150) {
      const key = `harness-burst:${new Date().toDateString()}`;
      let bursts = 0;
      try {
        bursts = Number(localStorage.getItem(key) || 0);
        localStorage.setItem(key, String(bursts + 1));
      } catch {
        /* Storage can be unavailable. */
      }
      if (bursts >= 3) count = 100;
    }
    if (settings.fx === t("fxVivid"))
      count = Math.min(particleCount(active.type, settings.fx, false), Math.round(count * 1.2));
    if (!count) return;
    let viewport = { width: innerWidth, height: innerHeight };
    let particles = createBurst({ ...viewport, count, type: active.type }, Math.random);
    let frame = 0,
      previous = performance.now(),
      drops = 0,
      stopped = false;
    const start = previous;
    const duration = active.type === "listed" || active.type === "sold" ? 2800 : 2400;
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
  const amount = active?.type === "sold" ? saleAmount(active.n) : undefined;
  const big =
    (active?.type === "listed" || active?.type === "sold") &&
    settings.fx !== t("fxOff") &&
    settings.fx !== t("fxSubtle");
  return (
    <>
      <canvas className="confetti" aria-hidden="true" tabIndex={-1} ref={canvas} />
      <div className="celebration-region" data-big={big} role="status" aria-live="polite">
        {active && (
          <button
            key={`${active.time}:${active.type}`}
            className={`celebration ${settings.fx === t("fxOff") ? "plain" : ""}`}
            data-reduced-motion={reducedMotion}
            onClick={() => skip.current()}
          >
            {active.text}
            {amount !== undefined && <strong className="sales">{formatCurrency(amount)}</strong>}
            <small>{t("dismissCelebration")}</small>
          </button>
        )}
      </div>
    </>
  );
}

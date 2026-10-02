import { formatCurrency } from "@mer/core";
import { useEffect, useRef, useState } from "react";
import { AnimatedNumber } from "./AnimatedNumber";
import type { Settings } from "./api";
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
  listed: [20, 60, 40],
  shipped: [15, 40, 15, 40, 60],
  sold: [30, 50, 30, 50, 90],
  levelup: [20, 40, 20, 40, 20, 40, 120],
  badge: [20, 40, 20],
  streak: [25, 80, 25],
  combo: [10, 30, 10],
};
export function CelebrationHost({ settings, onAsk }: { settings: Settings; onAsk: () => void }) {
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
          config.current.haptics &&
          !config.current.quiet &&
          document.visibilityState === "visible" &&
          "vibrate" in navigator
        )
          navigator.vibrate(
            haptics[e.type].map((v, i) => (i % 2 ? v : Math.round(v * config.current.hapticScale))),
          );
      }
      timer = setTimeout(finish, priority[e.type] >= 5 ? 2000 : 700);
    };
    const finish = () => {
      clearTimeout(timer);
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
    };
  }, []);
  useEffect(() => {
    if (
      !active ||
      !canvas.current ||
      settings.fx === t("fxOff") ||
      settings.fx === t("fxSubtle") ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const cv = canvas.current,
      ctx = cv.getContext("2d");
    if (!ctx) return;
    let count =
      (
        {
          listed: 60,
          sold: 120,
          shipped: 80,
          levelup: 150,
          badge: 150,
          streak: 50,
          combo: 30,
        } as Partial<Record<CelebrationType, number>>
      )[active.type] || 0;
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
    if (settings.fx === t("fxVivid")) count = Math.min(150, Math.round(count * 1.2));
    cv.width = innerWidth;
    cv.height = innerHeight;
    const colors = ["#F5B301", "#3B4BD8", "#00B8A9", "#FF8FB1", "#FFFFFF"];
    const particles = Array.from({ length: count }, () => ({
      x: innerWidth / 2,
      y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 18,
      vy: -Math.random() * 13 - 3,
      rotation: Math.random() * 6,
      color: colors[Math.floor(Math.random() * 5)],
      circle: Math.random() > 0.5,
      delay: active.type === "sold" && Math.random() > 0.5 ? 350 : 0,
    }));
    let frame = 0,
      start = performance.now(),
      previous = start,
      drops = 0,
      stopped = false;
    const draw = (now: number) => {
      if (stopped || document.hidden || now - start > 2400) {
        ctx.clearRect(0, 0, cv.width, cv.height);
        return;
      }
      if (now - previous > 30 && ++drops >= 3) {
        particles.splice(Math.ceil(particles.length / 2));
        drops = 0;
      }
      const delta = Math.min(2, (now - previous) / 16.67);
      previous = now;
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of particles) {
        if (now - start < p.delay) continue;
        p.vy += 0.35 * delta;
        p.vx += (Math.random() - 0.5) * 0.2;
        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.rotation += 0.06 * delta;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        if (p.circle) {
          ctx.beginPath();
          ctx.arc(0, 0, 3, 0, Math.PI * 2);
          ctx.fill();
        } else ctx.fillRect(-3, -5, 6, 10);
        ctx.restore();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      ctx.clearRect(0, 0, cv.width, cv.height);
    };
    document.addEventListener("visibilitychange", stop);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", stop);
    };
  }, [active, settings.fx]);
  return (
    <>
      <canvas className="confetti" aria-hidden="true" tabIndex={-1} ref={canvas} />
      <div className="celebration-region" role="status" aria-live="polite">
        {active && (
          <button
            className={`celebration ${settings.fx === t("fxOff") ? "plain" : ""}`}
            onClick={() => skip.current()}
          >
            {active.text}
            {active.type === "sold" && active.n !== undefined && (
              <strong className="sales">
                <AnimatedNumber value={active.n} settings={settings} format={formatCurrency} />
              </strong>
            )}
            <small>{t("dismissCelebration")}</small>
          </button>
        )}
      </div>
    </>
  );
}

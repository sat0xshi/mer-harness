import { useEffect, useRef, useState } from "react";
import type { Settings } from "./api";
import { t } from "./i18n/ja";
export function AnimatedNumber({
  value,
  settings,
  format,
}: {
  value: number;
  settings: Settings;
  format: (n: number) => string;
}) {
  const previous = useRef(0),
    [display, setDisplay] = useState(value);
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (
      settings.fx === t("fxOff") ||
      settings.fx === t("fxSubtle") ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setDisplay(Math.round(from + (value - from) * (1 - (1 - t) ** 3)));
      if (t < 1 && !document.hidden) frame = requestAnimationFrame(draw);
      else setDisplay(value);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [value, settings.fx]);
  return (
    <span>
      <span className="sr-only">{format(value)}</span>
      <span aria-hidden="true">{format(display)}</span>
    </span>
  );
}

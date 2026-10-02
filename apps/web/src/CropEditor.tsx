import { useEffect, useRef, useState } from "react";
import { t } from "./i18n/ja";
import { defaultCrop, drawCrop, jpeg, loadImage } from "./image";
export function CropEditor({
  file,
  onSave,
  onCancel,
}: {
  file: File;
  onSave: (blob: Blob) => Promise<void>;
  onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    image = useRef<ImageBitmap | null>(null),
    drag = useRef<{ x: number; y: number } | null>(null);
  const [crop, setCrop] = useState(defaultCrop),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [compare, setCompare] = useState(0);
  const original = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    loadImage(file)
      .then((bitmap) => {
        if (!active) {
          bitmap.close();
          return;
        }
        image.current = bitmap;
        setReady(true);
      })
      .catch(() => setError(t("photoOpenError")));
    return () => {
      active = false;
      image.current?.close();
      image.current = null;
    };
  }, [file]);
  useEffect(() => {
    if (ready && canvas.current && original.current && image.current) {
      drawCrop(canvas.current, image.current, crop);
      drawCrop(original.current, image.current, crop, false);
    }
  }, [crop, ready]);
  return (
    <section className="card crop-editor">
      <div className="eyebrow">PHOTO STUDIO · 1:1</div>
      <h2>{t("cropHeading")}</h2>
      <p className="sub">{t("cropHint")}</p>
      <div
        className="crop-stage"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x,
            dy = e.clientY - drag.current.y;
          drag.current = { x: e.clientX, y: e.clientY };
          setCrop((c) => ({
            ...c,
            x: Math.max(-1, Math.min(1, c.x - dx / 120)),
            y: Math.max(-1, Math.min(1, c.y - dy / 120)),
          }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <canvas ref={canvas} />
        <canvas
          ref={original}
          className="original"
          style={{ clipPath: `inset(0 ${100 - compare}% 0 0)` }}
        />
        <span className="crop-guide" />
      </div>
      <label>
        {t("cropCompare")}
        <input
          type="range"
          min="0"
          max="100"
          value={compare}
          onChange={(e) => setCompare(Number(e.target.value))}
        />
      </label>
      <label>
        {t("cropZoom")}
        <input
          type="range"
          min="1"
          max="3"
          step="0.01"
          value={crop.zoom}
          onChange={(e) => setCrop({ ...crop, zoom: Number(e.target.value) })}
        />
      </label>
      <div className="two">
        <label>
          {t("cropHorizontal")}
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={crop.x}
            onChange={(e) => setCrop({ ...crop, x: Number(e.target.value) })}
          />
        </label>
        <label>
          {t("cropVertical")}
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={crop.y}
            onChange={(e) => setCrop({ ...crop, y: Number(e.target.value) })}
          />
        </label>
      </div>
      <label>
        {t("cropBrightness")}
        <input
          type="range"
          min="0.7"
          max="1.5"
          step="0.01"
          value={crop.brightness}
          onChange={(e) => setCrop({ ...crop, brightness: Number(e.target.value) })}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={crop.auto}
          onChange={(e) => setCrop({ ...crop, auto: e.target.checked })}
        />
        {t("cropAuto")}
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={crop.white}
          onChange={(e) => setCrop({ ...crop, white: e.target.checked })}
        />
        {t("cropWhite")}
      </label>
      {crop.white && (
        <>
          <p className="sub">{t("cropWhiteHint")}</p>
          <label>
            {t("cropThreshold")}
            <input
              type="range"
              min="10"
              max="150"
              value={crop.threshold}
              onChange={(e) => setCrop({ ...crop, threshold: Number(e.target.value) })}
            />
          </label>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <button onClick={() => setCrop(defaultCrop)}>{t("resetCrop")}</button>
        <button
          className="primary"
          disabled={!ready || busy}
          onClick={async () => {
            if (!canvas.current) return;
            setBusy(true);
            try {
              await onSave(await jpeg(canvas.current));
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? t("saving") : t("acceptCrop")}
        </button>
      </div>
      <button className="text-button" onClick={onCancel}>
        {t("cancelPhoto")}
      </button>
    </section>
  );
}

import { t } from "./i18n/ja";
export interface Crop {
  zoom: number;
  x: number;
  y: number;
  brightness: number;
  auto: boolean;
  white: boolean;
  threshold: number;
}
export const defaultCrop: Crop = {
  zoom: 1,
  x: 0,
  y: 0,
  brightness: 1.1,
  auto: true,
  white: false,
  threshold: 45,
};
export async function loadImage(file: Blob) {
  if (file.size > 30 * 1024 * 1024) throw Error(t("photoSizeError"));
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  return bitmap;
}
export function drawCrop(
  canvas: HTMLCanvasElement,
  image: ImageBitmap,
  crop: Crop,
  processed = true,
) {
  const size = Math.min(1080, image.width, image.height),
    side = Math.min(image.width, image.height) / crop.zoom;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw Error(t("canvasError"));
  const sx = ((image.width - side) / 2) * (1 + crop.x),
    sy = ((image.height - side) / 2) * (1 + crop.y);
  ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size);
  if (!processed) return;
  const pixels = ctx.getImageData(0, 0, size, size),
    d = pixels.data;
  if (crop.white) {
    // Flood-fill only corner/edge-connected colors. Similar colors inside the subject stay intact.
    const refs = [0, size - 1, size * (size - 1), size * size - 1].map((p) => [
      d[p * 4],
      d[p * 4 + 1],
      d[p * 4 + 2],
    ]);
    const seen = new Uint8Array(size * size),
      queue = new Int32Array(size * size);
    let head = 0,
      tail = 0;
    const push = (p: number) => {
      if (seen[p]) return;
      seen[p] = 1;
      const i = p * 4;
      if (
        refs.some((r) => Math.hypot(d[i] - r[0], d[i + 1] - r[1], d[i + 2] - r[2]) < crop.threshold)
      ) {
        queue[tail++] = p;
      }
    };
    for (let n = 0; n < size; n++) {
      push(n);
      push(size * (size - 1) + n);
      push(n * size);
      push(n * size + size - 1);
    }
    while (head < tail) {
      const p = queue[head++],
        x = p % size,
        y = Math.floor(p / size);
      d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = 255;
      if (x > 0) push(p - 1);
      if (x < size - 1) push(p + 1);
      if (y > 0) push(p - size);
      if (y < size - 1) push(p + size);
    }
  }
  let low = 0,
    high = 255;
  if (crop.auto) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4)
      hist[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += hist[i];
      if (sum < size * size * 0.01) low = i;
      if (sum < size * size * 0.99) high = i;
    }
    if (high - low < 80) {
      low = 0;
      high = 255;
    }
  }
  for (let i = 0; i < d.length; i += 4)
    for (let c = 0; c < 3; c++)
      d[i + c] = Math.max(
        0,
        Math.min(255, (((d[i + c] - low) * 255) / Math.max(1, high - low)) * crop.brightness),
      );
  ctx.putImageData(pixels, 0, 0);
}
export async function jpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  for (let q = 0.88; q >= 0.38; q -= 0.1) {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(Error(t("photoSaveError")))), "image/jpeg", q),
    );
    if (blob.size <= 250 * 1024) return blob;
  }
  const smaller = document.createElement("canvas");
  smaller.width = Math.round(canvas.width * 0.8);
  smaller.height = Math.round(canvas.height * 0.8);
  smaller.getContext("2d")?.drawImage(canvas, 0, 0, smaller.width, smaller.height);
  return jpeg(smaller);
}
export async function screenshotJpeg(file: Blob) {
  const image = await loadImage(file);
  try {
    const canvas = document.createElement("canvas"),
      scale = Math.min(1, 1080 / Math.max(image.width, image.height));
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await jpeg(canvas);
  } finally {
    image.close();
  }
}

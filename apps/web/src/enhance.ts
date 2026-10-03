// Pure, global-only image processing. All tuning limits are explicit and exported.
export const gridMaxSide = 128;
export const borderFraction = 0.04;
export const borderSpreadPercentile = 0.8;
export const maxBorderSpread = 32;
export const subjectColorDistance = 38;
export const subjectEdgeMagnitude = 35;
export const minSubjectFraction = 0.01;
export const maxSubjectFraction = 0.85;
export const minLineFraction = 0.015;
export const minLineCells = 2;
export const cropPadding = 0.12;
export const minCropFraction = 0.35;
export const midtoneLow = 20;
export const midtoneHigh = 235;
export const maxSaturation = 0.45;
export const minMidtonePixels = 16;
export const minMidtoneFraction = 0.01;
export const whiteBalanceStrength = 0.6;
export const minChannelGain = 0.88;
export const maxChannelGain = 1.12;
export const maxChannelGainRatio = 1.2;
export const lowPercentile = 0.01;
export const highPercentile = 0.99;
export const maxBlackPoint = 24;
export const minWhitePoint = 200;
export const minLevelsRange = 80;
export const maxStretchGain = 1.25;
export const targetLuminance = 118;
export const minGamma = 0.8;
export const maxChannelShift = 48;
// Blend cap for the full correction, and the minimum LUT slope: every input step keeps at
// least 70% of its difference (soft toe/shoulder instead of hard clipping), so scratches
// and dirt in shadows/highlights stay visible.
export const maxStrength = 0.75;
export const minLutSlope = 0.7;
export const maxContrast = 0; // No added contrast: preserve surface detail.

export interface SubjectBox {
  x: number;
  y: number;
  size: number;
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const quantile = (values: number[], p: number) => {
  values.sort((a, b) => a - b);
  return values[Math.floor((values.length - 1) * p)] ?? 0;
};

export function subjectBox(data: Uint8ClampedArray, width: number, height: number): SubjectBox {
  const side = Math.min(width, height);
  const centre = {
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2),
    size: side,
  };
  const scale = Math.min(1, gridMaxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)),
    h = Math.max(1, Math.round(height * scale));
  const grid: number[][] = [],
    border: number[][] = [];
  const ring = Math.max(1, Math.round(Math.min(w, h) * borderFraction));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i =
        (Math.min(height - 1, Math.floor(((y + 0.5) * height) / h)) * width +
          Math.min(width - 1, Math.floor(((x + 0.5) * width) / w))) *
        4;
      const pixel = [data[i], data[i + 1], data[i + 2]];
      grid.push(pixel);
      if (x < ring || y < ring || x >= w - ring || y >= h - ring) border.push(pixel);
    }
  const bg = [0, 1, 2].map((c) =>
    quantile(
      border.map((p) => p[c]),
      0.5,
    ),
  );
  const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  if (
    quantile(
      border.map((p) => distance(p, bg)),
      borderSpreadPercentile,
    ) > maxBorderSpread
  )
    return centre;
  const rows = new Uint32Array(h),
    cols = new Uint32Array(w);
  const points: [number, number][] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = grid[y * w + x];
      const edge = Math.max(
        x ? distance(p, grid[y * w + x - 1]) : 0,
        y ? distance(p, grid[(y - 1) * w + x]) : 0,
      );
      if (distance(p, bg) > subjectColorDistance || edge > subjectEdgeMagnitude) {
        rows[y]++;
        cols[x]++;
        points.push([x, y]);
      }
    }
  const kept = points.filter(
    ([x, y]) =>
      rows[y] >= Math.max(minLineCells, w * minLineFraction) &&
      cols[x] >= Math.max(minLineCells, h * minLineFraction),
  );
  if (kept.length < w * h * minSubjectFraction || kept.length > w * h * maxSubjectFraction)
    return centre;
  let left = w,
    right = 0,
    top = h,
    bottom = 0;
  for (const [x, y] of kept) {
    left = Math.min(left, x);
    right = Math.max(right, x + 1);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y + 1);
  }
  // Include a sampling cell on both sides so downsampling cannot trim the item.
  left = Math.max(0, ((left - 1) * width) / w);
  right = Math.min(width, ((right + 1) * width) / w);
  top = Math.max(0, ((top - 1) * height) / h);
  bottom = Math.min(height, ((bottom + 1) * height) / h);
  const extent = Math.max(right - left, bottom - top);
  if (extent > side * maxSubjectFraction) return centre;
  const size = clamp(
    Math.ceil(Math.max(side * minCropFraction, extent * (1 + 2 * cropPadding))),
    1,
    side,
  );
  return {
    x: clamp(Math.round((left + right - size) / 2), 0, width - size),
    y: clamp(Math.round((top + bottom - size) / 2), 0, height - size),
    size,
  };
}

export interface Adjustment {
  gains: [number, number, number];
  blackPoint: number;
  whitePoint: number;
  stretchGain: number;
  gamma: number;
  strength: number;
  luts: [Uint8Array, Uint8Array, Uint8Array];
}
export function analyzeAdjustment(data: Uint8ClampedArray): Adjustment {
  const hist = new Uint32Array(256),
    sums = [0, 0, 0];
  const count = Math.floor(data.length / 4);
  let midtones = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const lum = luminance(r, g, b),
      max = Math.max(r, g, b);
    hist[Math.round(lum)]++;
    if (
      lum >= midtoneLow &&
      lum <= midtoneHigh &&
      (max - Math.min(r, g, b)) / Math.max(1, max) < maxSaturation
    ) {
      midtones++;
      sums[0] += r;
      sums[1] += g;
      sums[2] += b;
    }
  }
  let gains: [number, number, number] = [1, 1, 1];
  if (midtones >= Math.max(minMidtonePixels, count * minMidtoneFraction)) {
    const neutral = (sums[0] + sums[1] + sums[2]) / 3;
    gains = sums.map((sum) =>
      clamp(
        1 + whiteBalanceStrength * (neutral / Math.max(1, sum) - 1),
        minChannelGain,
        maxChannelGain,
      ),
    ) as typeof gains;
    const min = Math.min(...gains);
    gains = gains.map((g) => Math.min(g, min * maxChannelGainRatio)) as typeof gains;
  }
  const percentile = (p: number) => {
    let total = 0;
    for (let i = 0; i < 256; i++) {
      total += hist[i];
      if (total >= Math.max(1, count * p)) return i;
    }
    return 255;
  };
  const low = percentile(lowPercentile),
    high = percentile(highPercentile);
  const blackPoint = high - low >= minLevelsRange ? Math.min(maxBlackPoint, low) : 0;
  const whitePoint = high - low >= minLevelsRange ? Math.max(minWhitePoint, high) : 255;
  const stretchGain = Math.min(maxStretchGain, 255 / (whitePoint - blackPoint));
  let mean = 0;
  for (let i = 0; i < 256; i++)
    mean += (hist[i] * clamp((i - blackPoint) * stretchGain, 0, 255)) / Math.max(1, count);
  const gamma =
    mean > 0 && mean < targetLuminance
      ? Math.max(minGamma, Math.log(targetLuminance / 255) / Math.log(mean / 255))
      : 1;
  const raw = (v: number, c: number) =>
    255 * (clamp((v * gains[c] - blackPoint) * stretchGain, 0, 255) / 255) ** gamma;
  let shift = 0;
  for (let c = 0; c < 3; c++)
    for (let v = 0; v < 256; v++) shift = Math.max(shift, Math.abs(raw(v, c) - v));
  const strength = shift ? Math.min(maxStrength, maxChannelShift / shift) : 0;
  const luts = [0, 1, 2].map((c) => {
    const curve = Array.from({ length: 256 }, (_, v) => v + strength * (raw(v, c) - v));
    // Forward pass lifts flat toes, backward pass keeps the shoulder under 255.
    for (let v = 1; v < 256; v++) curve[v] = Math.max(curve[v], curve[v - 1] + minLutSlope);
    curve[255] = Math.min(255, curve[255]);
    for (let v = 254; v >= 0; v--) curve[v] = Math.min(curve[v], curve[v + 1] - minLutSlope);
    return Uint8Array.from(curve, (v) => Math.round(clamp(v, 0, 255)));
  }) as Adjustment["luts"];
  return { gains, blackPoint, whitePoint, stretchGain, gamma, strength, luts };
}
export function adjustPixel(
  r: number,
  g: number,
  b: number,
  adj: Adjustment,
): [number, number, number] {
  return [adj.luts[0][r], adj.luts[1][g], adj.luts[2][b]];
}
export function applyAdjustment(data: Uint8ClampedArray, adj: Adjustment): void {
  const [r, g, b] = adj.luts;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r[data[i]];
    data[i + 1] = g[data[i + 1]];
    data[i + 2] = b[data[i + 2]];
  }
}

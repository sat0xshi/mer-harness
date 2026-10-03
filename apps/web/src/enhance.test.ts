import { describe, expect, it } from "vitest";
import {
  adjustPixel,
  analyzeAdjustment,
  applyAdjustment,
  maxBlackPoint,
  maxChannelGain,
  maxChannelGainRatio,
  maxChannelShift,
  maxStrength,
  maxStretchGain,
  minChannelGain,
  minGamma,
  minWhitePoint,
  subjectBox,
} from "./enhance";

function pixels(w: number, h: number, pixel: (x: number, y: number) => number[]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set([...pixel(x, y), 255], (y * w + x) * 4);
  return data;
}
const grey = (v: number) => [v, v, v];
const mean = (d: Uint8ClampedArray) => {
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
  return sum / (d.length / 4);
};
const centre = (w: number, h: number) => ({
  x: Math.floor((w - Math.min(w, h)) / 2),
  y: Math.floor((h - Math.min(w, h)) / 2),
  size: Math.min(w, h),
});
function inside(box: ReturnType<typeof subjectBox>, w: number, h: number) {
  for (const n of Object.values(box)) expect(Number.isInteger(n)).toBe(true);
  expect(box.size).toBeGreaterThanOrEqual(1);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.size).toBeLessThanOrEqual(w);
  expect(box.y + box.size).toBeLessThanOrEqual(h);
}
describe("subject crop", () => {
  it.each([
    [400, 300, 235, 95, 85, 100],
    [300, 400, 90, 240, 100, 80],
    [256, 256, 135, 100, 70, 80],
  ])("centres and contains an off-centre subject in %ix%i", (w, h, x, y, rw, rh) => {
    const box = subjectBox(
      pixels(w, h, (px, py) => grey(px >= x && px < x + rw && py >= y && py < y + rh ? 40 : 255)),
      w,
      h,
    );
    inside(box, w, h);
    expect(box.x).toBeLessThanOrEqual(x);
    expect(box.y).toBeLessThanOrEqual(y);
    expect(box.x + box.size).toBeGreaterThanOrEqual(x + rw);
    expect(box.y + box.size).toBeGreaterThanOrEqual(y + rh);
    expect(Math.abs(box.x + box.size / 2 - x - rw / 2)).toBeLessThanOrEqual(5);
    expect(Math.abs(box.y + box.size / 2 - y - rh / 2)).toBeLessThanOrEqual(5);
    expect(Math.max(rw, rh) / box.size).toBeGreaterThanOrEqual(0.6);
    expect(Math.max(rw, rh) / box.size).toBeLessThanOrEqual(0.9);
  });
  it("falls back for patterned borders, tiny specks, empty and full subjects", () => {
    for (const pixel of [
      (x: number, y: number) => grey((x + y) % 2 ? 0 : 255),
      (x: number, y: number) => grey(x === 15 && y === 30 ? 0 : 255),
      () => grey(255),
      (x: number, y: number) => grey(x > 2 && x < 97 && y > 2 && y < 77 ? 0 : 255),
    ]) {
      expect(subjectBox(pixels(100, 80, pixel), 100, 80)).toEqual(centre(100, 80));
    }
  });
  it("contains an edge-touching rectangle", () => {
    const box = subjectBox(
      pixels(300, 220, (x, y) => grey(x < 75 && y >= 90 && y < 140 ? 30 : 255)),
      300,
      220,
    );
    inside(box, 300, 220);
    expect(box.x).toBe(0);
    expect(box.x + box.size).toBeGreaterThanOrEqual(75);
    expect(box.y).toBeLessThanOrEqual(90);
    expect(box.y + box.size).toBeGreaterThanOrEqual(140);
  });
  it("stays integer and inside for deterministic random dimensions including one-pixel images", () => {
    let seed = 714;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let n = 0; n < 100; n++) {
      const w = 1 + Math.floor(random() * 350),
        h = 1 + Math.floor(random() * 350);
      inside(
        subjectBox(
          pixels(w, h, (x, y) => grey(x > w * 0.6 && y > h * 0.3 && y < h * 0.7 ? 20 : 240)),
          w,
          h,
        ),
        w,
        h,
      );
    }
    for (const [w, h] of [
      [1, 1],
      [1, 300],
      [400, 1],
    ])
      inside(
        subjectBox(
          pixels(w, h, () => grey(128)),
          w,
          h,
        ),
        w,
        h,
      );
  });
});
describe("global adjustment", () => {
  it("gently lifts dark images within all limits and preserves alpha", () => {
    const data = pixels(64, 64, (x) => grey(40 + (x % 41)));
    data[3] = 127;
    const before = new Uint8ClampedArray(data),
      adj = analyzeAdjustment(data);
    applyAdjustment(data, adj);
    expect(mean(data)).toBeGreaterThan(mean(before));
    expect(mean(data) - mean(before)).toBeLessThanOrEqual(maxChannelShift);
    expect(adj.gamma).toBeGreaterThanOrEqual(minGamma);
    expect(adj.strength).toBeGreaterThanOrEqual(0);
    expect(adj.strength).toBeLessThanOrEqual(1);
    expect(adj.blackPoint).toBeLessThanOrEqual(maxBlackPoint);
    expect(adj.whitePoint).toBeGreaterThanOrEqual(minWhitePoint);
    expect(adj.stretchGain).toBeLessThanOrEqual(maxStretchGain);
    expect(data[3]).toBe(127);
    for (const gain of adj.gains) {
      expect(gain).toBeGreaterThanOrEqual(minChannelGain);
      expect(gain).toBeLessThanOrEqual(maxChannelGain);
    }
    for (let i = 0; i < data.length; i++)
      expect(Math.abs(data[i] - before[i])).toBeLessThanOrEqual(maxChannelShift);
  });
  it("makes a visible but bounded lift on a dark photo and keeps ≥70% local contrast everywhere", () => {
    const data = pixels(64, 64, (x) => [40 + (x % 41), 38 + (x % 41), 30 + (x % 41)]);
    const before = mean(data),
      adj = analyzeAdjustment(data);
    applyAdjustment(data, adj);
    expect(mean(data) - before).toBeGreaterThanOrEqual(8);
    expect(adj.strength).toBeLessThanOrEqual(maxStrength);
    for (const lut of adj.luts)
      for (let v = 10; v < 256; v++) expect(lut[v] - lut[v - 10]).toBeGreaterThanOrEqual(6);
  });
  it.each([118, 128, 180, 220])("barely changes well-exposed neutral %i", (value) => {
    const data = pixels(64, 64, () => grey(value));
    applyAdjustment(data, analyzeAdjustment(data));
    expect(Math.abs(mean(data) - value)).toBeLessThanOrEqual(3);
  });
  it("gently neutralizes yellow casts", () => {
    const adj = analyzeAdjustment(pixels(64, 64, () => [160, 155, 100]));
    const [r, , b] = adjustPixel(160, 155, 100, adj);
    expect(b / r).toBeGreaterThan(100 / 160);
    expect(b / r).toBeLessThanOrEqual(1);
    for (const gain of adj.gains) {
      expect(gain).toBeGreaterThanOrEqual(minChannelGain);
      expect(gain).toBeLessThanOrEqual(maxChannelGain);
    }
    expect(Math.max(...adj.gains) / Math.min(...adj.gains)).toBeLessThanOrEqual(
      maxChannelGainRatio,
    );
  });
  it("keeps wide-range levels near identity", () => {
    const data = pixels(256, 10, (x) => grey(x)),
      adj = analyzeAdjustment(data);
    expect(adj.blackPoint).toBeLessThanOrEqual(3);
    expect(adj.whitePoint).toBeGreaterThanOrEqual(252);
    expect(adj.stretchGain).toBeLessThan(1.03);
    applyAdjustment(data, adj);
    let difference = 0;
    for (let x = 0; x < 256; x++) difference += Math.abs(data[x * 4] - x);
    expect(difference / 256).toBeLessThanOrEqual(3);
  });
  it("does not use saturated colours or too few midtones for gray-world", () => {
    expect(
      analyzeAdjustment(
        pixels(
          64,
          64,
          (x) =>
            [
              [255, 0, 0],
              [0, 255, 0],
              [0, 0, 255],
            ][x % 3],
        ),
      ).gains,
    ).toEqual([1, 1, 1]);
    expect(analyzeAdjustment(pixels(1, 1, () => [160, 155, 100])).gains).toEqual([1, 1, 1]);
  });
  it("uses monotonic bounded LUTs and retains scratch contrast", () => {
    for (const color of [
      [60, 60, 60],
      [160, 150, 100],
      [230, 220, 180],
    ]) {
      const data = pixels(100, 100, (x) => color.map((v) => v - (x === 50 ? 30 : 0)));
      const adj = analyzeAdjustment(data);
      for (const lut of adj.luts)
        for (let v = 0; v < 256; v++) {
          expect(Math.abs(lut[v] - v)).toBeLessThanOrEqual(maxChannelShift);
          if (v) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1]);
        }
      applyAdjustment(data, adj);
      for (let c = 0; c < 3; c++)
        expect(data[49 * 4 + c] - data[50 * 4 + c]).toBeGreaterThanOrEqual(30 * 0.7);
    }
  });
});

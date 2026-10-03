import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCrop, drawCrop, jpeg } from "./image";

function canvasMock() {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4).fill(128),
    })),
    putImageData: vi.fn(),
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
}
afterEach(() => vi.unstubAllGlobals());
describe("canvas crop pipeline", () => {
  it("saves OFF and before as identical unprocessed centre crops, ignoring colour controls", () => {
    const { canvas, ctx } = canvasMock();
    const bitmap = { width: 1600, height: 1200 } as ImageBitmap;
    const crop = { ...defaultCrop, enhance: false, brightness: 1.5, white: true };
    drawCrop(canvas, bitmap, crop);
    expect(ctx.drawImage).toHaveBeenLastCalledWith(bitmap, 200, 0, 1200, 1200, 0, 0, 1080, 1080);
    const off = ctx.drawImage.mock.lastCall;
    drawCrop(canvas, bitmap, { ...crop, enhance: true }, false);
    expect(ctx.drawImage.mock.lastCall).toEqual(off);
    expect(ctx.getImageData).not.toHaveBeenCalled();
    expect(ctx.putImageData).not.toHaveBeenCalled();
    drawCrop(canvas, bitmap, { ...crop, zoom: 2, x: 1, y: -1 });
    expect(ctx.drawImage).toHaveBeenLastCalledWith(bitmap, 1000, 0, 600, 600, 0, 0, 1080, 1080);
  });
  it("detects once per bitmap and pans relative to its square without leaving the image", () => {
    const sample = canvasMock();
    sample.ctx.getImageData.mockImplementation((_x, _y, w, h) => {
      const data = new Uint8ClampedArray(w * h * 4).fill(255);
      for (let y = 35; y < 65; y++)
        for (let x = 75; x < 105; x++) data.set([40, 40, 40, 255], (y * w + x) * 4);
      return { data };
    });
    const createElement = vi.fn(() => sample.canvas);
    vi.stubGlobal("document", { createElement });
    const { canvas, ctx } = canvasMock(),
      bitmap = { width: 400, height: 300 } as ImageBitmap;
    drawCrop(canvas, bitmap, defaultCrop);
    const call = ctx.drawImage.mock.lastCall as unknown as [
      ImageBitmap,
      number,
      number,
      number,
      number,
    ];
    expect(call[3]).toBeLessThan(300);
    expect(call[3]).toBe(call[4]);
    expect(call[1] + call[3] / 2).toBeGreaterThan(260);
    expect(ctx.putImageData).toHaveBeenCalledOnce();
    for (const x of [-1, 0, 1])
      for (const y of [-1, 0, 1]) {
        drawCrop(canvas, bitmap, { ...defaultCrop, x, y, zoom: 2 });
        const [, sx, sy, side, height] = ctx.drawImage.mock.lastCall as unknown as [
          ImageBitmap,
          number,
          number,
          number,
          number,
        ];
        expect(side).toBe(height);
        expect(sx).toBeGreaterThanOrEqual(0);
        expect(sy).toBeGreaterThanOrEqual(0);
        expect(sx + side).toBeLessThanOrEqual(400);
        expect(sy + side).toBeLessThanOrEqual(300);
      }
    expect(createElement).toHaveBeenCalledOnce();
    expect(sample.ctx.getImageData).toHaveBeenCalledOnce();
  });
  it("keeps JPEGs under the upload budget by reducing size when quality is insufficient", async () => {
    const smaller = canvasMock();
    smaller.canvas.toBlob = (callback) =>
      callback(new Blob([new Uint8Array(200 * 1024)], { type: "image/jpeg" }));
    vi.stubGlobal("document", { createElement: () => smaller.canvas });
    const { canvas } = canvasMock();
    canvas.width = canvas.height = 1080;
    canvas.toBlob = (callback) =>
      callback(new Blob([new Uint8Array(260 * 1024)], { type: "image/jpeg" }));
    const blob = await jpeg(canvas);
    expect(blob.type).toBe("image/jpeg");
    expect(blob.size).toBeLessThanOrEqual(250 * 1024);
    expect(smaller.canvas.width).toBe(smaller.canvas.height);
    expect(smaller.canvas.width).toBeLessThan(1080);
  });
});

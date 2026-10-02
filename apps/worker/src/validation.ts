import { defaultPlatform, platforms } from "@mer/core";
import { z } from "zod";
export const platformSchema = z
  .string()
  .refine((id) => Object.hasOwn(platforms, id), "Unknown platform");
export const categorySchema = z.enum(["phone", "gadget", "clothing", "other"]);
export const statusSchema = z.enum(["draft", "listed", "trading", "to_ship", "done", "shelf"]);
export const itemInput = z.object({
  version: z.number().int().nonnegative(),
  category: categorySchema,
  answers: z.record(z.string().max(500)).refine((a) => Object.keys(a).length <= 30),
  price: z.number().int().min(0).max(defaultPlatform.limits.maxPrice),
  shipping: z.number().int().min(0).max(100000),
  comps: z
    .array(
      z.object({
        price: z.number().int().min(1).max(defaultPlatform.limits.maxPrice),
        sold: z.boolean(),
      }),
    )
    .max(100),
  finish: z.boolean().optional(),
});
export const statusInput = z.object({
  version: z.number().int().nonnegative(),
  status: statusSchema,
  soldPrice: z
    .number()
    .int()
    .min(defaultPlatform.limits.minPrice)
    .max(defaultPlatform.limits.maxPrice)
    .optional(),
  undo: z.string().uuid().optional(),
  shipped: z.boolean().optional(),
});
export const settingsInput = z.object({
  sound: z.boolean(),
  soundAsked: z.boolean(),
  volume: z.number().min(0).max(1),
  quiet: z.boolean(),
  night: z.boolean(),
  soft: z.boolean(),
  haptics: z.boolean(),
  hapticScale: z.number().min(0.6).max(1.4),
  fx: z.enum(["派手", "ふつう", "控えめ", "オフ"]),
  theme: z.enum(["system", "light", "dark"]),
  zone: z.string().max(100),
});
export function jpegDimensions(bytes: Uint8Array) {
  if (
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes[bytes.length - 2] !== 255 ||
    bytes[bytes.length - 1] !== 217
  )
    return null;
  let i = 2;
  let dimensions: { width: number; height: number } | null = null;
  while (i + 3 < bytes.length) {
    if (bytes[i++] !== 255) return null;
    const marker = bytes[i++];
    if (marker === 0xda) return dimensions;
    const len = (bytes[i] << 8) | bytes[i + 1];
    if (len < 2 || i + len > bytes.length) return null;
    // Canvas outputs no EXIF: reject APP1 metadata even for direct API clients.
    if (marker === 0xe1) return null;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && len >= 8)
      dimensions = {
        height: (bytes[i + 3] << 8) | bytes[i + 4],
        width: (bytes[i + 5] << 8) | bytes[i + 6],
      };
    i += len;
  }
  return null;
}

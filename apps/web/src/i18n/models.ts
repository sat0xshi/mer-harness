import {
  badges as badgeKeys,
  type Category,
  categories as categoryKeys,
  type PlatformId,
  platformQuestions as questionKeys,
  statuses as statusKeys,
} from "@mer/core";
import { t } from "./ja";
export const categories = Object.fromEntries(
  Object.entries(categoryKeys).map(([key, label]) => [key, t(label)]),
) as Record<Category, string>;
export const statuses = Object.fromEntries(
  Object.entries(statusKeys).map(([key, label]) => [key, t(label)]),
) as Record<keyof typeof statusKeys, string>;
export const badges = badgeKeys.map(
  ([key, name, condition]) => [key, t(name), t(condition)] as const,
);
export const platformQuestions = (category: Category, platform: PlatformId) =>
  questionKeys(category, platform).map((q) => ({
    ...q,
    label: t(q.label),
    hint: q.hint ? t(q.hint) : undefined,
    options: q.options?.map((option) => t(option)),
  }));

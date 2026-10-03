import { buildListing, getPlatform, type Item, truncate } from "@mer/core";

export function isCustomText(item: Item) {
  const template = buildListing(item.category, item.answers, item.platform);
  return item.title !== template.title || item.description !== template.description;
}

export function listingText(item: Item) {
  const { title, description } = isCustomText(item)
    ? item
    : buildListing(item.category, item.answers, item.platform);
  return { title, description };
}

// An answer edit must not turn stale template text into a custom draft.
export function syncTemplateText(before: Item, after: Item): Item {
  if (
    isCustomText(before) ||
    before.title !== after.title ||
    before.description !== after.description
  )
    return after;
  const { title, description } = buildListing(after.category, after.answers, after.platform);
  return { ...after, title, description };
}

export function switchPlatform(item: Item, platform: Item["platform"]): Item {
  const { limits } = getPlatform(platform);
  return syncTemplateText(item, {
    ...item,
    platform,
    title: truncate(item.title, limits.title),
    description: truncate(item.description, limits.description),
  });
}

import { DEFAULT_INDEX_ENTRIES } from "./default-indexes.js?v=20260414b";
import {
  buildSearchableTagIds,
  dedupeTagEntries,
  normalizeTagEntries
} from "./tag-utils.js?v=20260414b";

const STORAGE_KEY = "food-library-archives";
const FAVORITE_TAGS_KEY = "food-library-favorite-tags";
const INDEX_TEMPLATES_KEY = "food-library-index-templates";

/**
 * 从 localStorage 读取档案列表，并在读取时把旧格式数据归一化。
 */
export function loadArchives() {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeArchive).filter(Boolean) : [];
  } catch (error) {
    console.error("Failed to parse archives from localStorage.", error);
    return [];
  }
}

export function saveArchives(archives) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(archives));
}

export function appendArchive(archive) {
  const archives = loadArchives();
  const nextArchives = [normalizeArchive(archive), ...archives].filter(Boolean);
  saveArchives(nextArchives);
  return nextArchives;
}

export function removeArchive(archiveId) {
  const nextArchives = loadArchives().filter((archive) => archive.id !== archiveId);
  saveArchives(nextArchives);
  return nextArchives;
}

export function loadFavoriteTags() {
  const raw = window.localStorage.getItem(FAVORITE_TAGS_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string")
      .map((entry) => ({
        id: entry.id,
        dimension: typeof entry.dimension === "string" ? entry.dimension : "",
        path: typeof entry.path === "string" ? entry.path : ""
      }));
  } catch (error) {
    console.error("Failed to parse favorite tags from localStorage.", error);
    return [];
  }
}

export function saveFavoriteTags(favoriteTags) {
  window.localStorage.setItem(FAVORITE_TAGS_KEY, JSON.stringify(favoriteTags));
}

export function loadIndexTemplates() {
  const raw = window.localStorage.getItem(INDEX_TEMPLATES_KEY);

  if (!raw) {
    return DEFAULT_INDEX_ENTRIES;
  }

  try {
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return DEFAULT_INDEX_ENTRIES;
    }

    return dedupeTagEntries(normalizeTagEntries(parsed));
  } catch (error) {
    console.error("Failed to parse index templates from localStorage.", error);
    return DEFAULT_INDEX_ENTRIES;
  }
}

export function saveIndexTemplates(indexTemplates) {
  window.localStorage.setItem(INDEX_TEMPLATES_KEY, JSON.stringify(indexTemplates));
}

function normalizeArchive(archive) {
  if (!archive || typeof archive !== "object") {
    return null;
  }

  const tags = normalizeTagEntries(archive.tags);

  if (!archive.imageDataUrl || tags.length === 0) {
    return null;
  }

  return {
    id: archive.id ?? crypto.randomUUID(),
    imageDataUrl: archive.imageDataUrl,
    description: String(archive.description ?? "").trim(),
    tags,
    searchableTagIds: buildSearchableTagIds(tags),
    createdAt: archive.createdAt ?? new Date().toISOString()
  };
}

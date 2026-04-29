const { ARCHIVES_STORAGE_KEY } = require("../store/storage-keys");
const { readJson, writeJson } = require("../store/local-store");
const { createId } = require("../utils/id");
const { buildSearchableTagIds, normalizeTagEntries } = require("../utils/tag");

function loadAll() {
  const storedArchives = readJson(ARCHIVES_STORAGE_KEY, []);
  const archiveList = Array.isArray(storedArchives) ? storedArchives : [];

  return archiveList
    .map(normalizeArchive)
    .filter(Boolean)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function prepend(archive) {
  const nextArchives = [normalizeArchive(archive)].concat(loadAll()).filter(Boolean);
  saveAll(nextArchives);
  return nextArchives;
}

function remove(archiveId) {
  const nextArchives = loadAll().filter((archive) => archive.id !== archiveId);
  saveAll(nextArchives);
  return nextArchives;
}

function findById(archiveId) {
  return loadAll().find((archive) => archive.id === archiveId) || null;
}

function saveAll(archives) {
  writeJson(ARCHIVES_STORAGE_KEY, archives.map(normalizeArchive).filter(Boolean));
}

function normalizeArchive(archive) {
  if (!archive || typeof archive !== "object") {
    return null;
  }

  const tags = normalizeTagEntries(archive.tags);
  const imageAsset = normalizeImageAsset(archive.imageAsset || archive.image || archive.media || archive.imageDataUrl);

  if (!imageAsset || tags.length === 0) {
    return null;
  }

  return {
    id: String(archive.id || createId("archive")),
    description: String(archive.description || "").trim(),
    tags,
    searchableTagIds: Array.isArray(archive.searchableTagIds) && archive.searchableTagIds.length
      ? Array.from(new Set(archive.searchableTagIds.filter(Boolean)))
      : buildSearchableTagIds(tags),
    imageAsset,
    createdAt: archive.createdAt || new Date().toISOString(),
    aiMeta: normalizeAiMeta(archive.aiMeta)
  };
}

function normalizeImageAsset(rawImageAsset) {
  if (typeof rawImageAsset === "string") {
    if (!rawImageAsset) {
      return null;
    }

    return {
      provider: "legacy",
      path: rawImageAsset,
      url: "",
      fileId: "",
      synced: false
    };
  }

  if (!rawImageAsset || typeof rawImageAsset !== "object") {
    return null;
  }

  const path = String(
    rawImageAsset.path ||
      rawImageAsset.localPath ||
      rawImageAsset.savedFilePath ||
      rawImageAsset.url ||
      ""
  ).trim();

  if (!path) {
    return null;
  }

  return {
    provider: String(rawImageAsset.provider || "local"),
    path,
    url: String(rawImageAsset.url || ""),
    fileId: String(rawImageAsset.fileId || ""),
    synced: Boolean(rawImageAsset.synced)
  };
}

function normalizeAiMeta(aiMeta) {
  if (!aiMeta || typeof aiMeta !== "object") {
    return {
      provider: "noop",
      status: "reserved"
    };
  }

  return {
    provider: String(aiMeta.provider || "noop"),
    status: String(aiMeta.status || "reserved")
  };
}

module.exports = {
  findById,
  loadAll,
  prepend,
  remove,
  saveAll
};

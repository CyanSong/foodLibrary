const { DEFAULT_INDEX_PATHS } = require("../constants/default-indexes");
const { INDEX_TEMPLATES_STORAGE_KEY } = require("../store/storage-keys");
const { readJson, writeJson } = require("../store/local-store");
const { createTagEntry, dedupeTagEntries, normalizeTagEntries } = require("../utils/tag");

const DEFAULT_INDEX_ENTRIES = DEFAULT_INDEX_PATHS.map((entry) => createTagEntry(entry[0], entry[1])).filter(Boolean);

function loadAll() {
  const storedTemplates = readJson(INDEX_TEMPLATES_STORAGE_KEY, []);
  const seedTemplates = Array.isArray(storedTemplates) && storedTemplates.length > 0
    ? storedTemplates
    : DEFAULT_INDEX_ENTRIES;

  return dedupeTagEntries(normalizeTagEntries(seedTemplates));
}

function saveAll(tagEntries) {
  writeJson(INDEX_TEMPLATES_STORAGE_KEY, dedupeTagEntries(normalizeTagEntries(tagEntries)));
}

function mergeTags(tagEntries) {
  const nextTemplates = dedupeTagEntries(loadAll().concat(normalizeTagEntries(tagEntries)));
  saveAll(nextTemplates);
  return nextTemplates;
}

module.exports = {
  DEFAULT_INDEX_ENTRIES,
  loadAll,
  mergeTags,
  saveAll
};

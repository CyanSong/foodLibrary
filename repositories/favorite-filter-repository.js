const { FAVORITE_FILTERS_STORAGE_KEY } = require("../store/storage-keys");
const { readJson, writeJson } = require("../store/local-store");
const { getDimensionId, getPathId, normalizeDimension, normalizeTagPath } = require("../utils/tag");

function loadAll() {
  return normalizeFavoriteFilters(readJson(FAVORITE_FILTERS_STORAGE_KEY, []));
}

function saveAll(favoriteFilters) {
  writeJson(FAVORITE_FILTERS_STORAGE_KEY, normalizeFavoriteFilters(favoriteFilters));
}

function normalizeFavoriteFilters(rawFavoriteFilters) {
  if (!Array.isArray(rawFavoriteFilters)) {
    return [];
  }

  const seen = new Set();

  return rawFavoriteFilters
    .map(normalizeFavoriteFilter)
    .filter((favoriteFilter) => {
      if (!favoriteFilter || seen.has(favoriteFilter.id)) {
        return false;
      }

      seen.add(favoriteFilter.id);
      return true;
    })
    .slice(0, 12);
}

function normalizeFavoriteFilter(rawFavoriteFilter) {
  if (!rawFavoriteFilter || typeof rawFavoriteFilter !== "object") {
    return null;
  }

  const rawId = String(rawFavoriteFilter.id || "").trim();

  if (rawId.startsWith("dimension::")) {
    const dimension = normalizeDimension(rawFavoriteFilter.dimension || rawId.slice("dimension::".length));

    if (!dimension) {
      return null;
    }

    return {
      id: getDimensionId(dimension),
      dimension,
      path: ""
    };
  }

  if (rawId.startsWith("path::")) {
    const parts = rawId.split("::");
    const dimension = normalizeDimension(rawFavoriteFilter.dimension || parts[1]);
    const path = normalizeTagPath(rawFavoriteFilter.path || parts.slice(2).join("::"));

    if (!dimension || !path) {
      return null;
    }

    return {
      id: getPathId(dimension, path),
      dimension,
      path
    };
  }

  if (rawFavoriteFilter.dimension) {
    const dimension = normalizeDimension(rawFavoriteFilter.dimension);
    const path = normalizeTagPath(rawFavoriteFilter.path);

    if (!dimension) {
      return null;
    }

    return {
      id: path ? getPathId(dimension, path) : getDimensionId(dimension),
      dimension,
      path
    };
  }

  return null;
}

module.exports = {
  loadAll,
  saveAll
};

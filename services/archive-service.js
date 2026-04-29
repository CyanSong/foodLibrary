const archiveRepository = require("../repositories/archive-repository");
const favoriteFilterRepository = require("../repositories/favorite-filter-repository");
const indexTemplateRepository = require("../repositories/index-template-repository");
const aiIndexingService = require("./ai-indexing");
const { createId } = require("../utils/id");
const { formatDateTime } = require("../utils/format");
const {
  buildSearchableTagIds,
  buildTagTree,
  createTagEntry,
  dedupeTagEntries,
  formatTagPathForDisplay,
  getDimensionId,
  getFilterLabel,
  getLastSegment,
  getPathId,
  normalizeDimension,
  normalizeTagEntries,
  normalizeTagPath
} = require("../utils/tag");
const { chooseSingleImage, removeSavedFile, saveFile } = require("../utils/wx-api");

function pickSingleImage() {
  return chooseSingleImage();
}

function createManualTag(options) {
  const normalizedOptions = normalizeManualTagOptions(options);
  const tagEntry = createTagEntry(normalizedOptions.dimension, normalizedOptions.pathText);
  return tagEntry ? presentTag(tagEntry) : null;
}

function mergeDraftTags(currentTags, incomingTags) {
  return presentTags(
    dedupeTagEntries(normalizeTagEntries(currentTags).concat(normalizeTagEntries(incomingTags)))
  );
}

function upsertDraftTagsByDimensions(currentTags, incomingTags, dimensions) {
  const targetDimensions = new Set([].concat(dimensions || []).map(normalizeDimension).filter(Boolean));
  const preservedTags = normalizeTagEntries(currentTags).filter(
    (tagEntry) => !targetDimensions.has(normalizeDimension(tagEntry.dimension))
  );

  return presentTags(dedupeTagEntries(preservedTags.concat(normalizeTagEntries(incomingTags))));
}

function getBuilderState(options) {
  const archives = archiveRepository.loadAll();
  const recentTags = collectRecentTags(archives, 3);
  const favoriteFilters = favoriteFilterRepository.loadAll();
  const currentDraftTags = normalizeTagEntries(options && options.draftTags);
  const indexTemplates = dedupeTagEntries(
    indexTemplateRepository.loadAll().concat(collectArchiveTags(archives)).concat(currentDraftTags)
  );
  const pendingTagSegments = normalizePendingTagSegments(options && options.pendingTagSegments);

  return {
    archiveCount: archives.length,
    recentTags: presentTags(recentTags),
    favoriteTags: presentFavoriteFilters(favoriteFilters),
    availableNextSegments: getAvailableNextSegments({
      pendingTagSegments,
      indexTemplates
    })
  };
}

function getSearchState(options) {
  const archives = archiveRepository.loadAll();
  const selectedFilterIds = uniqueFilterIds(options && options.selectedFilterIds);
  const appliedFilterIds = uniqueFilterIds(options && options.appliedFilterIds);
  const indexTemplates = dedupeTagEntries(indexTemplateRepository.loadAll().concat(collectArchiveTags(archives)));
  const favoriteFilters = favoriteFilterRepository.loadAll();
  const tagTree = buildTagTree(archives, indexTemplates);
  const results = appliedFilterIds.length
    ? filterArchives(archives, appliedFilterIds).map(presentArchive)
    : [];

  return {
    archiveCount: archives.length,
    resultCount: results.length,
    results,
    selectedFilters: selectedFilterIds.map((filterId) => ({
      id: filterId,
      label: getFilterLabel(filterId)
    })),
    favoriteFilterIds: favoriteFilters.map((favoriteFilter) => favoriteFilter.id),
    tagTree
  };
}

async function createArchive(payload) {
  const manualTags = normalizeTagEntries(payload && payload.manualTags);

  if (!payload || !payload.tempFilePath) {
    throw new Error("请先选择一张图片。");
  }

  if (manualTags.length === 0) {
    throw new Error("请至少添加一个分类标签。");
  }

  const mergedTags = dedupeTagEntries(manualTags);
  const imageAsset = await getMediaStorage().saveImage(payload.tempFilePath);
  const archive = {
    id: createId("archive"),
    description: String((payload && payload.description) || "").trim(),
    tags: mergedTags,
    searchableTagIds: buildSearchableTagIds(mergedTags),
    imageAsset,
    createdAt: new Date().toISOString(),
    aiMeta: buildArchiveAiMeta(payload && payload.aiMeta)
  };

  archiveRepository.prepend(archive);
  indexTemplateRepository.mergeTags(mergedTags);
  return presentArchive(archive);
}

async function deleteArchive(archiveId) {
  const targetArchive = archiveRepository.findById(archiveId);

  if (!targetArchive) {
    return false;
  }

  const nextArchives = archiveRepository.remove(archiveId);
  const currentImagePath = resolveImageSrc(targetArchive.imageAsset);
  const stillReferenced = nextArchives.some(
    (archive) => resolveImageSrc(archive.imageAsset) === currentImagePath
  );

  if (!stillReferenced) {
    await getMediaStorage().removeImage(targetArchive.imageAsset);
  }

  return true;
}

function toggleFavoriteFilter(filterId) {
  const normalizedFilterId = String(filterId || "").trim();

  if (!normalizedFilterId) {
    return presentFavoriteFilters(favoriteFilterRepository.loadAll());
  }

  const favoriteFilters = favoriteFilterRepository.loadAll();
  const existingIndex = favoriteFilters.findIndex(
    (favoriteFilter) => favoriteFilter.id === normalizedFilterId
  );
  const nextFavoriteFilters =
    existingIndex >= 0
      ? favoriteFilters.filter((favoriteFilter) => favoriteFilter.id !== normalizedFilterId)
      : [buildFavoriteFilter(normalizedFilterId)].concat(favoriteFilters).filter(Boolean).slice(0, 12);

  favoriteFilterRepository.saveAll(nextFavoriteFilters);
  return presentFavoriteFilters(nextFavoriteFilters);
}

function getDeleteIndexImpact(filterId) {
  const archives = archiveRepository.loadAll();
  const indexTemplates = indexTemplateRepository.loadAll();
  const impact = calculateDeleteImpact(archives, filterId);
  const nextIndexTemplates = indexTemplates.filter(
    (tagEntry) => !shouldPruneTagEntry(tagEntry, filterId)
  );

  return {
    affectedCount: impact.affectedCount,
    deletedCount: impact.deletedCount,
    hasEffect:
      impact.affectedCount > 0 || nextIndexTemplates.length !== indexTemplates.length
  };
}

async function deleteIndex(filterId) {
  const archives = archiveRepository.loadAll();
  const impact = calculateDeleteImpact(archives, filterId);
  const nextIndexTemplates = indexTemplateRepository
    .loadAll()
    .filter((tagEntry) => !shouldPruneTagEntry(tagEntry, filterId));

  archiveRepository.saveAll(impact.nextArchives);
  indexTemplateRepository.saveAll(nextIndexTemplates);

  const nextFavoriteFilters = favoriteFilterRepository
    .loadAll()
    .filter((favoriteFilter) => !shouldPruneFilterId(favoriteFilter.id, filterId));
  favoriteFilterRepository.saveAll(nextFavoriteFilters);
  await cleanupDetachedImages(archives, impact.nextArchives);

  return {
    affectedCount: impact.affectedCount,
    deletedCount: impact.deletedCount
  };
}

function getResetIndexesImpact() {
  const archives = archiveRepository.loadAll();
  const defaultIndexTemplates = dedupeTagEntries(indexTemplateRepository.DEFAULT_INDEX_ENTRIES);
  const defaultTagIds = new Set(defaultIndexTemplates.map((tagEntry) => tagEntry.id));
  const validDefaultFilterIds = buildSearchableTagIds(defaultIndexTemplates);
  let removedArchiveCount = 0;
  let trimmedArchiveCount = 0;

  archives.forEach((archive) => {
    const nextTags = normalizeTagEntries(archive.tags).filter((tagEntry) => defaultTagIds.has(tagEntry.id));

    if (nextTags.length === 0) {
      removedArchiveCount += 1;
      return;
    }

    if (nextTags.length !== archive.tags.length) {
      trimmedArchiveCount += 1;
    }
  });

  return {
    removedArchiveCount,
    trimmedArchiveCount,
    validDefaultFilterIds
  };
}

async function resetIndexesToDefault() {
  const archives = archiveRepository.loadAll();
  const defaultIndexTemplates = dedupeTagEntries(indexTemplateRepository.DEFAULT_INDEX_ENTRIES);
  const defaultTagIds = new Set(defaultIndexTemplates.map((tagEntry) => tagEntry.id));
  const validDefaultFilterIds = buildSearchableTagIds(defaultIndexTemplates);
  const nextArchives = archives.flatMap((archive) => {
    const nextTags = normalizeTagEntries(archive.tags).filter((tagEntry) => defaultTagIds.has(tagEntry.id));

    if (nextTags.length === 0) {
      return [];
    }

    return [
      {
        ...archive,
        tags: nextTags,
        searchableTagIds: buildSearchableTagIds(nextTags)
      }
    ];
  });

  archiveRepository.saveAll(nextArchives);
  indexTemplateRepository.saveAll(defaultIndexTemplates);

  const nextFavoriteFilters = favoriteFilterRepository
    .loadAll()
    .filter((favoriteFilter) => validDefaultFilterIds.includes(favoriteFilter.id));
  favoriteFilterRepository.saveAll(nextFavoriteFilters);
  await cleanupDetachedImages(archives, nextArchives);

  return {
    validDefaultFilterIds
  };
}

function pruneFilterIds(filterIds, deletedId) {
  return uniqueFilterIds(filterIds).filter(
    (filterId) => !shouldPruneFilterId(filterId, deletedId)
  );
}

function retainFilterIds(filterIds, validFilterIds) {
  const validSet = new Set(validFilterIds || []);
  return uniqueFilterIds(filterIds).filter((filterId) => validSet.has(filterId));
}

async function cleanupDetachedImages(previousArchives, nextArchives) {
  const nextImagePaths = new Set(
    (nextArchives || []).map((archive) => resolveImageSrc(archive.imageAsset)).filter(Boolean)
  );
  const removedImagePaths = Array.from(
    new Set(
      (previousArchives || [])
        .map((archive) => resolveImageSrc(archive.imageAsset))
        .filter((imagePath) => imagePath && !nextImagePaths.has(imagePath))
    )
  );

  for (const imagePath of removedImagePaths) {
    await getMediaStorage().removeImage({
      path: imagePath
    });
  }
}

async function suggestAiTags(payload) {
  const result = await aiIndexingService.suggestTags(payload);

  return {
    tags: presentTags(result.tags),
    summary: result.summary,
    aiMeta: buildArchiveAiMeta(result.aiMeta)
  };
}

function getMediaStorage() {
  return {
    async saveImage(tempFilePath) {
      if (!tempFilePath) {
        throw new Error("请选择一张图片后再保存。");
      }

      const result = await saveFile(tempFilePath);

      return {
        provider: "local",
        path: result.savedFilePath,
        url: "",
        fileId: "",
        synced: false
      };
    },

    async removeImage(imageAsset) {
      if (!imageAsset || !imageAsset.path || !String(imageAsset.path).startsWith("wxfile://")) {
        return;
      }

      try {
        await removeSavedFile(imageAsset.path);
      } catch (error) {
        const message = String((error && error.errMsg) || error || "");

        if (!message.includes("fail file not exist")) {
          throw error;
        }
      }
    }
  };
}

function filterArchives(archives, selectedFilterIds) {
  return archives.filter((archive) =>
    selectedFilterIds.every((filterId) => archive.searchableTagIds.includes(filterId))
  );
}

function collectRecentTags(archives, limit) {
  const uniqueTags = new Map();

  archives.forEach((archive) => {
    (archive.tags || []).forEach((tagEntry) => {
      if (!uniqueTags.has(tagEntry.id)) {
        uniqueTags.set(tagEntry.id, tagEntry);
      }
    });
  });

  return Array.from(uniqueTags.values()).slice(0, limit);
}

function collectArchiveTags(archives) {
  const tags = [];

  archives.forEach((archive) => {
    tags.push.apply(tags, archive.tags || []);
  });

  return tags;
}

function getAvailableNextSegments(options) {
  const currentSegments = normalizePendingTagSegments(options && options.pendingTagSegments);
  const indexTemplates = dedupeTagEntries(options && options.indexTemplates);
  const nextSegments = new Set();

  if (currentSegments.length === 0) {
    indexTemplates.forEach((tagEntry) => {
      const dimension = normalizeDimension(tagEntry.dimension);

      if (dimension) {
        nextSegments.add(dimension);
      }
    });

    return Array.from(nextSegments).sort((left, right) =>
      left.localeCompare(right, "zh-Hans-CN")
    );
  }

  const dimension = currentSegments[0];

  indexTemplates.forEach((tagEntry) => {
    if (normalizeDimension(tagEntry.dimension) !== dimension) {
      return;
    }

    const segments = [dimension].concat(normalizeTagPath(tagEntry.path).split("->").filter(Boolean));

    if (segments.length <= currentSegments.length) {
      return;
    }

    const matchesPrefix = currentSegments.every((segment, index) => segments[index] === segment);

    if (!matchesPrefix) {
      return;
    }

    nextSegments.add(segments[currentSegments.length]);
  });

  return Array.from(nextSegments).sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN")
  );
}

function normalizePendingTagSegments(pendingTagSegments) {
  if (!Array.isArray(pendingTagSegments)) {
    return [];
  }

  return pendingTagSegments
    .map((segment) => String(segment || "").trim())
    .filter(Boolean);
}

function normalizeManualTagOptions(options) {
  const segments = normalizePendingTagSegments(options && options.segments);

  if (segments.length >= 2) {
    return {
      dimension: segments[0],
      pathText: segments.slice(1).join("->")
    };
  }

  return {
    dimension: options && options.dimension,
    pathText: options && options.pathText
  };
}

function buildFavoriteFilter(filterId) {
  if (String(filterId).startsWith("dimension::")) {
    const dimension = normalizeDimension(String(filterId).slice("dimension::".length));

    return dimension
      ? {
          id: getDimensionId(dimension),
          dimension,
          path: ""
        }
      : null;
  }

  if (String(filterId).startsWith("path::")) {
    const parts = String(filterId).split("::");
    const dimension = normalizeDimension(parts[1]);
    const path = normalizeTagPath(parts.slice(2).join("::"));

    return dimension && path
      ? {
          id: getPathId(dimension, path),
          dimension,
          path
        }
      : null;
  }

  return null;
}

function calculateDeleteImpact(archives, filterId) {
  let affectedCount = 0;
  let deletedCount = 0;
  const nextArchives = [];

  archives.forEach((archive) => {
    if (!archive.searchableTagIds.includes(filterId)) {
      nextArchives.push(archive);
      return;
    }

    affectedCount += 1;
    const nextTags = removeIndexFromTags(archive.tags, filterId);

    if (nextTags.length === 0) {
      deletedCount += 1;
      return;
    }

    nextArchives.push({
      ...archive,
      tags: nextTags,
      searchableTagIds: buildSearchableTagIds(nextTags)
    });
  });

  return {
    affectedCount,
    deletedCount,
    nextArchives
  };
}

function removeIndexFromTags(tags, filterId) {
  if (String(filterId).startsWith("dimension::")) {
    const targetDimension = String(filterId).slice("dimension::".length);
    return normalizeTagEntries(tags).filter(
      (tagEntry) => normalizeDimension(tagEntry.dimension) !== targetDimension
    );
  }

  if (String(filterId).startsWith("path::")) {
    const parts = String(filterId).split("::");
    const targetDimension = parts[1] || "";
    const targetPath = normalizeTagPath(parts.slice(2).join("::"));

    return normalizeTagEntries(tags).filter((tagEntry) => {
      const sameDimension = normalizeDimension(tagEntry.dimension) === targetDimension;
      const tagPath = normalizeTagPath(tagEntry.path);
      const isWithinDeletedPath =
        tagPath === targetPath || tagPath.startsWith(targetPath + "->");

      return !(sameDimension && isWithinDeletedPath);
    });
  }

  return normalizeTagEntries(tags);
}

function shouldPruneTagEntry(tagEntry, deletedId) {
  if (!tagEntry || typeof tagEntry !== "object") {
    return false;
  }

  const dimensionId = getDimensionId(tagEntry.dimension);
  const pathId = getPathId(tagEntry.dimension, tagEntry.path);

  if (deletedId === dimensionId || deletedId === pathId) {
    return true;
  }

  if (String(deletedId).startsWith("dimension::")) {
    return normalizeDimension(tagEntry.dimension) === String(deletedId).slice("dimension::".length);
  }

  if (String(deletedId).startsWith("path::")) {
    const parts = String(deletedId).split("::");
    const deletedDimension = parts[1] || "";
    const deletedPath = normalizeTagPath(parts.slice(2).join("::"));
    const candidateDimension = normalizeDimension(tagEntry.dimension);
    const candidatePath = normalizeTagPath(tagEntry.path);

    return (
      candidateDimension === deletedDimension &&
      (candidatePath === deletedPath || candidatePath.startsWith(deletedPath + "->"))
    );
  }

  return false;
}

function shouldPruneFilterId(candidateId, deletedId) {
  if (candidateId === deletedId) {
    return true;
  }

  if (String(deletedId).startsWith("dimension::")) {
    const targetDimension = String(deletedId).slice("dimension::".length);

    if (String(candidateId).startsWith("dimension::")) {
      return String(candidateId).slice("dimension::".length) === targetDimension;
    }

    if (String(candidateId).startsWith("path::")) {
      return String(candidateId).split("::")[1] === targetDimension;
    }
  }

  if (String(deletedId).startsWith("path::") && String(candidateId).startsWith("path::")) {
    const deletedParts = String(deletedId).split("::");
    const candidateParts = String(candidateId).split("::");
    const deletedDimension = deletedParts[1] || "";
    const candidateDimension = candidateParts[1] || "";
    const deletedPath = normalizeTagPath(deletedParts.slice(2).join("::"));
    const candidatePath = normalizeTagPath(candidateParts.slice(2).join("::"));

    return (
      deletedDimension === candidateDimension &&
      (candidatePath === deletedPath || candidatePath.startsWith(deletedPath + "->"))
    );
  }

  return false;
}

function uniqueFilterIds(filterIds) {
  return Array.from(new Set([].concat(filterIds || []).filter(Boolean)));
}

function presentArchive(archive) {
  return {
    id: archive.id,
    description: archive.description,
    createdAt: archive.createdAt,
    createdAtLabel: formatDateTime(archive.createdAt),
    imageSrc: resolveImageSrc(archive.imageAsset),
    tags: presentTags(archive.tags),
    aiMeta: archive.aiMeta
  };
}

function buildArchiveAiMeta(aiMeta) {
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

function presentTags(tags) {
  return normalizeTagEntries(tags).map(presentTag);
}

function presentTag(tagEntry) {
  return {
    id: tagEntry.id,
    dimension: tagEntry.dimension,
    path: tagEntry.path,
    label: tagEntry.label,
    displayPath: formatTagPathForDisplay(tagEntry.path),
    fullLabel: tagEntry.dimension + " / " + formatTagPathForDisplay(tagEntry.path)
  };
}

function presentFavoriteFilters(favoriteFilters) {
  return (favoriteFilters || []).map((favoriteFilter) => {
    const displayPath = favoriteFilter.path ? formatTagPathForDisplay(favoriteFilter.path) : "";

    return {
      id: favoriteFilter.id,
      dimension: favoriteFilter.dimension,
      path: favoriteFilter.path,
      label: favoriteFilter.path ? getLastSegment(favoriteFilter.path) : favoriteFilter.dimension,
      displayPath,
      fullLabel: displayPath ? favoriteFilter.dimension + " / " + displayPath : favoriteFilter.dimension
    };
  });
}

function resolveImageSrc(imageAsset) {
  if (!imageAsset) {
    return "";
  }

  return imageAsset.url || imageAsset.path || "";
}

module.exports = {
  createArchive,
  createManualTag,
  deleteArchive,
  deleteIndex,
  getBuilderState,
  getDeleteIndexImpact,
  getResetIndexesImpact,
  getSearchState,
  mergeDraftTags,
  pickSingleImage,
  pruneFilterIds,
  resetIndexesToDefault,
  retainFilterIds,
  suggestAiTags,
  toggleFavoriteFilter,
  upsertDraftTagsByDimensions
};

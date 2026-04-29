const LEGACY_DIMENSION_FALLBACK = "未分类";

function normalizeDimension(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeTagPath(value) {
  return String(value || "")
    .split(/(?:->|\/|,|，)/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("->");
}

function getDimensionId(dimension) {
  return "dimension::" + normalizeDimension(dimension);
}

function getPathId(dimension, path) {
  return "path::" + normalizeDimension(dimension) + "::" + normalizeTagPath(path);
}

function getLastSegment(path) {
  const segments = normalizeTagPath(path).split("->").filter(Boolean);
  return segments[segments.length - 1] || "";
}

function createTagEntry(dimension, path) {
  const normalizedDimension = normalizeDimension(dimension);
  const normalizedPath = normalizeTagPath(path);

  if (!normalizedDimension || !normalizedPath) {
    return null;
  }

  return {
    id: getPathId(normalizedDimension, normalizedPath),
    dimension: normalizedDimension,
    path: normalizedPath,
    label: getLastSegment(normalizedPath)
  };
}

function inferLegacyDimension(rawTag) {
  const normalized = normalizeTagPath(rawTag);

  if (!normalized) {
    return LEGACY_DIMENSION_FALLBACK;
  }

  if (/刺身|炙烧|烧烤|煎|炸|煮|蒸|烤|卤|腌|生食/.test(normalized)) {
    return "烹饪方式";
  }

  if (/腹|背|腩|肚|肩|腿|胸|尾|鳍|部位/.test(normalized)) {
    return "食材部位";
  }

  return "食材类型";
}

function normalizeTagEntries(rawTags) {
  if (!Array.isArray(rawTags)) {
    return [];
  }

  return dedupeTagEntries(
    rawTags
      .map((rawTag) => {
        if (typeof rawTag === "string") {
          return createTagEntry(inferLegacyDimension(rawTag), rawTag);
        }

        if (!rawTag || typeof rawTag !== "object") {
          return null;
        }

        return createTagEntry(rawTag.dimension || LEGACY_DIMENSION_FALLBACK, rawTag.path || rawTag.label);
      })
      .filter(Boolean)
  );
}

function dedupeTagEntries(tagEntries) {
  const seen = new Set();
  const normalizedEntries = normalizeTagEntriesInternal(tagEntries);

  return normalizedEntries.filter((tagEntry) => {
    if (seen.has(tagEntry.id)) {
      return false;
    }

    seen.add(tagEntry.id);
    return true;
  });
}

function normalizeTagEntriesInternal(tagEntries) {
  if (!Array.isArray(tagEntries)) {
    return [];
  }

  return tagEntries
    .map((tagEntry) => {
      if (typeof tagEntry === "string") {
        return createTagEntry(inferLegacyDimension(tagEntry), tagEntry);
      }

      if (!tagEntry || typeof tagEntry !== "object") {
        return null;
      }

      return createTagEntry(tagEntry.dimension, tagEntry.path || tagEntry.label);
    })
    .filter(Boolean);
}

function buildSearchableTagIds(tagEntries) {
  const tagIds = new Set();

  normalizeTagEntries(tagEntries).forEach((tagEntry) => {
    tagIds.add(getDimensionId(tagEntry.dimension));

    expandTagPath(tagEntry.path).forEach((expandedPath) => {
      tagIds.add(getPathId(tagEntry.dimension, expandedPath));
    });
  });

  return Array.from(tagIds);
}

function buildIndexSections(archives, seedTagEntries, keyword) {
  const dimensionMap = new Map();
  const normalizedKeyword = String(keyword || "").trim().toLowerCase();

  dedupeTagEntries([].concat(seedTagEntries || [], flattenArchiveTags(archives))).forEach((tagEntry) => {
    const dimensionId = getDimensionId(tagEntry.dimension);

    if (!dimensionMap.has(dimensionId)) {
      dimensionMap.set(dimensionId, {
        id: dimensionId,
        label: tagEntry.dimension,
        count: 0,
        items: new Map()
      });
    }

    const dimensionNode = dimensionMap.get(dimensionId);

    if (!dimensionNode.items.has(tagEntry.id)) {
      dimensionNode.items.set(tagEntry.id, {
        id: tagEntry.id,
        dimension: tagEntry.dimension,
        path: tagEntry.path,
        label: tagEntry.label,
        count: 0
      });
    }
  });

  archives.forEach((archive) => {
    const searchableTagIds =
      Array.isArray(archive.searchableTagIds) && archive.searchableTagIds.length
        ? archive.searchableTagIds
        : buildSearchableTagIds(archive.tags);

    dimensionMap.forEach((dimensionNode) => {
      if (searchableTagIds.includes(dimensionNode.id)) {
        dimensionNode.count += 1;
      }

      dimensionNode.items.forEach((itemNode) => {
        if (searchableTagIds.includes(itemNode.id)) {
          itemNode.count += 1;
        }
      });
    });
  });

  return Array.from(dimensionMap.values())
    .map((dimensionNode) => {
      const rawItems = Array.from(dimensionNode.items.values()).sort((left, right) =>
        left.path.localeCompare(right.path, "zh-Hans-CN")
      );
      const dimensionMatches = includesKeyword(dimensionNode.label, normalizedKeyword);
      const nextItems =
        normalizedKeyword && !dimensionMatches
          ? rawItems.filter((itemNode) => {
              const candidate = [itemNode.label, itemNode.path, itemNode.dimension].join(" ");
              return includesKeyword(candidate, normalizedKeyword);
            })
          : rawItems;

      return {
        id: dimensionNode.id,
        label: dimensionNode.label,
        count: dimensionNode.count,
        items: nextItems.map((itemNode) => ({
          id: itemNode.id,
          label: itemNode.label,
          path: itemNode.path,
          displayPath: formatTagPathForDisplay(itemNode.path),
          count: itemNode.count
        }))
      };
    })
    .filter((dimensionNode) => {
      if (!normalizedKeyword) {
        return true;
      }

      return includesKeyword(dimensionNode.label, normalizedKeyword) || dimensionNode.items.length > 0;
    })
    .sort((left, right) => left.label.localeCompare(right.label, "zh-Hans-CN"));
}

function buildTagTree(archives, seedTagEntries) {
  const dimensionMap = new Map();

  dedupeTagEntries([].concat(seedTagEntries || [], flattenArchiveTags(archives))).forEach((tagEntry) => {
    appendTagEntryToTree(dimensionMap, tagEntry);
  });

  populateCounts(dimensionMap, archives);
  return sortDimensions(dimensionMap);
}

function appendTagEntryToTree(dimensionMap, tagEntry) {
  const dimensionId = getDimensionId(tagEntry.dimension);

  if (!dimensionMap.has(dimensionId)) {
    dimensionMap.set(dimensionId, {
      id: dimensionId,
      label: tagEntry.dimension,
      count: 0,
      children: new Map()
    });
  }

  const dimensionNode = dimensionMap.get(dimensionId);
  const segments = normalizeTagPath(tagEntry.path).split("->").filter(Boolean);
  let currentNode = dimensionNode;

  segments.forEach((segment, index) => {
    const partialPath = segments.slice(0, index + 1).join("->");
    const pathId = getPathId(tagEntry.dimension, partialPath);

    if (!currentNode.children.has(pathId)) {
      currentNode.children.set(pathId, {
        id: pathId,
        label: segment,
        path: partialPath,
        count: 0,
        children: new Map()
      });
    }

    currentNode = currentNode.children.get(pathId);
  });
}

function populateCounts(dimensionMap, archives) {
  dimensionMap.forEach((dimensionNode) => {
    dimensionNode.count = archives.filter((archive) => archive.searchableTagIds.includes(dimensionNode.id)).length;
    populateChildCounts(dimensionNode, archives);
  });
}

function populateChildCounts(node, archives) {
  node.children.forEach((childNode) => {
    childNode.count = archives.filter((archive) => archive.searchableTagIds.includes(childNode.id)).length;
    populateChildCounts(childNode, archives);
  });
}

function sortDimensions(dimensionMap) {
  const dimensions = Array.from(dimensionMap.values()).sort((left, right) =>
    left.label.localeCompare(right.label, "zh-Hans-CN")
  );

  dimensions.forEach(sortChildren);
  return dimensions;
}

function sortChildren(node) {
  node.children = new Map(
    Array.from(node.children.entries()).sort((left, right) =>
      left[1].path.localeCompare(right[1].path, "zh-Hans-CN")
    )
  );

  node.children.forEach(sortChildren);
}

function formatTagPathForDisplay(path) {
  return normalizeTagPath(path).replace(/->/g, "-");
}

function getFilterLabel(filterId) {
  if (String(filterId).startsWith("dimension::")) {
    return String(filterId).slice("dimension::".length);
  }

  if (String(filterId).startsWith("path::")) {
    const parts = String(filterId).split("::");
    const dimension = parts[1] || "";
    const path = parts.slice(2).join("::");
    return dimension + " / " + getLastSegment(path);
  }

  return String(filterId || "");
}

function expandTagPath(tagPath) {
  const segments = normalizeTagPath(tagPath).split("->").filter(Boolean);
  const expandedPaths = [];

  for (let index = 0; index < segments.length; index += 1) {
    expandedPaths.push(segments.slice(0, index + 1).join("->"));
  }

  return expandedPaths;
}

function includesKeyword(value, keyword) {
  if (!keyword) {
    return true;
  }

  return String(value || "").toLowerCase().includes(keyword);
}

function flattenArchiveTags(archives) {
  const tags = [];

  if (!Array.isArray(archives)) {
    return tags;
  }

  archives.forEach((archive) => {
    tags.push.apply(tags, archive.tags || []);
  });

  return tags;
}

module.exports = {
  buildIndexSections,
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
};

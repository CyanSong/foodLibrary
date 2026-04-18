const LEGACY_DIMENSION_FALLBACK = "未分类";

/**
 * 规范化分类方式名称。
 */
export function normalizeDimension(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * 将类似 "动物 -> 海鲜 -> 鱼类" 规范成 "动物->海鲜->鱼类"。
 */
export function normalizeTagPath(tag) {
  const segments = String(tag ?? "")
    .split("->")
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.join("->");
}

/**
 * 创建一条结构化分类标签。
 */
export function createTagEntry(dimension, path) {
  const normalizedDimension = normalizeDimension(dimension);
  const normalizedPath = normalizeTagPath(path);

  if (!normalizedDimension || !normalizedPath) {
    return null;
  }

  return {
    id: `${normalizedDimension}::${normalizedPath}`,
    dimension: normalizedDimension,
    path: normalizedPath,
    label: getLastSegment(normalizedPath)
  };
}

/**
 * 为一条档案生成“可检索标签集合”。
 * 结构中同时包含：
 * 1. 分类方式本身
 * 2. 分类方式下的层级路径
 * 这样点击“烹饪方式”或“烹饪方式 / 刺身”都能命中对应档案。
 */
export function buildSearchableTagIds(tagEntries) {
  const tagIds = new Set();

  tagEntries.forEach((tagEntry) => {
    tagIds.add(getDimensionId(tagEntry.dimension));

    expandTagPath(tagEntry.path).forEach((expandedPath) => {
      tagIds.add(getPathId(tagEntry.dimension, expandedPath));
    });
  });

  return Array.from(tagIds);
}

/**
 * 根据所有档案生成“分类方式 -> 层级分类”的索引树。
 */
export function buildTagTree(archives, seedTagEntries = []) {
  const dimensionMap = new Map();

  dedupeTagEntries(
    [
      ...seedTagEntries
        .map((tagEntry) => createTagEntry(tagEntry.dimension, tagEntry.path))
        .filter(Boolean),
      ...archives.flatMap((archive) => archive.tags)
    ].filter(Boolean)
  ).forEach((tagEntry) => {
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

/**
 * 尝试把旧格式数据升级成新格式。
 * 旧数据如果只有字符串标签，会根据内容做一个温和推断。
 */
export function normalizeTagEntries(rawTags) {
  if (!Array.isArray(rawTags)) {
    return [];
  }

  const normalized = rawTags
    .map((rawTag) => {
      if (typeof rawTag === "string") {
        return createTagEntry(inferLegacyDimension(rawTag), rawTag);
      }

      if (!rawTag || typeof rawTag !== "object") {
        return null;
      }

      return createTagEntry(rawTag.dimension ?? LEGACY_DIMENSION_FALLBACK, rawTag.path ?? rawTag.label);
    })
    .filter(Boolean);

  return dedupeTagEntries(normalized);
}

export function dedupeTagEntries(tagEntries) {
  const seen = new Set();
  return tagEntries.filter((tagEntry) => {
    if (seen.has(tagEntry.id)) {
      return false;
    }

    seen.add(tagEntry.id);
    return true;
  });
}

export function getDimensionId(dimension) {
  return `dimension::${normalizeDimension(dimension)}`;
}

export function getPathId(dimension, path) {
  return `path::${normalizeDimension(dimension)}::${normalizeTagPath(path)}`;
}

export function getLastSegment(path) {
  const segments = normalizeTagPath(path).split("->").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

function expandTagPath(tagPath) {
  const segments = normalizeTagPath(tagPath).split("->").filter(Boolean);
  const expanded = [];

  for (let index = 0; index < segments.length; index += 1) {
    expanded.push(segments.slice(0, index + 1).join("->"));
  }

  return expanded;
}

function populateCounts(dimensionMap, archives) {
  dimensionMap.forEach((dimensionNode) => {
    dimensionNode.count = archives.filter((archive) =>
      archive.searchableTagIds.includes(dimensionNode.id)
    ).length;

    populateChildCounts(dimensionNode, archives);
  });
}

function populateChildCounts(node, archives) {
  node.children.forEach((childNode) => {
    childNode.count = archives.filter((archive) =>
      archive.searchableTagIds.includes(childNode.id)
    ).length;

    populateChildCounts(childNode, archives);
  });
}

function sortDimensions(dimensionMap) {
  const dimensions = Array.from(dimensionMap.values()).sort((left, right) =>
    left.label.localeCompare(right.label, "zh-Hans-CN")
  );

  dimensions.forEach((dimensionNode) => {
    sortChildren(dimensionNode);
  });

  return dimensions;
}

function sortChildren(node) {
  node.children = new Map(
    Array.from(node.children.entries()).sort((left, right) =>
      left[1].path.localeCompare(right[1].path, "zh-Hans-CN")
    )
  );

  node.children.forEach((childNode) => {
    sortChildren(childNode);
  });
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

  return "食材种类";
}

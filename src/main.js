import {
  appendArchive,
  loadArchives,
  loadFavoriteTags,
  loadIndexTemplates,
  removeArchive,
  saveArchives,
  saveFavoriteTags,
  saveIndexTemplates
} from "./storage.js?v=20260414b";
import {
  buildSearchableTagIds,
  buildTagTree,
  createTagEntry,
  dedupeTagEntries,
  getDimensionId,
  getLastSegment,
  getPathId,
  normalizeDimension,
  normalizeTagPath
} from "./tag-utils.js?v=20260414b";
import { DEFAULT_INDEX_ENTRIES } from "./default-indexes.js?v=20260414b";

const formElement = document.querySelector("#archive-form");
const imageInput = document.querySelector("#food-image");
const descriptionInput = document.querySelector("#food-description");
const imagePreviewElement = document.querySelector("#image-preview");
const tagDimensionInput = document.querySelector("#tag-dimension");
const tagSegmentInput = document.querySelector("#tag-segment");
const tagSegmentSelect = document.querySelector("#tag-segment-select");
const pathPreviewElement = document.querySelector("#path-preview");
const addSegmentButton = document.querySelector("#add-segment");
const removeLastSegmentButton = document.querySelector("#remove-last-segment");
const clearPathButton = document.querySelector("#clear-path");
const addTagButton = document.querySelector("#add-tag");
const recentTagsElement = document.querySelector("#recent-tags");
const favoriteTagsElement = document.querySelector("#favorite-tags");
const recentDimensionsElement = document.querySelector("#recent-dimensions");
const tagTreeElement = document.querySelector("#tag-tree");
const resultsElement = document.querySelector("#results");
const selectedTagsElement = document.querySelector("#selected-tags");
const resultsCountElement = document.querySelector("#results-count");
const entryCountElement = document.querySelector("#entry-count");
const runQueryButton = document.querySelector("#run-query");
const clearFiltersButton = document.querySelector("#clear-filters");
const resetDefaultIndexesButton = document.querySelector("#reset-default-indexes");
const resetFormButton = document.querySelector("#reset-form");

const state = {
  archives: loadArchives(),
  favoriteTags: loadFavoriteTags(),
  indexTemplates: loadIndexTemplates(),
  selectedFilterIds: new Set(),
  appliedFilterIds: new Set(),
  pendingImageDataUrl: "",
  draftTags: [],
  expandedTagIds: new Set(),
  pendingTagSegments: []
};

initialize();

function initialize() {
  state.indexTemplates =
    state.indexTemplates.length === 0
      ? dedupeTagEntries([...DEFAULT_INDEX_ENTRIES, ...state.archives.flatMap((archive) => archive.tags)])
      : dedupeTagEntries([...state.indexTemplates, ...state.archives.flatMap((archive) => archive.tags)]);
  saveIndexTemplates(state.indexTemplates);
  bindEvents();
  render();
}

function bindEvents() {
  imageInput.addEventListener("change", async (event) => {
    const [file] = event.target.files ?? [];

    if (!file) {
      state.pendingImageDataUrl = "";
      renderImagePreview();
      return;
    }

    state.pendingImageDataUrl = await readFileAsDataUrl(file);
    renderImagePreview();
  });

  descriptionInput.addEventListener("input", () => {
    renderImagePreview();
  });

  addSegmentButton.addEventListener("click", () => {
    appendSegmentsFromInput();
  });

  tagDimensionInput.addEventListener("input", () => {
    renderTagBuilder();
  });

  tagSegmentSelect.addEventListener("change", () => {
    const selectedSegment = tagSegmentSelect.value.trim();

    if (!selectedSegment) {
      return;
    }

    tagSegmentInput.value = selectedSegment;
    renderTagBuilder();
    tagSegmentInput.focus();
  });

  tagSegmentInput.addEventListener("input", () => {
    renderTagBuilder();
  });

  tagSegmentInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    appendSegmentsFromInput();
  });

  removeLastSegmentButton.addEventListener("click", () => {
    if (state.pendingTagSegments.length === 0) {
      return;
    }

    state.pendingTagSegments = state.pendingTagSegments.slice(0, -1);
    renderTagBuilder();
  });

  clearPathButton.addEventListener("click", () => {
    state.pendingTagSegments = [];
    tagSegmentInput.value = "";
    renderTagBuilder();
  });

  addTagButton.addEventListener("click", () => {
    addDraftTagFromBuilder();
  });

  recentTagsElement.addEventListener("click", (event) => {
    const button = event.target.closest("[data-builder-dimension][data-builder-path]");

    if (!button) {
      return;
    }

    loadTagIntoBuilder(button.dataset.builderDimension, button.dataset.builderPath);
  });

  favoriteTagsElement.addEventListener("click", (event) => {
    const button = event.target.closest("[data-builder-dimension][data-builder-path]");

    if (!button) {
      return;
    }

    loadTagIntoBuilder(button.dataset.builderDimension, button.dataset.builderPath);
  });

  tagTreeElement.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-index-id]");

    if (deleteButton) {
      deleteIndex(deleteButton.dataset.deleteIndexId);
      return;
    }

    const favoriteButton = event.target.closest("[data-favorite-id]");

    if (favoriteButton) {
      toggleFavoriteTag(favoriteButton.dataset.favoriteId);
      return;
    }

    const expandButton = event.target.closest("[data-expand-id]");

    if (expandButton) {
      toggleExpandedNode(expandButton.dataset.expandId);
      return;
    }

    const filterButton = event.target.closest("[data-filter-id]");

    if (!filterButton) {
      return;
    }

    toggleFilter(filterButton.dataset.filterId);
  });

  selectedTagsElement.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-filter]");

    if (!button) {
      return;
    }

    toggleFilter(button.dataset.removeFilter);
  });

  imagePreviewElement.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-draft-tag]");

    if (!button) {
      return;
    }

    removeDraftTag(button.dataset.removeDraftTag);
  });

  resultsElement.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-archive-id]");

    if (!button) {
      return;
    }

    const archiveId = button.dataset.deleteArchiveId;

    if (!archiveId) {
      return;
    }

    const shouldDelete = window.confirm("确认删除这条图片档案吗？删除后无法恢复。");

    if (!shouldDelete) {
      return;
    }

    state.archives = removeArchive(archiveId);
    render();
  });

  formElement.addEventListener("submit", async (event) => {
    event.preventDefault();

    const description = descriptionInput.value.trim();

    if (!state.pendingImageDataUrl) {
      window.alert("请先选择一张食物图片。");
      return;
    }

    if (state.draftTags.length === 0) {
      window.alert("请至少添加一个分类标签。");
      return;
    }

    const archive = {
      id: crypto.randomUUID(),
      imageDataUrl: state.pendingImageDataUrl,
      description,
      tags: state.draftTags,
      searchableTagIds: buildSearchableTagIds(state.draftTags),
      createdAt: new Date().toISOString()
    };

    state.archives = appendArchive(archive);
    persistDraftTagsToIndexTemplates();
    resetForm();
    render();
  });

  runQueryButton.addEventListener("click", () => {
    state.appliedFilterIds = new Set(state.selectedFilterIds);
    render();
  });

  clearFiltersButton.addEventListener("click", () => {
    state.selectedFilterIds.clear();
    state.appliedFilterIds.clear();
    state.expandedTagIds.clear();
    render();
  });

  resetDefaultIndexesButton.addEventListener("click", () => {
    resetIndexesToDefault();
  });

  resetFormButton.addEventListener("click", () => {
    resetForm();
    render();
  });
}

function render() {
  const filteredArchives = getFilteredArchives();
  const tagTree = buildTagTree(state.archives, state.indexTemplates);

  entryCountElement.textContent = `${state.archives.length} 条`;
  resultsCountElement.textContent = `${filteredArchives.length} 条`;
  runQueryButton.disabled = state.selectedFilterIds.size === 0;
  clearFiltersButton.disabled =
    state.selectedFilterIds.size === 0 && state.appliedFilterIds.size === 0;
  resetDefaultIndexesButton.disabled = false;

  renderImagePreview();
  renderTagBuilder();
  renderSelectedFilters();
  renderTagTree(tagTree);
  renderResults(filteredArchives);
}

function renderImagePreview() {
  if (!state.pendingImageDataUrl) {
    imagePreviewElement.classList.add("image-preview--empty");
    imagePreviewElement.innerHTML = "<span>上传后会在这里预览</span>";
    return;
  }

  imagePreviewElement.classList.remove("image-preview--empty");
  imagePreviewElement.innerHTML = renderArchiveCard(
    {
      id: "preview",
      imageDataUrl: state.pendingImageDataUrl,
      description: descriptionInput.value.trim(),
      tags: state.draftTags,
      createdAt: ""
    },
    { preview: true }
  );
}

function renderTagBuilder() {
  renderPathPreview();
  renderAvailableNextSegments();
  renderRecentTags();
  renderFavoriteTags();
  renderRecentDimensions();

  removeLastSegmentButton.disabled = state.pendingTagSegments.length === 0;
  clearPathButton.disabled = state.pendingTagSegments.length === 0 && !tagSegmentInput.value.trim();

  const hasReadyDimension = Boolean(normalizeDimension(tagDimensionInput.value));
  addTagButton.disabled = !hasReadyDimension || state.pendingTagSegments.length === 0;
}

function renderPathPreview() {
  if (state.pendingTagSegments.length === 0) {
    pathPreviewElement.innerHTML = '<span class="selected-tags__empty">还没有添加层级。</span>';
    return;
  }

  pathPreviewElement.innerHTML = `
    <div class="path-preview__chips">
      ${state.pendingTagSegments
        .map(
          (segment, index) => `
            <span class="path-chip">
              <span>${escapeHtml(segment)}</span>
              ${index < state.pendingTagSegments.length - 1 ? '<span class="path-chip__arrow">›</span>' : ""}
            </span>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAvailableNextSegments() {
  const dimension = normalizeDimension(tagDimensionInput.value);
  const nextSegments = getAvailableNextSegments();
  const typedSegment = tagSegmentInput.value.trim();

  let placeholder = "先填写分类方式";

  if (dimension && nextSegments.length > 0) {
    placeholder = "选择已有下一级分类";
  } else if (dimension) {
    placeholder = "当前路径下暂无现成分类，可直接新增";
  }

  tagSegmentSelect.innerHTML = `
    <option value="">${escapeHtml(placeholder)}</option>
    ${nextSegments
      .map((segment) => `<option value="${escapeHtml(segment)}">${escapeHtml(segment)}</option>`)
      .join("")}
  `;

  tagSegmentSelect.disabled = !dimension || nextSegments.length === 0;

  if (nextSegments.includes(typedSegment)) {
    tagSegmentSelect.value = typedSegment;
  }
}

function renderRecentDimensions() {
  const recentDimensions = Array.from(
    new Set(
      [...getRecentTagEntries(), ...state.favoriteTags, ...state.indexTemplates]
        .map((tagEntry) => normalizeDimension(tagEntry.dimension))
        .filter(Boolean)
    )
  ).slice(0, 6);

  recentDimensionsElement.innerHTML = recentDimensions
    .map((dimension) => `<option value="${escapeHtml(dimension)}"></option>`)
    .join("");
}

function renderRecentTags() {
  const recentTags = getRecentTagEntries();

  if (recentTags.length === 0) {
    recentTagsElement.innerHTML = '<span class="selected-tags__empty">暂无最近分类。</span>';
    return;
  }

  recentTagsElement.innerHTML = recentTags.map((tagEntry) => renderBuilderChip(tagEntry)).join("");
}

function renderFavoriteTags() {
  if (state.favoriteTags.length === 0) {
    favoriteTagsElement.innerHTML = '<span class="selected-tags__empty">暂无收藏分类。</span>';
    return;
  }

  favoriteTagsElement.innerHTML = state.favoriteTags
    .map((tagEntry) => renderBuilderChip(tagEntry))
    .join("");
}

function renderBuilderChip(tagEntry) {
  const isActive =
    normalizeDimension(tagDimensionInput.value) === normalizeDimension(tagEntry.dimension) &&
    normalizeTagPath(state.pendingTagSegments.join("->")) === normalizeTagPath(tagEntry.path);
  const label = tagEntry.path
    ? `${tagEntry.dimension} / ${formatTagPathForDisplay(tagEntry.path)}`
    : tagEntry.dimension;

  return `
    <button
      type="button"
      class="example-chip ${isActive ? "is-active" : ""}"
      data-builder-dimension="${escapeHtml(tagEntry.dimension)}"
      data-builder-path="${escapeHtml(tagEntry.path)}"
    >
      <span class="example-chip__meta">${escapeHtml(tagEntry.dimension)}</span>
      <span class="example-chip__label">${escapeHtml(label)}</span>
    </button>
  `;
}

function renderSelectedFilters() {
  const selectedFilterIds = Array.from(state.selectedFilterIds);

  if (selectedFilterIds.length === 0) {
    selectedTagsElement.innerHTML = "";
    return;
  }

  selectedTagsElement.innerHTML = selectedFilterIds
    .map(
      (filterId) => `
        <span class="selected-tag">
          <span>${escapeHtml(getFilterLabel(filterId))}</span>
          <button type="button" data-remove-filter="${escapeHtml(filterId)}" aria-label="移除筛选">
            ×
          </button>
        </span>
      `
    )
    .join("");
}

function getAvailableNextSegments() {
  const dimension = normalizeDimension(tagDimensionInput.value);

  if (!dimension) {
    return [];
  }

  const currentSegments = state.pendingTagSegments.map((segment) => segment.trim()).filter(Boolean);
  const nextSegments = new Set();

  dedupeTagEntries([...state.indexTemplates, ...state.draftTags]).forEach((tagEntry) => {
    if (normalizeDimension(tagEntry.dimension) !== dimension) {
      return;
    }

    const segments = normalizeTagPath(tagEntry.path).split("->").filter(Boolean);

    if (segments.length <= currentSegments.length) {
      return;
    }

    const matchesPrefix = currentSegments.every((segment, index) => segments[index] === segment);

    if (!matchesPrefix) {
      return;
    }

    nextSegments.add(segments[currentSegments.length]);
  });

  return Array.from(nextSegments).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function renderTagTree(dimensions) {
  if (dimensions.length === 0) {
    tagTreeElement.innerHTML = '<div class="empty-state">还没有任何分类。</div>';
    return;
  }

  tagTreeElement.innerHTML = `
    <div class="tag-tree__list">
      ${dimensions.map((dimensionNode) => renderDimensionNode(dimensionNode)).join("")}
    </div>
  `;
}

function renderDimensionNode(dimensionNode) {
  const hasChildren = dimensionNode.children.size > 0;
  const isExpanded = state.expandedTagIds.has(dimensionNode.id);

  return `
    <section class="dimension-card">
      <div class="tree-row tree-row--dimension">
        ${renderExpandControl({
          id: dimensionNode.id,
          label: dimensionNode.label,
          subtitle: hasChildren ? `${dimensionNode.children.size} 个一级分类` : "暂无下一级分类",
          hasChildren,
          isExpanded,
          count: dimensionNode.count
        })}
        <div class="tree-row__actions">
          ${renderSelectButton(dimensionNode.id)}
          ${renderFavoriteButton(dimensionNode.id)}
          ${renderDeleteButton(dimensionNode.id)}
        </div>
      </div>
      ${hasChildren && isExpanded ? renderTreeChildren(dimensionNode, 1) : ""}
    </section>
  `;
}

function renderTreeChildren(node, depth) {
  if (node.children.size === 0) {
    return "";
  }

  const items = Array.from(node.children.values())
    .map((childNode) => renderTreeNode(childNode, depth))
    .join("");

  return `<ul class="tag-tree__children tag-tree__children--depth-${depth}">${items}</ul>`;
}

function renderTreeNode(node, depth) {
  const hasChildren = node.children.size > 0;
  const isExpanded = state.expandedTagIds.has(node.id);
  const displayPath = formatTagPathForDisplay(node.path);
  const subtitle =
    displayPath !== node.label ? displayPath : hasChildren ? "展开下一级索引" : "末级分类";

  return `
    <li class="tag-node">
      <div class="tree-row">
        ${renderExpandControl({
          id: node.id,
          label: node.label,
          subtitle,
          hasChildren,
          isExpanded,
          count: node.count
        })}
        <div class="tree-row__actions">
          ${renderSelectButton(node.id)}
          ${renderFavoriteButton(node.id)}
          ${renderDeleteButton(node.id)}
        </div>
      </div>
      ${hasChildren && isExpanded ? renderTreeChildren(node, depth + 1) : ""}
    </li>
  `;
}

function renderExpandControl({ id, label, subtitle, hasChildren, isExpanded, count }) {
  const content = `
    <span class="tree-toggle__icon${hasChildren ? "" : " tree-toggle__icon--dot"}" aria-hidden="true">
      ${hasChildren ? (isExpanded ? "−" : "+") : "·"}
    </span>
    <span class="tree-item-button__text">
      <strong>${escapeHtml(label)}</strong>
      <span class="tree-toggle__path">${escapeHtml(subtitle)}</span>
    </span>
    <span class="tag-button__count">${count}</span>
  `;

  if (!hasChildren) {
    return `<div class="tree-item-button tree-item-button--static">${content}</div>`;
  }

  return `
    <button
      type="button"
      class="tree-item-button"
      data-expand-id="${escapeHtml(id)}"
      aria-expanded="${String(isExpanded)}"
    >
      ${content}
    </button>
  `;
}

function renderSelectButton(filterId) {
  const isSelected = state.selectedFilterIds.has(filterId);

  return `
    <button
      type="button"
      class="index-action-button index-action-button--select ${isSelected ? "is-selected" : ""}"
      data-filter-id="${escapeHtml(filterId)}"
      aria-pressed="${String(isSelected)}"
      aria-label="${isSelected ? "取消选中" : "选中索引"}"
    >
      ✓
    </button>
  `;
}

function renderFavoriteButton(filterId) {
  const isFavorited = state.favoriteTags.some((tagEntry) => tagEntry.id === filterId);

  return `
    <button
      type="button"
      class="index-action-button index-action-button--favorite ${isFavorited ? "is-selected" : ""}"
      data-favorite-id="${escapeHtml(filterId)}"
      aria-pressed="${String(isFavorited)}"
      aria-label="${isFavorited ? "取消收藏" : "收藏分类"}"
    >
      ${isFavorited ? "★" : "☆"}
    </button>
  `;
}

function renderDeleteButton(filterId) {
  return `
    <button
      type="button"
      class="index-action-button index-action-button--delete"
      data-delete-index-id="${escapeHtml(filterId)}"
      aria-label="删除索引"
    >
      ×
    </button>
  `;
}

function renderArchiveCard(archive, { preview = false } = {}) {
  const metaText = preview ? "预览效果" : `创建时间：${formatDateTime(archive.createdAt)}`;

  return `
    <article class="record-card ${preview ? "record-card--preview" : ""}">
      <div class="record-card__media">
        <img
          class="record-card__image"
          src="${archive.imageDataUrl}"
          alt="${escapeHtml(archive.description || "食物图片")}"
        />
      </div>
      <div class="record-card__body">
        <div class="record-card__header">
          <p class="record-card__meta">${metaText}</p>
          ${
            preview
              ? ""
              : `
                <button
                  type="button"
                  class="button button--ghost button--small"
                  data-delete-archive-id="${escapeHtml(archive.id)}"
                >
                  删除档案
                </button>
              `
          }
        </div>
        <div class="record-card__content">
          <section class="record-card__section">
            <p class="record-card__section-label">备注</p>
            ${
              archive.description
                ? `<p class="record-card__description">${escapeHtml(archive.description)}</p>`
                : preview
                  ? '<p class="record-card__hint">备注会同步显示在这里。</p>'
                  : '<p class="record-card__hint">未填写备注。</p>'
            }
          </section>
          <section class="record-card__section">
            <p class="record-card__section-label">分类标签</p>
            <div class="record-card__groups">
              ${renderArchiveTags(archive.tags, { preview })}
            </div>
          </section>
        </div>
      </div>
    </article>
  `;
}

function renderArchiveTags(tags, { preview = false } = {}) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return preview ? '<span class="selected-tags__empty">已添加的分类会显示在这里。</span>' : "";
  }

  return tags
    .map(
      (tagEntry) => `
        <div class="tag-group ${preview ? "tag-group--editable" : ""}">
          <div class="tag-group__head">
            <div class="tag-group__title">${escapeHtml(tagEntry.dimension)}</div>
            ${
              preview
                ? `
                  <button
                    type="button"
                    class="tag-group__remove"
                    data-remove-draft-tag="${escapeHtml(tagEntry.id)}"
                    aria-label="移除分类"
                  >
                    ×
                  </button>
                `
                : ""
            }
          </div>
          <div class="tag-group__path">${escapeHtml(formatTagPathForDisplay(tagEntry.path))}</div>
        </div>
      `
    )
    .join("");
}

function renderResults(archives) {
  if (state.appliedFilterIds.size === 0) {
    resultsElement.innerHTML = '<div class="empty-state">选择分类后点击“查询档案”。</div>';
    return;
  }

  if (archives.length === 0) {
    resultsElement.innerHTML = '<div class="empty-state">没有匹配当前筛选条件的档案。</div>';
    return;
  }

  resultsElement.innerHTML = archives
    .map((archive) => renderArchiveCard(archive))
    .join("");
}

function getFilteredArchives() {
  const requiredFilterIds = Array.from(state.appliedFilterIds);

  if (requiredFilterIds.length === 0) {
    return [];
  }

  return state.archives.filter((archive) =>
    requiredFilterIds.every((filterId) => archive.searchableTagIds.includes(filterId))
  );
}

function appendSegmentsFromInput() {
  const newSegments = parseSegmentsInput(tagSegmentInput.value);

  if (newSegments.length === 0) {
    window.alert("请先输入分类层级。");
    return;
  }

  state.pendingTagSegments = [...state.pendingTagSegments, ...newSegments];
  tagSegmentInput.value = "";
  renderTagBuilder();
  tagSegmentInput.focus();
}

function addDraftTagFromBuilder() {
  const dimension = normalizeDimension(tagDimensionInput.value);
  const path = normalizeTagPath(state.pendingTagSegments.join("->"));
  const tagEntry = createTagEntry(dimension, path);

  if (!tagEntry) {
    window.alert("请先填写完整的分类方式和具体分类。");
    return;
  }

  state.draftTags = dedupeTagEntries([...state.draftTags, tagEntry]);
  state.pendingTagSegments = [];
  tagSegmentInput.value = "";
  renderTagBuilder();
  renderImagePreview();
}

function loadTagIntoBuilder(dimension, path) {
  tagDimensionInput.value = normalizeDimension(dimension);
  state.pendingTagSegments = normalizeTagPath(path).split("->").filter(Boolean);
  tagSegmentInput.value = "";
  renderTagBuilder();
  tagSegmentInput.focus();
}

function getRecentTagEntries() {
  const uniqueTags = new Map();

  state.archives
    .slice()
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .forEach((archive) => {
      archive.tags.forEach((tagEntry) => {
        if (!uniqueTags.has(tagEntry.id)) {
          uniqueTags.set(tagEntry.id, tagEntry);
        }
      });
    });

  return Array.from(uniqueTags.values()).slice(0, 3);
}

function toggleFilter(filterId) {
  if (state.selectedFilterIds.has(filterId)) {
    state.selectedFilterIds.delete(filterId);
  } else {
    state.selectedFilterIds.add(filterId);
  }

  render();
}

function toggleExpandedNode(nodeId) {
  if (state.expandedTagIds.has(nodeId)) {
    state.expandedTagIds.delete(nodeId);
  } else {
    state.expandedTagIds.add(nodeId);
  }

  render();
}

function toggleFavoriteTag(filterId) {
  const existingIndex = state.favoriteTags.findIndex((tagEntry) => tagEntry.id === filterId);

  if (existingIndex >= 0) {
    state.favoriteTags = state.favoriteTags.filter((tagEntry) => tagEntry.id !== filterId);
  } else {
    state.favoriteTags = [buildFavoriteTag(filterId), ...state.favoriteTags].filter(Boolean).slice(0, 12);
  }

  saveFavoriteTags(state.favoriteTags);
  render();
}

function removeDraftTag(tagId) {
  state.draftTags = state.draftTags.filter((tagEntry) => tagEntry.id !== tagId);
  renderImagePreview();
}

function deleteIndex(filterId) {
  const impact = calculateDeleteImpact(filterId);
  const nextIndexTemplates = state.indexTemplates.filter(
    (tagEntry) => !shouldPruneTagEntry(tagEntry, filterId)
  );

  if (impact.affectedCount === 0 && nextIndexTemplates.length === state.indexTemplates.length) {
    return;
  }

  const confirmed =
    impact.affectedCount === 0
      ? window.confirm("该索引当前没有关联图片，确认删除这个索引吗？")
      : window.confirm(
          `该索引下的 ${impact.affectedCount} 张图片会去掉该索引，其中有 ${impact.deletedCount} 张图片仅含该索引，删除该索引后，图片将会被删除。确认继续吗？`
        );

  if (!confirmed) {
    return;
  }

  state.archives = impact.nextArchives;
  saveArchives(state.archives);
  state.indexTemplates = nextIndexTemplates;
  saveIndexTemplates(state.indexTemplates);

  state.favoriteTags = state.favoriteTags.filter((tagEntry) => !shouldPruneFilterId(tagEntry.id, filterId));
  saveFavoriteTags(state.favoriteTags);

  state.selectedFilterIds = pruneFilterSet(state.selectedFilterIds, filterId);
  state.appliedFilterIds = pruneFilterSet(state.appliedFilterIds, filterId);
  state.expandedTagIds = pruneFilterSet(state.expandedTagIds, filterId);

  render();
}

function resetIndexesToDefault() {
  const defaultIndexTemplates = dedupeTagEntries(DEFAULT_INDEX_ENTRIES);
  const defaultTagIds = new Set(defaultIndexTemplates.map((tagEntry) => tagEntry.id));
  const validDefaultFilterIds = new Set(buildSearchableTagIds(defaultIndexTemplates));
  let removedArchiveCount = 0;
  let trimmedArchiveCount = 0;

  const nextArchives = state.archives.flatMap((archive) => {
    const nextTags = archive.tags.filter((tagEntry) => defaultTagIds.has(tagEntry.id));

    if (nextTags.length === 0) {
      removedArchiveCount += 1;
      return [];
    }

    if (nextTags.length !== archive.tags.length) {
      trimmedArchiveCount += 1;
    }

    return [
      {
        ...archive,
        tags: nextTags,
        searchableTagIds: buildSearchableTagIds(nextTags)
      }
    ];
  });

  const confirmed = window.confirm(
    `索引会恢复为默认索引。${trimmedArchiveCount} 张图片会移除非默认索引，${removedArchiveCount} 张图片因为不再命中任何默认索引而被删除。确认继续吗？`
  );

  if (!confirmed) {
    return;
  }

  state.archives = nextArchives;
  saveArchives(state.archives);

  state.indexTemplates = defaultIndexTemplates;
  saveIndexTemplates(state.indexTemplates);

  state.favoriteTags = state.favoriteTags.filter((tagEntry) => validDefaultFilterIds.has(tagEntry.id));
  saveFavoriteTags(state.favoriteTags);

  state.selectedFilterIds = new Set(
    Array.from(state.selectedFilterIds).filter((filterId) => validDefaultFilterIds.has(filterId))
  );
  state.appliedFilterIds = new Set(
    Array.from(state.appliedFilterIds).filter((filterId) => validDefaultFilterIds.has(filterId))
  );
  state.expandedTagIds = new Set(
    Array.from(state.expandedTagIds).filter((filterId) => validDefaultFilterIds.has(filterId))
  );

  resetForm();
  render();
}

function resetForm() {
  formElement.reset();
  state.pendingImageDataUrl = "";
  state.draftTags = [];
  state.pendingTagSegments = [];
  tagDimensionInput.value = "";
  tagSegmentInput.value = "";
  renderImagePreview();
  renderTagBuilder();
}

function persistDraftTagsToIndexTemplates() {
  state.indexTemplates = dedupeTagEntries([...state.indexTemplates, ...state.draftTags]);
  saveIndexTemplates(state.indexTemplates);
}

function parseSegmentsInput(value) {
  return String(value ?? "")
    .split(/(?:->|,|，)/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function buildFavoriteTag(filterId) {
  if (filterId.startsWith("dimension::")) {
    const dimension = filterId.slice("dimension::".length);
    return {
      id: filterId,
      dimension,
      path: ""
    };
  }

  if (filterId.startsWith("path::")) {
    const parts = filterId.split("::");
    return {
      id: filterId,
      dimension: parts[1] ?? "",
      path: parts.slice(2).join("::")
    };
  }

  return null;
}

function calculateDeleteImpact(filterId) {
  let affectedCount = 0;
  let deletedCount = 0;
  const nextArchives = [];

  state.archives.forEach((archive) => {
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
  if (filterId.startsWith("dimension::")) {
    const targetDimension = filterId.slice("dimension::".length);
    return tags.filter((tagEntry) => normalizeDimension(tagEntry.dimension) !== targetDimension);
  }

  if (filterId.startsWith("path::")) {
    const parts = filterId.split("::");
    const targetDimension = parts[1] ?? "";
    const targetPath = normalizeTagPath(parts.slice(2).join("::"));

    return tags.filter((tagEntry) => {
      const sameDimension = normalizeDimension(tagEntry.dimension) === targetDimension;
      const tagPath = normalizeTagPath(tagEntry.path);
      const isWithinDeletedPath = tagPath === targetPath || tagPath.startsWith(`${targetPath}->`);

      return !(sameDimension && isWithinDeletedPath);
    });
  }

  return tags;
}

function pruneFilterSet(filterSet, deletedId) {
  return new Set(Array.from(filterSet).filter((filterId) => !shouldPruneFilterId(filterId, deletedId)));
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

  if (deletedId.startsWith("dimension::")) {
    return normalizeDimension(tagEntry.dimension) === deletedId.slice("dimension::".length);
  }

  if (deletedId.startsWith("path::")) {
    const parts = deletedId.split("::");
    const deletedDimension = parts[1] ?? "";
    const deletedPath = normalizeTagPath(parts.slice(2).join("::"));
    const candidateDimension = normalizeDimension(tagEntry.dimension);
    const candidatePath = normalizeTagPath(tagEntry.path);

    return (
      candidateDimension === deletedDimension &&
      (candidatePath === deletedPath || candidatePath.startsWith(`${deletedPath}->`))
    );
  }

  return false;
}

function shouldPruneFilterId(candidateId, deletedId) {
  if (candidateId === deletedId) {
    return true;
  }

  if (deletedId.startsWith("dimension::")) {
    const targetDimension = deletedId.slice("dimension::".length);

    if (candidateId.startsWith("dimension::")) {
      return candidateId.slice("dimension::".length) === targetDimension;
    }

    if (candidateId.startsWith("path::")) {
      return candidateId.split("::")[1] === targetDimension;
    }
  }

  if (deletedId.startsWith("path::") && candidateId.startsWith("path::")) {
    const deletedParts = deletedId.split("::");
    const candidateParts = candidateId.split("::");
    const deletedDimension = deletedParts[1] ?? "";
    const candidateDimension = candidateParts[1] ?? "";
    const deletedPath = normalizeTagPath(deletedParts.slice(2).join("::"));
    const candidatePath = normalizeTagPath(candidateParts.slice(2).join("::"));

    return (
      deletedDimension === candidateDimension &&
      (candidatePath === deletedPath || candidatePath.startsWith(`${deletedPath}->`))
    );
  }

  return false;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve(String(reader.result));
    });

    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("读取图片失败"));
    });

    reader.readAsDataURL(file);
  });
}

function formatDateTime(isoString) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(isoString));
}

function getFilterLabel(filterId) {
  if (filterId.startsWith("dimension::")) {
    return filterId.slice("dimension::".length);
  }

  if (filterId.startsWith("path::")) {
    const parts = filterId.split("::");
    const dimension = parts[1] ?? "";
    const path = parts.slice(2).join("::");
    return `${dimension} / ${getLastSegment(path)}`;
  }

  return filterId;
}

function formatTagPathForDisplay(path) {
  return normalizeTagPath(path).replaceAll("->", " / ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

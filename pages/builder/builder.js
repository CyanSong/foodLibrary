const archiveService = require("../../services/archive-service");
const { getDimensionId, getPathId } = require("../../utils/tag");
const { isCancelError } = require("../../utils/wx-api");

Page({
  data: {
    archiveCount: 0,
    draftImagePath: "",
    description: "",
    pathInput: "",
    pendingTagSegments: [],
    draftTags: [],
    recentTags: [],
    favoriteTags: [],
    availableNextSegments: [],
    nextSegmentPickerLabel: "选择已有一级分类",
    currentBuilderId: "",
    previewArchive: {
      id: "preview",
      imageSrc: "",
      description: "",
      tags: []
    },
    manualEntryHighlightActive: false,
    aiSummary: "",
    aiIndexingMeta: null,
    canAddCurrentTag: false,
    canRemoveLastSegment: false,
    canClearPath: false,
    isAiIndexing: false,
    isSaving: false
  },

  onShow() {
    try {
      this.refreshPageState();
      this.syncTabBarSelection();
    } catch (error) {
      console.error("[builder:onShow]", error);
      this.showError(error);
    }
  },

  onHide() {
    this.clearManualEntryHighlightTimer();
  },

  onUnload() {
    this.clearManualEntryHighlightTimer();
  },

  onPageScroll(event) {
    this.pageScrollTop = event.scrollTop || 0;
  },

  refreshPageState(overrides) {
    const nextState = Object.assign({}, this.data, overrides || {});
    const builderState = archiveService.getBuilderState({
      pendingTagSegments: nextState.pendingTagSegments,
      draftTags: nextState.draftTags
    });

    this.setData(
      Object.assign({}, overrides || {}, builderState, {
        currentBuilderId: this.buildCurrentBuilderId(nextState.pendingTagSegments),
        previewArchive: this.buildPreviewArchive(nextState),
        nextSegmentPickerLabel: this.buildNextSegmentPickerLabel(
          nextState.pendingTagSegments,
          builderState.availableNextSegments
        ),
        canAddCurrentTag: normalizeSegments(nextState.pendingTagSegments).length >= 2,
        canRemoveLastSegment: nextState.pendingTagSegments.length > 0,
        canClearPath:
          nextState.pendingTagSegments.length > 0 || Boolean(String(nextState.pathInput || "").trim())
      })
    );
  },

  buildPreviewArchive(state) {
    return {
      id: "preview",
      imageSrc: state.draftImagePath,
      description: state.description,
      tags: state.draftTags || []
    };
  },

  buildCurrentBuilderId(pendingTagSegments) {
    const normalizedSegments = normalizeSegments(pendingTagSegments);

    if (!normalizedSegments.length) {
      return "";
    }

    if (normalizedSegments.length === 1) {
      return getDimensionId(normalizedSegments[0]);
    }

    return getPathId(normalizedSegments[0], normalizedSegments.slice(1).join("->"));
  },

  buildNextSegmentPickerLabel(pendingTagSegments, availableNextSegments) {
    const normalizedSegments = normalizeSegments(pendingTagSegments);

    if (normalizedSegments.length === 0) {
      return availableNextSegments.length > 0
        ? "选择已有一级分类"
        : "当前还没有现成一级分类，可直接新增";
    }

    return availableNextSegments.length > 0
      ? "选择已有下一级分类"
      : "当前路径下暂无现成分类，可直接新增";
  },

  async handleChooseImage() {
    try {
      const tempFilePath = await archiveService.pickSingleImage();

      if (!tempFilePath) {
        return;
      }

      this.refreshPageState({
        draftImagePath: tempFilePath,
        manualEntryHighlightActive: false,
        aiSummary: "",
        aiIndexingMeta: null
      });
    } catch (error) {
      if (isCancelError(error)) {
        return;
      }

      this.showError(error);
    }
  },

  handleClearImage() {
    this.clearManualEntryHighlight();
    this.refreshPageState({
      draftImagePath: "",
      manualEntryHighlightActive: false,
      aiSummary: "",
      aiIndexingMeta: null
    });
  },

  handleDescriptionInput(event) {
    this.refreshPageState({
      description: event.detail.value
    });
  },

  handlePathInput(event) {
    const pathInput = event.detail.value;
    this.clearManualEntryHighlight();

    this.setData({
      pathInput,
      canClearPath:
        this.data.pendingTagSegments.length > 0 || Boolean(String(pathInput || "").trim())
    });
  },

  handleSelectAvailableSegment(event) {
    const targetIndex = Number(event.detail.value);
    const nextSegment = this.data.availableNextSegments[targetIndex] || "";

    if (!nextSegment) {
      return;
    }

    this.clearManualEntryHighlight();
    this.refreshPageState({
      pendingTagSegments: this.data.pendingTagSegments.concat(nextSegment),
      pathInput: ""
    });
  },

  handleAddSegment() {
    const nextSegments = parseSegmentsInput(this.data.pathInput);

    if (nextSegments.length === 0) {
      wx.showToast({
        title: "请先输入分类层级",
        icon: "none"
      });
      return;
    }

    this.clearManualEntryHighlight();
    this.refreshPageState({
      pendingTagSegments: this.data.pendingTagSegments.concat(nextSegments),
      pathInput: ""
    });
  },

  handleRemoveLastSegment() {
    if (!this.data.pendingTagSegments.length) {
      return;
    }

    this.clearManualEntryHighlight();
    this.refreshPageState({
      pendingTagSegments: this.data.pendingTagSegments.slice(0, -1)
    });
  },

  handleClearPath() {
    this.clearManualEntryHighlight();
    this.refreshPageState({
      pendingTagSegments: [],
      pathInput: ""
    });
  },

  handleAddTag() {
    const nextTag = archiveService.createManualTag({
      segments: this.data.pendingTagSegments
    });

    if (!nextTag) {
      wx.showToast({
        title: "分类链至少需要两级",
        icon: "none"
      });
      return;
    }

    this.clearManualEntryHighlight();
    this.refreshPageState({
      draftTags: archiveService.mergeDraftTags(this.data.draftTags, [nextTag]),
      pendingTagSegments: [],
      pathInput: ""
    });
  },

  handleLoadTagToBuilder(event) {
    const dimension = event.currentTarget.dataset.dimension || "";
    const path = event.currentTarget.dataset.path || "";
    const pendingTagSegments = buildPendingSegments(dimension, path);

    this.clearManualEntryHighlight();
    this.refreshPageState({
      pendingTagSegments,
      pathInput: ""
    });
  },

  handleEditDraftTag(event) {
    const id = event.detail.id || event.currentTarget.dataset.id;
    const dimension = event.detail.dimension || event.currentTarget.dataset.dimension || "";
    const path = event.detail.path || event.currentTarget.dataset.path || "";

    this.clearManualEntryHighlight();
    this.refreshPageState({
      draftTags: this.data.draftTags.filter((tag) => tag.id !== id),
      pendingTagSegments: buildPendingSegments(dimension, path),
      pathInput: "",
      aiSummary: ""
    });
  },

  handleManualClassify() {
    if (!this.data.draftImagePath) {
      wx.showToast({
        title: "请先选择图片",
        icon: "none"
      });
      return;
    }

    this.setData({
      manualEntryHighlightActive: true
    });
    this.scheduleManualEntryHighlightReset();

    const query = wx.createSelectorQuery();
    query.select("#manual-classify-anchor").boundingClientRect();
    query.exec((result) => {
      const rect = result && result[0];

      if (!rect) {
        return;
      }

      wx.pageScrollTo({
        scrollTop: Math.max(0, (this.pageScrollTop || 0) + rect.top - 72),
        duration: 260
      });
    });
  },

  handleResetForm() {
    this.clearManualEntryHighlight();
    this.refreshPageState({
      draftImagePath: "",
      description: "",
      pathInput: "",
      pendingTagSegments: [],
      draftTags: [],
      manualEntryHighlightActive: false,
      aiSummary: "",
      aiIndexingMeta: null
    });
  },

  async handleAiIndexing() {
    if (this.data.isAiIndexing) {
      return;
    }

    if (!this.data.draftImagePath) {
      wx.showToast({
        title: "请先选择图片",
        icon: "none"
      });
      return;
    }

    this.setData({
      isAiIndexing: true
    });

    try {
      const result = await archiveService.suggestAiTags({
        tempFilePath: this.data.draftImagePath
      });

      this.refreshPageState({
        draftTags: archiveService.upsertDraftTagsByDimensions(
          this.data.draftTags,
          result.tags,
          ["菜系", "食材类型"]
        ),
        aiSummary: result.summary,
        aiIndexingMeta: result.aiMeta
      });

      wx.showToast({
        title: "AI 分类已补全",
        icon: "success"
      });
    } catch (error) {
      this.showError(error);
    } finally {
      this.setData({
        isAiIndexing: false
      });
    }
  },

  async handleSaveArchive() {
    if (this.data.isSaving || this.data.isAiIndexing) {
      return;
    }

    this.setData({
      isSaving: true
    });

    try {
      await archiveService.createArchive({
        tempFilePath: this.data.draftImagePath,
        description: this.data.description,
        manualTags: this.data.draftTags,
        aiMeta: this.data.aiIndexingMeta
      });

      wx.showToast({
        title: "图片已入库",
        icon: "success"
      });

      this.refreshPageState({
        draftImagePath: "",
        description: "",
        pathInput: "",
        pendingTagSegments: [],
        draftTags: [],
        manualEntryHighlightActive: false,
        aiSummary: "",
        aiIndexingMeta: null,
        isSaving: false
      });
    } catch (error) {
      this.showError(error);
      this.setData({
        isSaving: false
      });
    }
  },

  showError(error) {
    console.error("[builder:error]", error);
    wx.showToast({
      title: String((error && error.message) || error || "操作失败").slice(0, 18),
      icon: "none"
    });
  },

  clearManualEntryHighlight() {
    this.clearManualEntryHighlightTimer();

    if (!this.data.manualEntryHighlightActive) {
      return;
    }

    this.setData({
      manualEntryHighlightActive: false
    });
  },

  scheduleManualEntryHighlightReset() {
    this.clearManualEntryHighlightTimer();
    this.manualEntryHighlightTimer = setTimeout(() => {
      this.manualEntryHighlightTimer = null;

      if (!this.data.manualEntryHighlightActive) {
        return;
      }

      this.setData({
        manualEntryHighlightActive: false
      });
    }, 2800);
  },

  clearManualEntryHighlightTimer() {
    if (!this.manualEntryHighlightTimer) {
      return;
    }

    clearTimeout(this.manualEntryHighlightTimer);
    this.manualEntryHighlightTimer = null;
  },

  syncTabBarSelection() {
    const tabBar = this.getTabBar && this.getTabBar();

    if (!tabBar || !tabBar.setData) {
      return;
    }

    tabBar.setData({
      selected: "pages/builder/builder"
    });
  }
});

function parseSegmentsInput(value) {
  return String(value || "")
    .split(/(?:->|\/|,|，)/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function normalizeSegments(segments) {
  if (!Array.isArray(segments)) {
    return [];
  }

  return segments.map((segment) => String(segment || "").trim()).filter(Boolean);
}

function buildPendingSegments(dimension, path) {
  if (!dimension) {
    return [];
  }

  return [dimension].concat(String(path || "").split("->").map((segment) => segment.trim()).filter(Boolean));
}

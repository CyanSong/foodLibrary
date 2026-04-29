const archiveService = require("../../services/archive-service");
const { formatTagPathForDisplay } = require("../../utils/tag");
const { showModal } = require("../../utils/wx-api");

Page({
  data: {
    isAdvancedFilterOpen: false,
    selectedFilterIds: [],
    appliedFilterIds: [],
    selectedResultId: "",
    selectedFilters: [],
    favoriteFilterIds: [],
    expandedTagIds: [],
    treeRows: [],
    results: [],
    archiveCount: 0,
    resultCount: 0,
    emptyResultsText: "点击分类右侧√按钮直接查看档案。"
  },

  onShow() {
    try {
      this.syncSearchState();
      this.syncTabBarSelection();
    } catch (error) {
      console.error("[search:onShow]", error);
      this.showError(error);
    }
  },

  syncSearchState(overrides) {
    const nextState = Object.assign({}, this.data, overrides || {});
    const searchState = archiveService.getSearchState({
      selectedFilterIds: nextState.selectedFilterIds,
      appliedFilterIds: nextState.appliedFilterIds
    });
    const expandedTagIds = this.getValidExpandedTagIds(
      searchState.tagTree,
      nextState.expandedTagIds
    );
    const activeFilterIds = nextState.isAdvancedFilterOpen
      ? nextState.selectedFilterIds
      : nextState.selectedFilterIds.length
        ? nextState.selectedFilterIds
        : nextState.appliedFilterIds;
    const selectedResultId = searchState.results.some((archive) => archive.id === nextState.selectedResultId)
      ? nextState.selectedResultId
      : "";
    const treeRows = this.flattenTreeRows({
      nodes: searchState.tagTree,
      expandedTagIds,
      selectedFilterIds: activeFilterIds,
      favoriteFilterIds: searchState.favoriteFilterIds,
      depth: 0
    });

    this.tagTree = searchState.tagTree;

    this.setData(
      Object.assign({}, overrides || {}, {
        archiveCount: searchState.archiveCount,
        resultCount: searchState.resultCount,
        results: searchState.results,
        selectedResultId,
        selectedFilters: searchState.selectedFilters,
        favoriteFilterIds: searchState.favoriteFilterIds,
        expandedTagIds,
        treeRows,
        emptyResultsText: this.buildEmptyResultsText({
          archiveCount: searchState.archiveCount,
          resultCount: searchState.resultCount,
          appliedFilterIds: nextState.appliedFilterIds,
          isAdvancedFilterOpen: nextState.isAdvancedFilterOpen
        })
      })
    );
  },

  getValidExpandedTagIds(tagTree, expandedTagIds) {
    const validIds = new Set();

    collectNodeIds(tagTree, validIds);

    return [].concat(expandedTagIds || []).filter((id) => validIds.has(id));
  },

  flattenTreeRows(options) {
    const expandedIdSet = new Set(options.expandedTagIds || []);
    const selectedIdSet = new Set(options.selectedFilterIds || []);
    const favoriteIdSet = new Set(options.favoriteFilterIds || []);
    const rows = [];

    (options.nodes || []).forEach((node) => {
      const hasChildren = Boolean(node.children && node.children.size > 0);
      const isExpanded = expandedIdSet.has(node.id);

      rows.push(
        this.createTreeRow({
          id: node.id,
          label: node.label,
          subtitle: hasChildren ? node.children.size + " 个一级分类" : "暂无下一级分类",
          count: node.count,
          depth: options.depth,
          hasChildren,
          isExpanded,
          isSelected: selectedIdSet.has(node.id),
          isFavorited: favoriteIdSet.has(node.id)
        })
      );

      if (hasChildren && isExpanded) {
        rows.push.apply(
          rows,
          this.flattenChildRows({
            children: Array.from(node.children.values()),
            expandedIdSet,
            selectedIdSet,
            favoriteIdSet,
            depth: options.depth + 1
          })
        );
      }
    });

    return rows;
  },

  flattenChildRows(options) {
    const rows = [];

    (options.children || []).forEach((node) => {
      const hasChildren = Boolean(node.children && node.children.size > 0);
      const isExpanded = options.expandedIdSet.has(node.id);
      const displayPath = formatTagPathForDisplay(node.path);
      const subtitle =
        displayPath !== node.label
          ? displayPath
          : hasChildren
            ? "展开下一级索引"
            : "末级分类";

      rows.push(
        this.createTreeRow({
          id: node.id,
          label: node.label,
          subtitle,
          count: node.count,
          depth: options.depth,
          hasChildren,
          isExpanded,
          isSelected: options.selectedIdSet.has(node.id),
          isFavorited: options.favoriteIdSet.has(node.id)
        })
      );

      if (hasChildren && isExpanded) {
        rows.push.apply(
          rows,
          this.flattenChildRows({
            children: Array.from(node.children.values()),
            expandedIdSet: options.expandedIdSet,
            selectedIdSet: options.selectedIdSet,
            favoriteIdSet: options.favoriteIdSet,
            depth: options.depth + 1
          })
        );
      }
    });

    return rows;
  },

  createTreeRow(options) {
    const indent = Math.min(options.depth, 5) * 18;

    return {
      id: options.id,
      label: options.label,
      subtitle: options.subtitle,
      count: options.count,
      hasChildren: options.hasChildren,
      selected: options.isSelected,
      favorited: options.isFavorited,
      icon: options.hasChildren ? (options.isExpanded ? "−" : "+") : "·",
      iconClass: options.hasChildren ? "" : "tree-toggle__icon--dot",
      indentStyle:
        options.depth > 0
          ? "margin-left: " +
            indent +
            "rpx; padding-left: 14rpx; border-left: 1rpx solid rgba(209, 183, 153, 0.78);"
          : ""
    };
  },

  buildEmptyResultsText(options) {
    if (!options.archiveCount) {
      return "还没有任何图片档案。";
    }

    if (![].concat(options.appliedFilterIds || []).length) {
      return options.isAdvancedFilterOpen
        ? "勾选分类后点击“查询档案”。"
        : "点击分类右侧√按钮直接查看档案。";
    }

    if (!options.resultCount) {
      return "没有匹配当前筛选条件的档案。";
    }

    return "";
  },

  handleToggleExpand(event) {
    const targetId = event.currentTarget.dataset.id;
    const nextExpandedTagIds = this.data.expandedTagIds.includes(targetId)
      ? this.data.expandedTagIds.filter((id) => id !== targetId)
      : this.data.expandedTagIds.concat(targetId);

    this.syncSearchState({
      expandedTagIds: nextExpandedTagIds
    });
  },

  handleToggleFilter(event) {
    const filterId = event.currentTarget.dataset.id;

    if (!filterId) {
      return;
    }

    if (!this.data.isAdvancedFilterOpen) {
      const isCurrentSingleFilter =
        this.data.appliedFilterIds.length === 1 &&
        this.data.selectedFilterIds.length === 1 &&
        this.data.appliedFilterIds[0] === filterId &&
        this.data.selectedFilterIds[0] === filterId;

      this.syncSearchState({
        selectedFilterIds: isCurrentSingleFilter ? [] : [filterId],
        appliedFilterIds: isCurrentSingleFilter ? [] : [filterId],
        selectedResultId: ""
      });
      return;
    }

    this.toggleFilter(filterId);
  },

  handleRemoveSelectedFilter(event) {
    this.toggleFilter(event.currentTarget.dataset.id);
  },

  toggleFilter(filterId) {
    if (!filterId) {
      return;
    }

    const nextSelectedFilterIds = this.data.selectedFilterIds.includes(filterId)
      ? this.data.selectedFilterIds.filter((id) => id !== filterId)
      : this.data.selectedFilterIds.concat(filterId);

    this.syncSearchState({
      selectedFilterIds: nextSelectedFilterIds
    });
  },

  handleRunQuery() {
    this.syncSearchState({
      appliedFilterIds: this.data.selectedFilterIds.slice(),
      selectedResultId: ""
    });
  },

  handleAdvancedFilterChange(event) {
    const isAdvancedFilterOpen = Boolean(event.detail.value);

    this.syncSearchState({
      isAdvancedFilterOpen,
      selectedFilterIds:
        isAdvancedFilterOpen && !this.data.selectedFilterIds.length && this.data.appliedFilterIds.length
          ? this.data.appliedFilterIds.slice()
          : this.data.selectedFilterIds
    });
  },

  handleClearFilters() {
    this.syncSearchState({
      selectedFilterIds: [],
      appliedFilterIds: [],
      expandedTagIds: [],
      selectedResultId: ""
    });
  },

  handleArmArchiveDelete(event) {
    const archiveId = event.detail.id;

    if (!archiveId) {
      return;
    }

    this.setData({
      selectedResultId: this.data.selectedResultId === archiveId ? "" : archiveId
    });
  },

  handleToggleFavorite(event) {
    archiveService.toggleFavoriteFilter(event.currentTarget.dataset.id);
    this.syncSearchState();
  },

  async handleDeleteIndex(event) {
    const filterId = event.currentTarget.dataset.id;

    if (!filterId) {
      return;
    }

    const impact = archiveService.getDeleteIndexImpact(filterId);

    if (!impact.hasEffect) {
      return;
    }

    try {
      const modalResult = await showModal({
        title: "删除索引",
        content:
          impact.affectedCount === 0
            ? "该索引当前没有关联图片，确认删除这个索引吗？"
            : "该索引下的 " +
              impact.affectedCount +
              " 张图片会去掉该索引，其中有 " +
              impact.deletedCount +
              " 张图片仅含该索引，删除该索引后，图片将会被删除。确认继续吗？",
        confirmColor: "#bb4f1d"
      });

      if (!modalResult.confirm) {
        return;
      }

      await archiveService.deleteIndex(filterId);
      this.syncSearchState({
        selectedFilterIds: archiveService.pruneFilterIds(this.data.selectedFilterIds, filterId),
        appliedFilterIds: archiveService.pruneFilterIds(this.data.appliedFilterIds, filterId),
        expandedTagIds: archiveService.pruneFilterIds(this.data.expandedTagIds, filterId)
      });
    } catch (error) {
      this.showError(error);
    }
  },

  async handleResetDefaultIndexes() {
    const impact = archiveService.getResetIndexesImpact();

    try {
      const modalResult = await showModal({
        title: "重置默认索引",
        content:
          "索引会恢复为默认索引。" +
          impact.trimmedArchiveCount +
          " 张图片会移除非默认索引，" +
          impact.removedArchiveCount +
          " 张图片因为不再命中任何默认索引而被删除。确认继续吗？",
        confirmColor: "#bb4f1d"
      });

      if (!modalResult.confirm) {
        return;
      }

      const resetResult = await archiveService.resetIndexesToDefault();

      this.syncSearchState({
        selectedFilterIds: archiveService.retainFilterIds(
          this.data.selectedFilterIds,
          resetResult.validDefaultFilterIds
        ),
        appliedFilterIds: archiveService.retainFilterIds(
          this.data.appliedFilterIds,
          resetResult.validDefaultFilterIds
        ),
        expandedTagIds: archiveService.retainFilterIds(
          this.data.expandedTagIds,
          resetResult.validDefaultFilterIds
        )
      });
    } catch (error) {
      this.showError(error);
    }
  },

  async handleDeleteArchive(event) {
    const archiveId = event.detail.id;

    if (!archiveId) {
      return;
    }

    try {
      const modalResult = await showModal({
        title: "删除档案",
        content: "确认删除这条图片档案吗？删除后无法恢复。",
        confirmColor: "#bb4f1d"
      });

      if (!modalResult.confirm) {
        return;
      }

      await archiveService.deleteArchive(archiveId);

      wx.showToast({
        title: "已删除",
        icon: "success"
      });

      this.syncSearchState({
        selectedResultId: ""
      });
    } catch (error) {
      this.showError(error);
    }
  },

  showError(error) {
    console.error("[search:error]", error);
    wx.showToast({
      title: String((error && error.message) || error || "操作失败").slice(0, 18),
      icon: "none"
    });
  },

  syncTabBarSelection() {
    const tabBar = this.getTabBar && this.getTabBar();

    if (!tabBar || !tabBar.setData) {
      return;
    }

    tabBar.setData({
      selected: "pages/search/search"
    });
  }
});

function collectNodeIds(nodes, targetSet) {
  [].concat(nodes || []).forEach((node) => {
    targetSet.add(node.id);

    if (node.children && node.children.size > 0) {
      collectNodeIds(Array.from(node.children.values()), targetSet);
    }
  });
}

Component({
  data: {
    selectedTagId: ""
  },

  properties: {
    archive: {
      type: Object,
      value: {}
    },
    showDelete: {
      type: Boolean,
      value: false
    },
    preview: {
      type: Boolean,
      value: false
    },
    deleteArmed: {
      type: Boolean,
      value: false
    },
    editableTags: {
      type: Boolean,
      value: false
    }
  },

  observers: {
    archive(nextArchive) {
      const selectedTagId = this.data.selectedTagId;
      const tags = (nextArchive && nextArchive.tags) || [];

      if (!selectedTagId) {
        return;
      }

      const stillExists = tags.some((tag) => tag && tag.id === selectedTagId);

      if (!stillExists) {
        this.setData({
          selectedTagId: ""
        });
      }
    }
  },

  methods: {
    handlePreview() {
      const imageSrc = this.properties.archive && this.properties.archive.imageSrc;

      if (!imageSrc) {
        return;
      }

      wx.previewImage({
        current: imageSrc,
        urls: [imageSrc]
      });
    },

    handleDelete() {
      this.triggerEvent("delete", {
        id: this.properties.archive && this.properties.archive.id
      });
    },

    handleArmDelete() {
      if (!this.properties.showDelete || this.properties.preview) {
        return;
      }

      this.triggerEvent("armdelete", {
        id: this.properties.archive && this.properties.archive.id
      });
    },

    handleToggleTagSelection(event) {
      if (!this.properties.editableTags) {
        return;
      }

      const nextId = event.currentTarget.dataset.id || "";
      const selectedTagId = this.data.selectedTagId === nextId ? "" : nextId;

      this.setData({
        selectedTagId
      });
    },

    handleEditTag(event) {
      this.setData({
        selectedTagId: ""
      });

      this.triggerEvent("edittag", {
        id: event.currentTarget.dataset.id,
        dimension: event.currentTarget.dataset.dimension,
        path: event.currentTarget.dataset.path
      });
    }
  }
});

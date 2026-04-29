Component({
  data: {
    selected: "pages/builder/builder",
    items: [
      {
        pagePath: "pages/builder/builder",
        text: "上传档案",
        icon: "builder"
      },
      {
        pagePath: "pages/search/search",
        text: "分类检索",
        icon: "search"
      }
    ]
  },

  methods: {
    handleSwitchTab(event) {
      const pagePath = event.currentTarget.dataset.path || "";

      if (!pagePath || pagePath === this.data.selected) {
        return;
      }

      wx.switchTab({
        url: "/" + pagePath
      });
    }
  }
});

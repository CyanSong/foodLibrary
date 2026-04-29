const { cloudEnvId } = require("./constants/app-config");

App({
  onLaunch() {
    if (!wx.cloud) {
      console.warn("[app] 当前基础库不支持云开发能力");
      return;
    }

    try {
      wx.cloud.init({
        env: cloudEnvId || wx.cloud.DYNAMIC_CURRENT_ENV,
        traceUser: true
      });
    } catch (error) {
      console.error("[app] 云开发初始化失败", error);
    }
  },

  globalData: {
    appName: "Food Library Mini"
  }
});

function chooseSingleImage() {
  return new Promise((resolve, reject) => {
    wx.chooseImage({
      count: 1,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success(result) {
        resolve((result.tempFilePaths || [])[0] || "");
      },
      fail: reject
    });
  });
}

function saveFile(tempFilePath) {
  return new Promise((resolve, reject) => {
    wx.saveFile({
      tempFilePath,
      success: resolve,
      fail: reject
    });
  });
}

function removeSavedFile(filePath) {
  return new Promise((resolve, reject) => {
    wx.removeSavedFile({
      filePath,
      success: resolve,
      fail: reject
    });
  });
}

function showModal(options) {
  return new Promise((resolve, reject) => {
    wx.showModal({
      ...options,
      success: resolve,
      fail: reject
    });
  });
}

function isCancelError(error) {
  const message = String((error && error.errMsg) || error || "");
  return message.includes("cancel");
}

module.exports = {
  chooseSingleImage,
  isCancelError,
  removeSavedFile,
  saveFile,
  showModal
};

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function readJson(key, fallbackValue) {
  try {
    const rawValue = wx.getStorageSync(key);

    if (rawValue === "" || rawValue === undefined || rawValue === null) {
      return cloneValue(fallbackValue);
    }

    if (typeof rawValue === "string") {
      return JSON.parse(rawValue);
    }

    return rawValue;
  } catch (error) {
    return cloneValue(fallbackValue);
  }
}

function writeJson(key, value) {
  wx.setStorageSync(key, JSON.stringify(value));
}

module.exports = {
  readJson,
  writeJson
};

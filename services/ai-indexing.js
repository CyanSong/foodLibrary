const indexTemplateRepository = require("../repositories/index-template-repository");
const { aiIndexingDimensions, aiIndexingFunctionName } = require("../constants/app-config");
const { createTagEntry, dedupeTagEntries, normalizeDimension, normalizeTagEntries } = require("../utils/tag");

async function suggestTags(options) {
  const tempFilePath = String((options && options.tempFilePath) || "").trim();

  if (!tempFilePath) {
    throw new Error("请先选择图片，再使用 AI 识图。");
  }

  ensureCloudReady();

  const existingIndexOptions = buildExistingIndexOptions();
  let fileID = "";

  try {
    const uploadResult = await wx.cloud.uploadFile({
      cloudPath: buildCloudPath(tempFilePath),
      filePath: tempFilePath
    });

    fileID = uploadResult.fileID || "";

    const invokeResult = await wx.cloud.callFunction({
      name: aiIndexingFunctionName,
      data: {
        fileID,
        mimeType: inferMimeType(tempFilePath),
        existingIndexOptions
      }
    });

    return normalizeAiResult(invokeResult && invokeResult.result);
  } catch (error) {
    console.error("[ai-indexing:suggestTags:raw-error]", error);
    throw normalizeInvokeError(error);
  } finally {
    if (fileID && wx.cloud && typeof wx.cloud.deleteFile === "function") {
      wx.cloud.deleteFile({
        fileList: [fileID]
      }).catch(() => {});
    }
  }
}

function ensureCloudReady() {
  if (!wx.cloud || typeof wx.cloud.uploadFile !== "function" || typeof wx.cloud.callFunction !== "function") {
    throw new Error("当前环境没有启用云开发，请先在微信开发者工具中开通并选择云环境。");
  }
}

function buildExistingIndexOptions() {
  const dimensionSet = new Set(aiIndexingDimensions.map(normalizeDimension));
  const groupedOptions = {};

  aiIndexingDimensions.forEach((dimension) => {
    groupedOptions[dimension] = [];
  });

  dedupeTagEntries(indexTemplateRepository.loadAll()).forEach((tagEntry) => {
    const dimension = normalizeDimension(tagEntry.dimension);

    if (!dimensionSet.has(dimension)) {
      return;
    }

    groupedOptions[dimension].push(tagEntry.path);
  });

  aiIndexingDimensions.forEach((dimension) => {
    groupedOptions[dimension] = Array.from(new Set(groupedOptions[dimension])).sort((left, right) =>
      left.localeCompare(right, "zh-Hans-CN")
    );
  });

  return groupedOptions;
}

function buildCloudPath(tempFilePath) {
  const extensionMatch = String(tempFilePath).match(/(\.[A-Za-z0-9]+)$/);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : ".jpg";
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return ["ai-indexing-temp", String(timestamp) + "-" + randomSuffix + extension].join("/");
}

function inferMimeType(filePath) {
  const lowerPath = String(filePath || "").toLowerCase();

  if (lowerPath.endsWith(".png")) {
    return "image/png";
  }

  if (lowerPath.endsWith(".webp")) {
    return "image/webp";
  }

  if (lowerPath.endsWith(".gif")) {
    return "image/gif";
  }

  return "image/jpeg";
}

function normalizeAiResult(result) {
  const returnedTags = normalizeTagEntries(result && result.tags);
  const scopedTags = aiIndexingDimensions
    .map((dimension) => {
      const matchedTag = returnedTags.find(
        (tagEntry) => normalizeDimension(tagEntry.dimension) === normalizeDimension(dimension)
      );

      return matchedTag ? createTagEntry(dimension, matchedTag.path) : null;
    })
    .filter(Boolean);

  if (!scopedTags.length) {
    throw new Error("AI 没有返回可用的菜系或食材类型。");
  }

  return {
    tags: scopedTags,
    summary: String((result && result.summary) || "").trim(),
    aiMeta: {
      provider: String((result && result.provider) || "tencent-hunyuan"),
      status: "completed"
    }
  };
}

function normalizeInvokeError(error) {
  const message = String((error && error.errMsg) || (error && error.message) || error || "");

  if (message.includes("找不到") || message.includes("not found")) {
    return new Error("云函数 hunyuanVisionIndex 还没部署，请先上传并部署云函数。");
  }

  if (message.includes("HUNYUAN_API_KEY")) {
    return new Error("云函数还没配置 HUNYUAN_API_KEY 环境变量。");
  }

  if (message.includes("Incorrect API key provided")) {
    return new Error("混元 API Key 无效，请在混元控制台重新生成 API Key，并更新云函数环境变量 HUNYUAN_API_KEY。");
  }

  if (message.includes("FUNCTIONS_TIME_LIMIT_EXCEEDED") || message.includes("errCode: -504003")) {
    return new Error("云函数执行超时，请到云函数配置里把超时时间调大到 20 到 30 秒。");
  }

  if (message.includes("混元返回内容无法解析为结构化结果")) {
    return new Error("模型返回格式不稳定。请查看云函数日志里 [hunyuanVisionIndex] 的原始输出片段。");
  }

  if (message.includes("INVALID_ENV_SOURCE")) {
    return new Error("当前云环境还不是这个小程序可用的环境，请先做小程序环境关联或环境转换。");
  }

  if (message.includes("INVALID_ENV")) {
    return new Error("云环境 ID 无效，或当前小程序没有绑定到这个云环境。");
  }

  if (message.includes("invalid scope")) {
    return new Error("云环境刚开通或刚转换，后台可能还没生效，稍等几分钟后重试。");
  }

  if (
    message.includes("Cloud API isn't enabled") ||
    message.includes("cloud.init") ||
    message.includes("请先开通云开发")
  ) {
    return new Error("云开发调用失败，请确认当前小程序已绑定并选中了云环境。");
  }

  if (message) {
    return new Error(message);
  }

  return new Error("AI 识图暂时不可用，请稍后再试。");
}

module.exports = {
  suggestTags
};

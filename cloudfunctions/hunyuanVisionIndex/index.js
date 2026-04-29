const https = require("https");
const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const HUNYUAN_API_HOST = "api.hunyuan.cloud.tencent.com";
const HUNYUAN_API_PATH = "/v1/chat/completions";
const DEFAULT_MODEL = process.env.HUNYUAN_VISION_MODEL || "hunyuan-t1-vision-20250916";
const STRUCTURE_MODEL = process.env.HUNYUAN_STRUCT_MODEL || "hunyuan-turbos-latest";
const REQUEST_TIMEOUT_MS = Number(process.env.HUNYUAN_TIMEOUT_MS || 15000);
const TARGET_DIMENSIONS = ["菜系", "食材类型"];

exports.main = async (event) => {
  const fileID = String((event && event.fileID) || "").trim();
  const existingIndexOptions = normalizeExistingIndexOptions(event && event.existingIndexOptions);
  const apiKey = String(process.env.HUNYUAN_API_KEY || "").trim();

  if (!fileID) {
    throw new Error("缺少 fileID，无法读取待识别图片。");
  }

  if (!apiKey) {
    throw new Error("请先在云函数环境变量中配置 HUNYUAN_API_KEY。");
  }

  try {
    const downloadResult = await cloud.downloadFile({
      fileID
    });
    const imageBuffer = Buffer.isBuffer(downloadResult.fileContent)
      ? downloadResult.fileContent
      : Buffer.from(downloadResult.fileContent);
    const mimeType = normalizeMimeType(event && event.mimeType, imageBuffer);
    const requestBody = buildChatRequest({
      dataUrl: buildDataUrl(imageBuffer, mimeType),
      existingIndexOptions
    });
    const completion = await requestHunyuan(requestBody, apiKey);
    console.info("[hunyuanVisionIndex] first-pass choice", previewForLog(completion && completion.choices && completion.choices[0]));
    const parsedResult = await parseModelResult(completion, existingIndexOptions, apiKey);

    return {
      ok: true,
      provider: "tencent-hunyuan",
      model: DEFAULT_MODEL,
      summary: parsedResult.summary,
      tags: parsedResult.tags,
      rawText: parsedResult.rawText
    };
  } finally {
    await safeDeleteCloudFile(fileID);
  }
};

function buildChatRequest(options) {
  return {
    model: DEFAULT_MODEL,
    temperature: 0,
    max_tokens: 220,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildPrompt(options.existingIndexOptions)
          },
          {
            type: "image_url",
            image_url: {
              url: options.dataUrl
            }
          }
        ]
      }
    ]
  };
}

function buildPrompt(existingIndexOptions) {
  return [
    "你是美食图片分类助手，要为这张食物图片生成两个层级索引：菜系、食材类型。",
    "规则：",
    "1. 优先从“已有索引”中精确选择，并原样返回完整路径。",
    "2. 只有完全没有合适项时，才新建路径。",
    "3. 新建路径必须是中文，用 -> 连接 2 到 5 级，从宽到窄。",
    "4. 菜系：选择最能代表整道菜风格的菜系，不要返回未知。",
    "5. 食材类型：选择最能代表整道菜身份的主食材；如果是复合菜，优先选视觉上最核心的主料。",
    "6. 整个回答只能是 JSON，不能出现 ```、前言、解释、项目符号、换行说明。",
    '7. 第一字符必须是 {，最后字符必须是 }。',
    '8. JSON 固定格式：{"cuisine":{"path":"...","source":"existing|new"},"ingredientType":{"path":"...","source":"existing|new"},"summary":"不超过40字"}。',
    "",
    "已有索引：",
    "菜系：",
    formatOptionList(existingIndexOptions["菜系"]),
    "",
    "食材类型：",
    formatOptionList(existingIndexOptions["食材类型"])
  ].join("\n");
}

function formatOptionList(options) {
  if (!Array.isArray(options) || !options.length) {
    return "（当前没有现成索引，可按规则新建）";
  }

  return options.map((option, index) => String(index + 1) + ". " + option).join("\n");
}

function normalizeExistingIndexOptions(rawOptions) {
  const normalizedOptions = {};

  TARGET_DIMENSIONS.forEach((dimension) => {
    normalizedOptions[dimension] = Array.from(
      new Set(
        [].concat((rawOptions && rawOptions[dimension]) || [])
          .map((option) => normalizePath(option))
          .filter(Boolean)
      )
    );
  });

  return normalizedOptions;
}

function buildDataUrl(imageBuffer, mimeType) {
  return "data:" + mimeType + ";base64," + imageBuffer.toString("base64");
}

function normalizeMimeType(inputMimeType, imageBuffer) {
  const normalizedInput = String(inputMimeType || "").trim().toLowerCase();

  if (normalizedInput.startsWith("image/")) {
    return normalizedInput;
  }

  if (imageBuffer && imageBuffer.length >= 12) {
    if (imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8) {
      return "image/jpeg";
    }

    if (
      imageBuffer[0] === 0x89 &&
      imageBuffer[1] === 0x50 &&
      imageBuffer[2] === 0x4e &&
      imageBuffer[3] === 0x47
    ) {
      return "image/png";
    }

    if (
      imageBuffer[0] === 0x47 &&
      imageBuffer[1] === 0x49 &&
      imageBuffer[2] === 0x46
    ) {
      return "image/gif";
    }

    if (imageBuffer.toString("ascii", 0, 4) === "RIFF" && imageBuffer.toString("ascii", 8, 12) === "WEBP") {
      return "image/webp";
    }
  }

  return "image/jpeg";
}

function requestHunyuan(requestBody, apiKey) {
  const bodyText = JSON.stringify(requestBody);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: HUNYUAN_API_HOST,
        path: HUNYUAN_API_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyText),
          Authorization: "Bearer " + apiKey
        }
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          const responseText = Buffer.concat(chunks).toString("utf8");
          const parsedBody = safeJsonParse(responseText);

          if (response.statusCode >= 400) {
            reject(new Error(extractApiError(parsedBody) || "混元接口请求失败，状态码：" + response.statusCode));
            return;
          }

          if (!parsedBody) {
            reject(new Error("混元接口返回了无法解析的内容。"));
            return;
          }

          resolve(parsedBody);
        });
      }
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("调用混元接口超时，请稍后重试。"));
    });

    request.on("error", (error) => {
      reject(error);
    });

    request.write(bodyText);
    request.end();
  });
}

async function parseModelResult(completion, existingIndexOptions, apiKey) {
  const choice = completion && completion.choices && completion.choices[0];
  const rawText = extractContentText(choice);
  const contextText = extractContextText(choice);
  console.info("[hunyuanVisionIndex] first-pass rawText", previewText(rawText, 1200));

  if (contextText && contextText !== rawText) {
    console.info("[hunyuanVisionIndex] first-pass contextText", previewText(contextText, 1200));
  }

  let parsed = parseStructuredPayload(choice, rawText);

  if (!parsed && contextText && contextText !== rawText) {
    parsed = parseStructuredPayload(null, contextText);
  }

  if (!parsed) {
    parsed = await structureResultFromText(contextText || rawText, existingIndexOptions, apiKey);
  }

  if (!parsed) {
    parsed = inferStructuredPayloadFromText(contextText || rawText, existingIndexOptions);
  }

  if (!parsed) {
    console.warn("[hunyuanVisionIndex] unparseable model output", {
      rawText: previewText(contextText || rawText, 1200)
    });
    throw new Error("混元返回内容无法解析为结构化结果。");
  }

  const inferredPayload = inferStructuredPayloadFromText(contextText || rawText, existingIndexOptions);
  const cuisinePath = pickPreferredPath(
    readAliasedPath(parsed, ["cuisine", "菜系", "cuisinePath", "cuisine_path"]),
    readAliasedPath(inferredPayload, ["cuisine", "菜系", "cuisinePath", "cuisine_path"]),
    existingIndexOptions["菜系"]
  );
  const ingredientTypePath = pickPreferredPath(
    readAliasedPath(parsed, ["ingredientType", "ingredient_type", "ingredient", "食材类型", "食材"]),
    readAliasedPath(inferredPayload, ["ingredientType", "ingredient_type", "ingredient", "食材类型", "食材"]),
    existingIndexOptions["食材类型"]
  );

  if (!cuisinePath || !ingredientTypePath) {
    console.warn("[hunyuanVisionIndex] incomplete structured output", {
      parsed,
      inferredPayload
    });
    throw new Error("混元没有返回完整的菜系或食材类型。");
  }

  return {
    rawText: contextText || rawText,
    summary: readAliasedSummary(parsed) || readAliasedSummary(inferredPayload),
    tags: [
      {
        dimension: "菜系",
        path: cuisinePath
      },
      {
        dimension: "食材类型",
        path: ingredientTypePath
      }
    ]
  };
}

async function structureResultFromText(rawText, existingIndexOptions, apiKey) {
  if (!String(rawText || "").trim()) {
    return null;
  }

  const requestBody = buildStructuringRequest(rawText, existingIndexOptions, true);

  try {
    const completion = await requestHunyuan(requestBody, apiKey);
    const choice = completion && completion.choices && completion.choices[0];
    console.info("[hunyuanVisionIndex] forced-structuring choice", previewForLog(choice));
    console.info("[hunyuanVisionIndex] forced-structuring rawText", previewText(extractContentText(choice), 1200));
    const toolArguments = extractToolArgumentsText(choice);
    const parsedFromTool = safeJsonParse(toolArguments);

    if (parsedFromTool && typeof parsedFromTool === "object") {
      return parsedFromTool;
    }

    return parseStructuredPayload(choice, extractContentText(choice));
  } catch (error) {
    console.warn("[hunyuanVisionIndex] structuring with forced tool failed", error);
  }

  try {
    const completion = await requestHunyuan(buildStructuringRequest(rawText, existingIndexOptions, false), apiKey);
    const choice = completion && completion.choices && completion.choices[0];
    console.info("[hunyuanVisionIndex] fallback-structuring choice", previewForLog(choice));
    console.info("[hunyuanVisionIndex] fallback-structuring rawText", previewText(extractContentText(choice), 1200));
    const toolArguments = extractToolArgumentsText(choice);
    const parsedFromTool = safeJsonParse(toolArguments);

    if (parsedFromTool && typeof parsedFromTool === "object") {
      return parsedFromTool;
    }

    return parseStructuredPayload(choice, extractContentText(choice));
  } catch (error) {
    console.warn("[hunyuanVisionIndex] structuring fallback failed", error);
    return null;
  }
}

function buildStructuringRequest(rawText, existingIndexOptions, forceToolChoice) {
  const requestBody = {
    model: STRUCTURE_MODEL,
    temperature: 0,
    max_tokens: 180,
    messages: [
      {
        role: "user",
        content: buildStructuringPrompt(rawText, existingIndexOptions)
      }
    ],
    tools: [buildSubmitCategoriesTool()],
    tool_choice: "auto"
  };

  if (forceToolChoice) {
    requestBody.tool_choice = {
      type: "function",
      function: {
        name: "submit_categories"
      }
    };
  }

  return requestBody;
}

function buildStructuringPrompt(rawText, existingIndexOptions) {
  return [
    "请根据下面这段识图结果，整理出菜系和食材类型。",
    "要求：",
    "1. 优先使用已有索引中的完整路径。",
    "2. 只有完全没有合适项时才新建路径。",
    "3. 你必须调用 submit_categories 工具，不要输出普通文本。",
    "",
    "已有索引-菜系：",
    formatOptionList(existingIndexOptions["菜系"]),
    "",
    "已有索引-食材类型：",
    formatOptionList(existingIndexOptions["食材类型"]),
    "",
    "识图结果原文：",
    String(rawText || "").slice(0, 1200)
  ].join("\n");
}

function buildSubmitCategoriesTool() {
  return {
    type: "function",
    function: {
      name: "submit_categories",
      description: "提交菜系和食材类型分类结果",
      parameters: {
        type: "object",
        properties: {
          cuisine: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "菜系完整路径，例如 中式->八大菜系->川菜"
              },
              source: {
                type: "string",
                description: "existing 或 new"
              }
            },
            required: ["path"]
          },
          ingredientType: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "食材类型完整路径，例如 动物->禽肉->鸡肉"
              },
              source: {
                type: "string",
                description: "existing 或 new"
              }
            },
            required: ["path"]
          },
          summary: {
            type: "string",
            description: "不超过40字的简短说明"
          }
        },
        required: ["cuisine", "ingredientType"]
      }
    }
  };
}

function extractContentText(choice) {
  const toolArguments = extractToolArgumentsText(choice);

  if (toolArguments) {
    return toolArguments;
  }

  return collectMessageText(choice && choice.message && choice.message.content);
}

function extractReasoningText(choice) {
  return collectMessageText(choice && choice.message && choice.message.reasoning_content);
}

function extractContextText(choice) {
  const contentText = extractContentText(choice);
  const reasoningText = extractReasoningText(choice);

  if (contentText && reasoningText && normalizeForComparison(contentText) !== normalizeForComparison(reasoningText)) {
    return contentText + "\n" + reasoningText;
  }

  return contentText || reasoningText;
}

function collectMessageText(messageContent) {
  if (typeof messageContent === "string") {
    return messageContent;
  }

  if (Array.isArray(messageContent)) {
    return messageContent
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (!item || typeof item !== "object") {
          return String(item || "");
        }

        if (typeof item.text === "string") {
          return item.text;
        }

        if (typeof item.content === "string") {
          return item.content;
        }

        return "";
      })
      .join("\n");
  }

  return "";
}

function normalizeForComparison(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractJsonText(rawText) {
  const fencedMatch = String(rawText || "").match(/```json\s*([\s\S]*?)```/i);

  if (fencedMatch && fencedMatch[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = String(rawText || "").indexOf("{");
  const lastBrace = String(rawText || "").lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return String(rawText).slice(firstBrace, lastBrace + 1);
  }

  return String(rawText || "").trim();
}

function extractToolArgumentsText(choice) {
  const toolCalls = choice && choice.message && choice.message.tool_calls;

  if (!Array.isArray(toolCalls) || !toolCalls.length) {
    return "";
  }

  const firstCall = toolCalls[0];
  return String(
    (firstCall &&
      firstCall.function &&
      (firstCall.function.arguments || firstCall.function.output || "")) ||
      ""
  ).trim();
}

function parseStructuredPayload(choice, rawText) {
  const candidates = buildPayloadCandidates(choice, rawText);

  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate);

    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  }

  return parseLabeledText(rawText);
}

function buildPayloadCandidates(choice, rawText) {
  const candidates = [];
  const toolArguments = extractToolArgumentsText(choice);
  const textCandidates = [toolArguments, rawText, extractJsonText(rawText)];

  textCandidates.forEach((candidate) => {
    if (!candidate) {
      return;
    }

    candidates.push(String(candidate).trim());
    candidates.push(sanitizeJsonLikeText(candidate));
  });

  return Array.from(new Set(candidates.filter(Boolean)));
}

function sanitizeJsonLikeText(rawText) {
  const normalizedText = String(rawText || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/，/g, ",")
    .replace(/：/g, ":")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .trim();

  return normalizedText
    .replace(/([{,]\s*)([A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]*)(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^']*)'/g, ': "$1"')
    .replace(/,\s*([}\]])/g, "$1");
}

function parseLabeledText(rawText) {
  const normalizedText = String(rawText || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
  const cuisinePath = readLabeledValue(normalizedText, ["cuisine", "菜系"]);
  const ingredientTypePath = readLabeledValue(normalizedText, [
    "ingredientType",
    "ingredient_type",
    "ingredient",
    "食材类型",
    "食材"
  ]);
  const summary = readLabeledValue(normalizedText, ["summary", "总结", "说明", "reason"]);

  if (!cuisinePath && !ingredientTypePath) {
    return null;
  }

  return {
    cuisine: {
      path: cuisinePath
    },
    ingredientType: {
      path: ingredientTypePath
    },
    summary
  };
}

function inferStructuredPayloadFromText(rawText, existingIndexOptions) {
  const cuisinePath = inferPathByMention(rawText, existingIndexOptions["菜系"]);
  const ingredientTypePath = inferPathByMention(rawText, existingIndexOptions["食材类型"]);

  if (!cuisinePath && !ingredientTypePath) {
    return null;
  }

  return {
    cuisine: {
      path: cuisinePath
    },
    ingredientType: {
      path: ingredientTypePath
    },
    summary: ""
  };
}

function inferPathByMention(rawText, options) {
  const haystack = String(rawText || "").toLowerCase();
  let bestMatch = "";

  [].concat(options || []).forEach((option) => {
    const normalizedOption = normalizePath(option);

    if (!normalizedOption) {
      return;
    }

    const segments = normalizedOption.split("->").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    const normalizedOptionLower = normalizedOption.toLowerCase();

    if (
      (lastSegment && haystack.includes(lastSegment.toLowerCase())) ||
      haystack.includes(normalizedOptionLower)
    ) {
      if (!bestMatch || normalizedOption.length > bestMatch.length) {
        bestMatch = normalizedOption;
      }
    }
  });

  return bestMatch;
}

function readLabeledValue(text, aliases) {
  for (const alias of aliases) {
    const pattern = new RegExp(
      '(?:^|[\\n\\r,，])\\s*["“”]?'+
        escapeRegExp(alias) +
        '["“”]?\\s*[:：]\\s*(?:\\{[^{}]*["“”]?(?:path|路径)["“”]?\\s*[:：]\\s*["“”]?([^"“”\\n\\r}]+)["“”]?\\s*\\}|["“”]?([^"“”\\n\\r,，}]+)["“”]?)',
      "i"
    );
    const match = text.match(pattern);

    if (match) {
      return String(match[1] || match[2] || "").trim();
    }
  }

  return "";
}

function readAliasedPath(payload, aliases) {
  for (const alias of aliases) {
    if (payload && Object.prototype.hasOwnProperty.call(payload, alias)) {
      return readCandidatePath(payload[alias]);
    }
  }

  return "";
}

function readAliasedSummary(payload) {
  for (const alias of ["summary", "总结", "说明", "reason"]) {
    if (payload && Object.prototype.hasOwnProperty.call(payload, alias)) {
      return String(payload[alias] || "").trim();
    }
  }

  return "";
}

function readCandidatePath(candidate) {
  if (typeof candidate === "string") {
    return candidate;
  }

  if (!candidate || typeof candidate !== "object") {
    return "";
  }

  return candidate.path || candidate.value || candidate.label || "";
}

function normalizeSelectedPath(candidatePath, existingOptions) {
  const normalizedCandidate = normalizePath(candidatePath);

  if (!normalizedCandidate) {
    return "";
  }

  const matchedExistingPath = [].concat(existingOptions || []).find(
    (option) => normalizePath(option) === normalizedCandidate
  );

  return matchedExistingPath || normalizedCandidate;
}

function pickPreferredPath(primaryCandidate, fallbackCandidate, existingOptions) {
  const primaryPath = normalizeSelectedPath(primaryCandidate, existingOptions);
  const fallbackPath = normalizeSelectedPath(fallbackCandidate, existingOptions);

  if (!primaryPath) {
    return fallbackPath;
  }

  if (!fallbackPath) {
    return primaryPath;
  }

  const primaryExact = hasExactExistingMatch(primaryPath, existingOptions);
  const fallbackExact = hasExactExistingMatch(fallbackPath, existingOptions);

  if (primaryExact !== fallbackExact) {
    return fallbackExact ? fallbackPath : primaryPath;
  }

  if (isPathPrefix(primaryPath, fallbackPath) || isPathPrefix(fallbackPath, primaryPath)) {
    return countPathSegments(fallbackPath) > countPathSegments(primaryPath) ? fallbackPath : primaryPath;
  }

  return primaryPath;
}

function hasExactExistingMatch(candidatePath, existingOptions) {
  const normalizedCandidate = normalizePath(candidatePath);

  if (!normalizedCandidate) {
    return false;
  }

  return [].concat(existingOptions || []).some((option) => normalizePath(option) === normalizedCandidate);
}

function isPathPrefix(prefixPath, fullPath) {
  const normalizedPrefix = normalizePath(prefixPath);
  const normalizedFull = normalizePath(fullPath);

  if (!normalizedPrefix || !normalizedFull || normalizedPrefix === normalizedFull) {
    return false;
  }

  return normalizedFull.startsWith(normalizedPrefix + "->");
}

function countPathSegments(path) {
  return normalizePath(path)
    .split("->")
    .filter(Boolean)
    .length;
}

function normalizePath(value) {
  return String(value || "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .split(/(?:->|\/|,|，)/)
    .map(normalizePathSegment)
    .filter(Boolean)
    .join("->");
}

function normalizePathSegment(segment) {
  const normalizedSegment = String(segment || "").trim();

  if (!normalizedSegment) {
    return "";
  }

  const baseSegment = normalizedSegment
    .replace(/[{}[\]<>`"'\\]/g, "")
    .replace(/[?？]/g, "")
    .replace(/^[\s\-:：;；,.，/]+|[\s\-:：;；,.，/]+$/g, "")
    .trim();

  if (!baseSegment) {
    return "";
  }

  if (isAmbiguousSegment(baseSegment)) {
    return "";
  }

  return baseSegment;
}

function isAmbiguousSegment(baseSegment) {
  return /^(未明确|不明确|不确定|未知|待定|优先|倾向|可能|大概|类似|path|cuisine|ingredienttype|ingredient|summary|answer|null|undefined)$/.test(
    String(baseSegment || "").toLowerCase()
  );
}

function extractApiError(responseBody) {
  if (!responseBody || typeof responseBody !== "object") {
    return "";
  }

  if (responseBody.error && typeof responseBody.error === "object") {
    return String(responseBody.error.message || responseBody.error.code || "");
  }

  if (typeof responseBody.message === "string") {
    return responseBody.message;
  }

  return "";
}

function safeJsonParse(text) {
  if (typeof text !== "string") {
    return text && typeof text === "object" ? text : null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function previewText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .slice(0, maxLength || 800);
}

function previewForLog(value) {
  try {
    return previewText(JSON.stringify(value), 1600);
  } catch (error) {
    return previewText(value, 1600);
  }
}

async function safeDeleteCloudFile(fileID) {
  if (!fileID) {
    return;
  }

  try {
    await cloud.deleteFile({
      fileList: [fileID]
    });
  } catch (error) {
    console.warn("[hunyuanVisionIndex] 临时文件删除失败", error);
  }
}

# 图片索引小程序 Demo

这个仓库已经从原来的 Web demo 重建为微信原生小程序，当前目标是先验证两件事：

1. 能在小程序里手动给图片建立结构化索引。
2. 能通过索引筛选并找到对应图片。

## 当前能力

- `建索引` 页面：选图、填写备注、录入多个索引。
- `建索引` 页面支持一键 `AI 识图分类`，会优先补全 `菜系` 和 `食材类型`。
- `查找图片` 页面：按维度或具体路径筛选，查看结果并删除图片。
- 图片存储：当前保存到小程序本地文件系统，数据元信息存在本地缓存。
- 索引模板：默认索引 + 用户保存过的索引会一起参与推荐和查询。

## 目录结构

- `pages/builder`：录入图片与手动索引。
- `pages/search`：索引筛选与结果展示。
- `services/archive-service.js`：页面用到的主要业务入口，负责本地图片缓存、档案保存和 AI 结果合并。
- `services/ai-indexing.js`：小程序端 AI 识图接入，负责上传临时图片并调用云函数。
- `repositories`：本地仓储层，负责图片档案和索引模板的持久化。
- `utils/tag.js`：索引模型、标准化、检索 ID 和索引列表构建。
- `cloudfunctions/hunyuanVisionIndex`：微信云开发云函数，负责调用腾讯混元视觉模型。

## 后续切云端

优先替换这两层：

- `services/archive-service.js` 里的媒体存储适配函数
  让 `saveImage` 返回云端文件信息，同时保留本地预览路径或云端 URL。
- `repositories/archive-repository`
  如果档案元信息也要上云，可以把这里换成远端接口实现。

页面层不需要大改，因为现在调用的都是 `archive-service`。

## AI 识图部署

当前实现链路是：

`小程序 -> 微信云开发云函数 -> 腾讯混元视觉模型`

### 1. 在微信开发者工具里启用云开发

- 打开本项目后，确认当前小程序已经开通并绑定云开发环境。
- 本项目已经把 `project.config.json` 的 `cloudfunctionRoot` 指向 `cloudfunctions/`。
- 如果开发者工具里运行时仍提示没绑定环境，可以把 [constants/app-config.js](/home/cyansong/code/foodlibrary/constants/app-config.js:1) 里的 `cloudEnvId` 直接改成你的环境 ID，例如 `foodlibrary-1gxxxxxx`。

### 2. 部署云函数

- 右键 `cloudfunctions/hunyuanVisionIndex`。
- 执行“上传并部署：云端安装依赖”。

### 3. 配置云函数环境变量

在云函数 `hunyuanVisionIndex` 的环境变量里添加：

- `HUNYUAN_API_KEY`
  值填你自己的腾讯混元 API Key，例如控制台创建的 `sk-...`
- `HUNYUAN_VISION_MODEL`
  可选；默认值已经写成当前模型 `hunyuan-t1-vision-20250916`
- `HUNYUAN_TIMEOUT_MS`
  可选；默认 `15000`

### 3.1 云函数超时时间要手动调大

由于这条链路包含“云存储临时下载 + 调混元视觉模型”，默认 `3 秒` 的函数超时通常不够，建议在 `hunyuanVisionIndex` 的函数配置里把：

- `超时时间` 调到 `20` 或 `30` 秒
- `内存` 调到 `256MB` 或 `512MB`

### 4. 使用方式

- 在“上传档案”页选择图片
- 点击 `AI 识图分类`
- 云函数会把图片发给混元，优先从已有 `菜系`、`食材类型` 里选
- 如果没有合适路径，才会返回新的层级索引
- 返回结果会直接进入预览标签，保存档案后也会自动并入索引模板

### 5. 当前约束

- AI 目前只自动补 `菜系`、`食材类型`
- 图片仍然保存到小程序本地文件系统，AI 识图时上传到云端的只是临时文件，调用结束会删除

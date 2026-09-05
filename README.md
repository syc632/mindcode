# MindCode

Local-first knowledge graphs and spaced repetition for technical learning.

MindCode 将技术概念、本地笔记与复习卡片组织到同一张知识图谱中，帮助你梳理知识关系并持续复习。基于 Electron、React 和 Vite 构建，当前版本使用英文界面，支持中文资料输入。

## 功能

- **知识图谱**：拖拽节点、平移缩放、展开或收起层级，查看概念和关联关系。
- **概念库**：搜索、编辑和管理概念、来源笔记与复习卡片。
- **间隔重复**：使用 SM-2 安排复习，支持环形卡片浏览、代码示例和 Markdown 答案展示。
- **手动添加**：创建概念、设置父级并补充问答卡片。
- **AI 辅助提取**：通过 DashScope Qwen 从笔记或文档提取层级概念和多张卡片，附带来源摘要与引用证据，审核草稿后再写入图谱。
- **本地文档**：读取 Markdown、纯文本、常见代码文件、PDF 和 DOCX。
- **多图谱管理**：创建、切换、导入、导出和打开 `.mindcode.md` 图谱文件。
- **本地保存**：桌面端保存到用户数据目录，提供自动备份。

详细使用场景见[软件功能介绍](docs/mindcode-feature-overview.md)。

## 快速开始

需要 Node.js **22.12 或更高版本**，建议使用 Node.js 24 LTS，以及随附的 npm。桌面开发需要图形环境。

```bash
git clone https://github.com/syc632/mindcode.git
cd mindcode
npm ci
npm run dev
```

开发命令会同时启动 Vite 和 Electron。首次打开会加载示例知识图谱，无需 API Key 即可体验图谱、手动添加与复习。

1. 在 **Map** 中浏览示例或新建图谱。
2. 在 **Add** 中添加概念，或粘贴笔记生成草稿。
3. 检查生成的概念、卡片和关系，再接受草稿。
4. 在 **Review** 中完成到期卡片。

## AI 配置与数据流

当前提供方为 DashScope Qwen，默认模型由 [`src/shared/qwenExtractor.js`](src/shared/qwenExtractor.js) 中的 `defaultQwenModel` 指定（当前为 `qwen3.6-plus`）。

可在应用内保存自己的 DashScope API Key，也可通过启动环境传入 `DASHSCOPE_API_KEY`。应用内保存的 Key 优先于环境变量。不要把真实 Key 写入源码、提交记录或截图。

- 粘贴笔记在未配置 Key 时使用离线规则提取器；这不是大模型推理。
- 本地文档扫描后的 AI 提取需要 Key；请求失败会提示错误。
- 调用云端提取时，待处理文本与已有概念名称会发送到 DashScope，其使用受该服务的条款及计费规则约束。
- 提取出的解释和卡片默认使用英文，引用证据保留原文语言；生成内容需要人工核对。
- Key 以本机配置文件保存，不经过本项目自建服务器，也不会自动写入代码仓库。

## 数据存储

桌面端使用 Electron 的 `app.getPath("userData")` 目录保存：

| 文件或目录 | 用途 |
| --- | --- |
| `mindcode-data.json` | 主数据 |
| `maps/` | 内部图谱文件 |
| `backups/` | 自动及手动备份 |
| `ai-config.json` | AI 配置和 API Key |

打开的外部 `.mindcode.md` 文件会保存到其原路径。导出的图谱可能包含笔记和来源文本，分享前请检查内容。浏览器预览使用 `localStorage` 与离线提取器，不具备桌面端的本地文件操作能力。

## 构建与打包

```bash
npm run build        # 生成 dist/
npm start            # 启动已构建的 Electron 应用
npm run package:mac  # macOS Apple Silicon
npm run package:win  # Windows x64
```

macOS 产物位于 `release/MindCode-darwin-arm64/MindCode.app`；Windows 产物位于 `release/MindCode-win32-x64/`。Windows 建议在 Windows 环境中打包。

当前打包脚本生成未签名的应用目录，不包含安装器、Apple 公证或自动更新流程。`dist/`、`release/` 和 `node_modules/` 不纳入 Git；此仓库提供源码和构建步骤。

## 测试与项目结构

```bash
npm test
npm run lint
npm run build
```

| 路径 | 职责 |
| --- | --- |
| `electron/main.js` | 文件读写、图谱管理、文档扫描和 AI 请求 |
| `electron/preload.cjs` | 安全暴露 renderer 所需 IPC 接口 |
| `src/App.jsx` | 图谱、概念库、复习和添加视图 |
| `src/components/` | 导航、标识和 Markdown 展示组件 |
| `src/CircularGallery.jsx` | WebGL 复习卡片浏览 |
| `src/shared/` | 数据规范化、SM-2、提取、来源处理和单元测试 |
| `src/utils/` | 图谱与复习辅助逻辑 |

## 当前边界

项目处于早期阶段。复习答案采用忽略大小写和多余空白后的文本精确匹配，不进行语义评分。文档读取存在大小与文本长度限制，PDF 读取不包含扫描件 OCR。暂不提供云同步、多人协作或完整的中英文界面切换。

## 参与贡献与许可证

欢迎通过 [Issues](https://github.com/syc632/mindcode/issues) 反馈问题，或按[贡献指南](CONTRIBUTING.md)提交 Pull Request。

MindCode 使用 [MIT 许可证](LICENSE)。第三方依赖保留各自的许可证。

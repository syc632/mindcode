# MindCode

MindCode 是一个中文知识图谱与间隔重复桌面应用，面向程序员学习和复习技术概念。它可以手动添加概念，也可以从本地笔记、Markdown、PDF、Word 文档中提取概念，并把概念整理成图谱和 SM-2 复习卡片。

## 功能

- 知识图谱：用可拖拽的力导向图组织概念和依赖关系。
- 概念库：集中浏览、编辑和管理所有节点、关系和复习卡片。
- 间隔重复：基于 SM-2 算法安排复习节奏。
- 本地文档扫描：支持 `.md`、`.txt`、代码文件、`.pdf`、`.docx` 等内容读取。
- AI 概念提取：支持通过 DashScope Qwen API 从文档中提取编程概念；未配置 API Key 时使用离线 mock 提取器。
- 多图谱文件：支持 `.mindcode.md` 图谱文件的创建、导入、导出和管理。
- 本地优先：数据默认保存在 Electron `userData` 目录，并带有自动备份。

## 技术栈

- Electron
- React
- Vite
- Vitest
- ESLint
- DashScope Qwen API

## 开发运行

需要先安装 Node.js 和 npm。

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动 Vite 开发服务器和 Electron 应用。

## 构建

```bash
npm run build
```

构建产物会输出到 `dist/`。

## 启动构建后的应用

```bash
npm start
```

## 打包 macOS 应用

```bash
npm run package:mac
```

产物会输出到 `release/`。

## 打包 Windows 应用

```bash
npm run package:win
```

该命令会打包 Windows x64 版本，产物会输出到 `release/`。如果需要在 Windows 机器上打包，建议直接在 Windows 环境中运行该命令。

## 测试与检查

```bash
npm test
npm run lint
```

也可以单独运行某个测试文件：

```bash
npx vitest run src/shared/sm2.test.js
```

## AI 配置

MindCode 使用 DashScope Qwen 进行概念提取。可以在应用内保存 API Key，也可以通过环境变量提供：

```bash
DASHSCOPE_API_KEY=your_api_key npm run dev
```

API Key 会保存在本机 Electron `userData` 目录下的 `ai-config.json`，不会写入项目仓库。

## 数据存储

- 主数据：`mindcode-data.json`
- 自动备份：`backups/`
- AI 配置：`ai-config.json`
- 图谱文件：`maps/` 和 `.mindcode.md`

这些文件位于 Electron 的 `app.getPath("userData")` 目录。浏览器模式下会回退到 `localStorage`。

## 常用命令

```bash
npm run dev
npm run build
npm start
npm test
npm run lint
npm run package:mac
npm run package:win
```

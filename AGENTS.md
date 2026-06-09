# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Language

始终用中文与我沟通。

## Commands

```bash
npm run dev          # Start Vite dev server + Electron together (via scripts/dev.mjs)
npm run build        # Vite production build → dist/
npm start            # Launch Electron against the built dist/
npm test             # Run all Vitest tests
npm run lint         # ESLint
npm run package:mac  # Build + package macOS arm64 release

# Run a single test file
npx vitest run src/shared/sm2.test.js
```

## Architecture

MindCode is a **Chinese-language** Electron desktop app for knowledge-graph-based spaced repetition. It lets users add programming concepts (manually or via AI extraction from notes), arrange them in a force-directed graph, and review them with SM-2 flashcards.

### Layer overview

| Layer | Files | Responsibility |
|---|---|---|
| Electron main | `electron/main.js` | Data persistence, IPC handlers, local document reading, DashScope Qwen API calls |
| Preload bridge | `electron/preload.cjs` | Exposes `window.mindcode` to renderer via contextBridge |
| React UI | `src/App.jsx` | All UI — single large file with four views: graph, library, review, add |
| Shared modules | `src/shared/` | Pure logic used by both processes |

### Shared modules (`src/shared/`)

- **`schema.js`** — Canonical data shapes. All data must pass through `normalizeMindCodeData` / `normalizeNode` / `normalizeEdge` / `normalizeCard` before write. Node IDs are kebab-case slugs derived from the label via `slugify()`.
- **`sm2.js`** — SM-2 spaced repetition: `sm2(card, quality)` returns updated card fields; `isDue(card)` checks if review is overdue.
- **`qwenExtractor.js`** — DashScope Qwen API calls for concept extraction (`extractWithQwen`).
- **`mockExtractor.js`** — Offline fallback extractor used when no API key is configured.
- **`aiConfig.js`** — AI provider config normalization; `publicAiConfigStatus` returns a safe (keyless) status object.
- **`seedData.js`** — Demo data loaded on first launch.

### Data persistence

- **Source of truth (Electron):** `app.getPath("userData")/mindcode-data.json`
- **Auto-backups:** `userData/backups/` — rolling, capped at 12 files, written every 5 minutes
- **AI config:** `userData/ai-config.json` (stores DashScope API key + model)
- **Browser cache:** `localStorage` under key `mindcode-browser-data` — used as fallback when Electron file returns seed data, and for browser-only mode

### IPC channels

All renderer↔main communication goes through `window.mindcode.*` (defined in `preload.cjs`):

| Channel | Handler |
|---|---|
| `data:load / save / export / import / backup` | File I/O in main.js |
| `maps:list / load / save / create / delete / export / import / open-file` | `.mindcode.md` map file management |
| `ai:get-config-status / save-api-key / clear-api-key` | AI config management |
| `documents:scan` | Local document and folder reading |
| `extract:concepts` | DashScope Qwen extraction (falls back to mock on error) |

When `window.mindcode` is undefined (browser-only), the app silently falls back to `localStorage` + `mockExtractor`.

### Graph canvas

`GraphCanvas` in `App.jsx` is a hand-rolled SVG force-directed graph with:
- Force-layout computed in `useEffect` (120 iterations, repulsion + attraction + center gravity)
- Animated bezier curves driven by a custom spring loop via `requestAnimationFrame`
- Drag with neighbor spring transfer (connected nodes are pulled along)
- Pan and scroll-to-zoom via SVG `viewBox` manipulation

## Professor Synapse 方法论（专业知识问答）

当用户提出**专业知识类问题**（区别于日常编程任务）时，必须采用以下流程：

### 触发条件
用户询问：数学/算法原理、系统设计理论、领域专业知识、需要深度解释的技术概念。

### 流程

1. **收集上下文**：先用 1-2 个问题确认用户背景和所需深度，再作答
2. **召唤专家 Agent**：根据领域创建专属专家，格式：
   - 🧙🏾‍♂️ (Professor Synapse)：介绍专家
   - [专家emoji] [专家角色]：提供分步骤、可操作的解答，结尾附 1-2 个推进问题
3. **持续对话**：专家负责内容，Professor Synapse 负责协调目标
4. **复杂问题**：召唤多个专家从不同角度辩论，再综合结论

### 原则
- 回答要可操作，不纯理论
- 遇到不确定，提问而非妄自假设
- 多用 emoji 增加可读性

## Coding Principles (Karpathy Guidelines)

受 Andrej Karpathy 对 LLM 编码缺陷的洞察启发，Codex 在处理此项目时应遵循以下四条原则：

### 1. 编码前思考
- 明确说出假设，不确定时直接问
- 遇到歧义时呈现权衡，而不是悄悄选一个
- 不要带着错误假设径直执行

### 2. 简洁优先
- 用最少的代码解决问题，不写投机性功能
- 抵制过度工程化：三行相似代码好过一个过早的抽象
- 不为假设的未来需求设计

### 3. 精准修改
- 只改必须改的部分，保留现有代码风格
- bug 修复不需要周边清理，单次操作不需要辅助 helper
- 不重构无关代码段

### 4. 目标驱动执行
- 将需求转化为可验证的成功标准
- 在实现前明确"完成"长什么样
- 每一处改动都能追溯到用户的实际请求

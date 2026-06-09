# Claude Code 功能介绍

> 本文根据 Claude Code 官方文档整理，最后核对日期：2026-06-01。

## 1. Claude Code 是什么

Claude Code 是 Anthropic 提供的智能编码工具。它可以读取项目文件、理解代码结构、修改代码、执行命令，并结合测试和 Git 工作流完成软件开发任务。除了终端 CLI，它还提供桌面端、IDE、Web 和 CI 集成。

Claude Code 适合处理以下场景：

- 解释陌生代码库和追踪调用链
- 修复 Bug、实现功能和重构代码
- 运行测试、Lint、构建命令并分析报错
- 生成测试、整理文档和辅助代码审查
- 处理 Git 分支、提交、Pull Request 和 CI 问题

## 2. 核心能力

| 能力 | 说明 | 示例 |
| --- | --- | --- |
| 理解代码库 | 搜索文件、分析依赖关系、定位实现位置 | `解释 src/shared/sm2.js 的复习算法` |
| 编辑文件 | 按需求修改代码，并展示改动内容 | `为导入失败增加错误提示` |
| 执行命令 | 运行测试、构建、Lint 或项目脚本 | `运行 npm test，并修复失败的测试` |
| Git 工作流 | 查看改动、整理提交、辅助创建 PR | `总结当前 diff，生成提交说明` |
| 规划与权限控制 | 在执行前先制定方案，或限制可执行操作 | 使用 Plan Mode 先评审实现路径 |
| 会话管理 | 恢复历史会话、回退到检查点、拆分任务上下文 | `claude --continue`、`claude --resume` |

Claude Code 会根据任务调用工具，例如读取文件、搜索文本、编辑文件和执行 Shell 命令。涉及敏感操作时，应使用权限规则或在交互确认后再执行。

## 3. 项目级配置

### 3.1 `CLAUDE.md`

Claude Code 会读取 `CLAUDE.md` 作为项目说明。可以在其中记录：

- 常用命令，例如 `npm test` 和 `npm run build`
- 代码风格和目录职责
- 测试要求
- 禁止修改的文件
- 团队约定

本仓库已经有 `AGENTS.md`。如果希望 Claude Code 自动读取同一套规则，可以新增一个简短的 `CLAUDE.md`：

```md
@AGENTS.md
```

Claude Code 支持通过 `@路径` 导入其他说明文件，避免维护两份重复规则。

### 3.2 Settings 与权限

Claude Code 支持用户级、项目级和本地项目级设置。项目共享配置通常放在 `.claude/settings.json`，个人本地配置可放在 `.claude/settings.local.json`。

权限规则可以控制 Claude Code 允许、询问或禁止执行的工具操作。对删除文件、发布代码、访问敏感目录等高风险操作，应保持人工确认。

## 4. 扩展能力

| 扩展机制 | 用途 |
| --- | --- |
| Skills | 将特定任务的说明、脚本和资源封装为可复用能力 |
| Subagents | 为独立任务创建专门的子代理，隔离上下文并分工处理 |
| Agent Teams | 让多个 Claude Code 实例协作处理任务；该功能仍属于实验性能力 |
| MCP | 连接外部工具和数据源，例如数据库、内部服务或第三方平台 |
| Hooks | 在工具调用、会话开始、任务结束等事件发生时执行自动化命令 |
| Plugins | 打包并分发 Skills、Hooks、Subagents、MCP 服务等扩展 |

## 5. 使用入口与集成

Claude Code 可通过多种方式使用：

- **终端 CLI**：适合本地开发、脚本化操作和完整工作流。
- **桌面端**：支持图形界面、并行会话、Git diff 查看和本地开发体验。
- **IDE 集成**：支持 VS Code 系列编辑器和 JetBrains IDE。
- **Web**：可以在浏览器中运行任务，并通过 GitHub 仓库协作。
- **CI/CD**：可以接入 GitHub Actions 和 GitLab CI/CD，自动处理 Issue、PR 或代码审查任务。
- **Chrome 集成**：可以在浏览器中测试本地应用、查看控制台并辅助调试前端页面。

## 6. 快速开始

macOS、Linux 或 WSL 推荐使用官方原生安装器：

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

macOS 也可以使用 Homebrew：

```bash
brew install --cask claude-code
```

进入项目目录后启动：

```bash
cd /Users/Admin/Documents/mindcode
claude
```

常用命令：

```bash
claude                  # 启动交互会话
claude "解释这个项目"   # 直接提交任务
claude --continue       # 继续当前目录最近一次会话
claude --resume         # 选择历史会话继续
claude update           # 更新 Claude Code
claude doctor           # 检查安装状态
```

## 7. 在本仓库中的建议用法

开始任务时，先让 Claude Code 读取规则并明确成功标准：

```text
阅读 AGENTS.md，分析相关代码后再修改。只改完成需求所必需的文件。
完成后运行 npm test 和 npm run lint，并总结改动。
```

针对 MindCode，可以直接提出：

```text
解释 electron/main.js 到 electron/preload.cjs 再到 src/App.jsx 的 IPC 调用链。
```

```text
为 src/shared/sm2.js 增加边界条件测试，先说明覆盖范围，再运行对应测试文件。
```

```text
检查当前 Git diff，只指出可能导致功能回归的问题，不要修改文件。
```

## 8. 使用注意事项

- 在 Claude Code 修改文件后，用 `git diff` 检查实际改动。
- 涉及删除、覆盖、发布、数据库写入或生产环境操作时，保留人工确认。
- 不要将 API Key、Token 或账号凭据写入提示词、仓库文件或提交记录。
- 对较大的功能先使用 Plan Mode，确认边界后再实现。
- Claude Code 可以提高开发效率，但测试结果和最终代码仍需要人工审查。

## 9. 官方资料

- [Claude Code 概览](https://code.claude.com/docs/en/overview)
- [快速开始](https://code.claude.com/docs/en/quickstart)
- [安装与设置](https://code.claude.com/docs/en/setup)
- [常用工作流](https://code.claude.com/docs/en/common-workflows)
- [`CLAUDE.md` 与记忆机制](https://code.claude.com/docs/en/memory)
- [设置](https://code.claude.com/docs/en/settings)
- [权限](https://code.claude.com/docs/en/permissions)
- [Skills](https://code.claude.com/docs/en/skills)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [MCP](https://code.claude.com/docs/en/mcp)
- [Hooks](https://code.claude.com/docs/en/hooks-guide)
- [Plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web)
- [GitHub Actions](https://code.claude.com/docs/en/github-actions)
- [GitLab CI/CD](https://code.claude.com/docs/en/gitlab-ci-cd)
- [Chrome 集成](https://code.claude.com/docs/en/chrome)

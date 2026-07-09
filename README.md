# AI CLI Assistant

纯终端交互式 AI 编程助手 — 代码生成 / 重构 / Bug 排查

无任何可视化页面，纯命令行工具。依托 MCP 协议对接本地文件、Git、系统终端，通过 WebSocket 实现 AI 回复流式输出。

---

## 项目结构

```
ai-cli-assistant/
├── .ai-cli.json          # 项目配置文件（含 API Key，已加入 .gitignore）
├── package.json          # npm workspace 根配置
├── README.md
└── packages/
    ├── shared/           # 共享类型定义 (Message, StreamEvent, ModelConfig...)
    ├── tools/            # MCP 工具执行器（11 个工具：文件 / Git / Shell）
    ├── server/           # WebSocket 后端 + AI 模型适配器（Anthropic / OpenAI）
    └── cli/              # 交互式 CLI 前端（Commander + Inquirer + Chalk）
```

## 技术栈

| 模块 | 技术 |
|------|------|
| 语言 | TypeScript 5.7 |
| 包管理 | npm workspace |
| 打包 | tsup (CLI) / tsc (其他) |
| CLI 框架 | Commander + Inquirer + Chalk + Ora |
| 流式通信 | WebSocket (ws) |
| AI 对接 | Anthropic SDK / OpenAI SDK |
| 协议 | MCP (Model Context Protocol) |

## 快速开始

> **前置要求**：目标电脑需安装 [Node.js](https://nodejs.org)（推荐 LTS 版本）

### 第一步：安装

```bash
# 从 GitHub 克隆项目
git clone git@github.com:zhu-app/ai-cli-assistant.git
cd ai-cli-assistant

# 安装依赖并编译
npm install
npm run build

# 全局注册命令（可选，注册后在任何目录都能直接运行 ai-cli）
npm link
```

### 第二步：配置模型

任选一种方式配置你的 AI API：

**方式 A：创建配置文件（推荐）**

在项目目录创建 `.ai-cli.json`：

```json
{
  "provider": "custom",
  "model": "deepseek-chat",
  "apiKey": "你的API_KEY",
  "baseUrl": "https://api.deepseek.com/v1",
  "maxTokens": 4096,
  "temperature": 0.3
}
```

> **安全提醒**：`.ai-cli.json` 包含 API Key，请勿提交到 Git。已加入 `.gitignore`。

**方式 B：命令行传参**

```bash
ai-cli --provider custom --model glm-4-flash \
  --key "你的API_KEY" \
  --url "https://open.bigmodel.cn/api/paas/v4"
```

**方式 C：交互式引导**

直接运行 `ai-cli`，按提示逐步填写即可。

### 第三步：启动

```bash
# 配置好后直接运行（自动读取 .ai-cli.json）
ai-cli

# 或不注册全局命令，手动运行
node packages/cli/dist/index.js
```

## 使用方式

启动后进入交互式终端，输入自然语言与 AI 对话：

```
▸ 帮我创建一个 Express 服务器
▸ 把 src/index.ts 第 15 行的 foo 改成 bar
▸ 看看最近的 Git 提交记录
▸ 跑一下 npm test
```

AI 会自动调用 MCP 工具操作文件、执行命令，流式输出结果。

### 内置命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/quit` | 退出程序 |
| `/clear` | 清屏 |
| `/tools` | 列出可用 MCP 工具 |
| `/model` | 交互式切换模型（引导选提供商、填 Key） |
| `/config` | 查看当前模型配置 |
| `/reset` | 重置对话（清空历史） |
| `/` | 快速显示可用命令列表 |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-p, --provider <name>` | AI 提供商 (anthropic / openai / custom) | anthropic |
| `-m, --model <name>` | 模型名称 | claude-sonnet-4-6 |
| `-k, --key <key>` | API Key | - |
| `-u, --url <url>` | 自定义 Base URL | - |
| `-s, --server <url>` | 连接已有服务器 | - |
| `-c, --cwd <path>` | 工作目录 | 当前目录 |
| `--save` | 保存配置到全局 `~/.ai-cli.json` | - |
| `--save-project` | 保存配置到项目 `.ai-cli.json` | - |

## 配置说明

### 配置文件优先级（从高到低）

1. **命令行参数** — `ai-cli --provider custom --key xxx`
2. **项目配置** — 当前目录或上级目录的 `.ai-cli.json`
3. **全局配置** — `~/.ai-cli.json`
4. **交互式配置** — 以上都没有时，引导填写

### 支持的 AI 模型

| 模型 | provider | model | Base URL |
|------|----------|-------|----------|
| Anthropic Claude | `anthropic` | `claude-sonnet-4-6` | (默认) |
| OpenAI GPT-4o | `openai` | `gpt-4o` | (默认) |
| **DeepSeek** | `custom` | `deepseek-chat` | `https://api.deepseek.com/v1` |
| **智谱 GLM-4** | `custom` | `glm-4` | `https://open.bigmodel.cn/api/paas/v4` |
| **智谱 GLM-4 Flash** | `custom` | `glm-4-flash` | `https://open.bigmodel.cn/api/paas/v4` |
| **通义千问 Plus** | `custom` | `qwen-plus` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| **通义千问 Max** | `custom` | `qwen-max` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| **Moonshot** | `custom` | `moonshot-v1-8k` | `https://api.moonshot.cn/v1` |
| 任何 OpenAI 兼容接口 | `custom` | 自定义 | 自定义 |

## MCP 工具

AI 可通过以下 11 个工具操作你的本地环境：

| 类别 | 工具 | 说明 |
|------|------|------|
| **文件系统** | `read_file` | 读取文件内容 |
| | `write_file` | 写入/创建文件 |
| | `edit_file` | 精确替换文件中的文本 |
| | `list_dir` | 列出目录内容（支持递归） |
| | `glob_search` | Glob 模式搜索文件 |
| **Git** | `git_status` | 查看工作区状态 |
| | `git_log` | 查看提交历史 |
| | `git_diff` | 查看差异（支持暂存区） |
| | `git_commit` | 添加并提交更改 |
| **终端** | `shell_exec` | 执行 Shell 命令（含危险命令黑名单保护） |
| | `grep_search` | 正则搜索文件内容 |

## 架构原理

```
用户输入 (终端)
    ↓
CLI 前端 (Commander + Inquirer)
    ↓  WebSocket (127.0.0.1:3210，流式输出)
Server 后端
    ├──→ AI 模型适配器 (Anthropic / OpenAI / 自定义)
    └──→ MCP 工具执行器 → 文件操作 / Git / Shell 命令
```

- **CLI** 与 **Server** 通过 WebSocket 进程间通信，AI 回复逐字流式输出到终端
- Server 收到用户消息后调用 AI 模型，AI 决定是否需要调用 MCP 工具
- 工具执行结果回传给 AI，AI 继续生成最终回复
- 所有通信仅在本地 `127.0.0.1`，不涉及任何网页

## 开发

```bash
# 开发模式（监听文件变更）
npm run dev

# 清理构建产物
npm run clean
```

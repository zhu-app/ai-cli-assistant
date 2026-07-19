# AI CLI Assistant

纯终端交互式 AI 编程助手 — 代码生成 / 重构 / Bug 排查

无需网页、无需 IDE，在终端里直接和 AI 对话，自动操作文件、Git、Shell。

---

## 快速开始

### 1. 安装

```bash
git clone https://github.com/zhu-app/ai-cli-assistant.git
cd ai-cli-assistant
npm install
npm run build
```

### 2. 配置 API Key

在项目目录创建 `.ai-cli.json`（已加入 `.gitignore`，不会上传到 GitHub）：

```json
{
  "provider": "custom",
  "model": "glm-4-flash",
  "apiKey": "你的API_KEY",
  "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
  "maxTokens": 4096,
  "temperature": 0.3
}
```

**支持的模型：**

| 模型 | provider | model | Base URL |
|------|----------|-------|----------|
| Anthropic Claude | `anthropic` | `claude-sonnet-4-6` | （默认） |
| OpenAI GPT | `openai` | `gpt-4o` | （默认） |
| 智谱 GLM-4 Flash | `custom` | `glm-4-flash` | `https://open.bigmodel.cn/api/paas/v4` |
| DeepSeek | `custom` | `deepseek-chat` | `https://api.deepseek.com/v1` |
| 通义千问 | `custom` | `qwen-plus` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Moonshot | `custom` | `moonshot-v1-8k` | `https://api.moonshot.cn/v1` |
| 任意 OpenAI 兼容接口 | `custom` | 自定义 | 自定义 |

### 3. 启动

**Windows：** 双击 `start.bat`，自动检测依赖、编译、修复链接，直接进入对话。

**命令行：**
```bash
node packages/cli/dist/index.js
```

**全局注册（可选）：**
```bash
cd packages/cli && npm link && cd ../..
ai-cli   # 在任何目录都能运行
```

---

## 使用方式

启动后直接输入自然语言与 AI 对话：

```
▸ 帮我创建一个 Express 服务器
▸ 把 index.ts 第 15 行的 foo 改成 bar
▸ 看看最近的 Git 提交记录
▸ 跑一下 npm test
```

### 内置命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/quit` 或 `/exit` 或 `q` | 退出程序 |
| `/clear` | 清屏 |
| `/tools` | 列出可用 MCP 工具 |
| `/model` | 交互式切换模型 |
| `/config` | 查看当前模型配置 |
| `/reset` | 重置对话历史 |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-p, --provider <name>` | AI 提供商 | anthropic |
| `-m, --model <name>` | 模型名称 | claude-sonnet-4-6 |
| `-k, --key <key>` | API Key | - |
| `-u, --url <url>` | 自定义 Base URL | - |
| `-s, --server <url>` | 连接已有服务器 | - |
| `-c, --cwd <path>` | 工作目录 | 当前目录 |
| `--save` | 保存配置到全局 `~/.ai-cli.json` | - |
| `--save-project` | 保存配置到项目 `.ai-cli.json` | - |

---

## MCP 工具

AI 可通过以下 11 个工具操作本地环境：

| 类别 | 工具 | 说明 |
|------|------|------|
| **文件系统** | `read_file` | 读取文件内容 |
| | `write_file` | 写入/创建文件 |
| | `edit_file` | 精确替换文件文本 |
| | `list_dir` | 列出目录内容 |
| | `glob_search` | Glob 模式搜索文件 |
| **Git** | `git_status` | 查看工作区状态 |
| | `git_log` | 查看提交历史 |
| | `git_diff` | 查看差异 |
| | `git_commit` | 提交更改 |
| **终端** | `shell_exec` | 执行 Shell 命令（含危险命令黑名单） |
| | `grep_search` | 正则搜索文件内容 |

---

## 项目结构

```
ai-cli-assistant/
├── start.bat           # Windows 一键启动
├── fix-links.bat       # 链接修复工具（项目搬家后运行）
├── .npmrc              # npm 配置
├── .ai-cli.json        # 项目配置（含 API Key，不上传 Git）
└── packages/
    ├── shared/         # 共享类型定义
    ├── tools/          # MCP 工具执行器（11 个工具）
    ├── server/         # WebSocket 后端 + AI 模型适配器
    └── cli/            # 交互式 CLI 前端
```

## 技术栈

| 模块 | 技术 |
|------|------|
| 语言 | TypeScript 5.7 |
| 包管理 | npm workspace (Monorepo) |
| 打包 | tsup / tsc |
| CLI | Commander + Inquirer + Chalk |
| 通信 | WebSocket (ws) — 本地 127.0.0.1 |
| AI | Anthropic SDK / OpenAI SDK |

## 测试

```bash
# 运行全部测试（29 个）
npm test

# 单独测试某个包
npm run test -w @ai-cli/shared
npm run test -w @ai-cli/tools
npm run test -w @ai-cli/server
npm run test -w @ai-cli/cli
```

## npm Scripts

| 命令 | 说明 |
|------|------|
| `npm run build` | 编译所有包 |
| `npm run dev` | 开发模式（监听文件变更） |
| `npm test` | 运行全部测试 |
| `npm run fix-links` | 修复 workspace 链接 |
| `npm run rebuild` | 修复链接 + 重新构建 |
| `npm run clean` | 清理构建产物 |

## 注意事项

- **端口冲突**：默认端口 3210 被占用时，自动切换到下一个可用端口
- **项目搬家**：直接运行 `start.bat` 或 `fix-links.bat`，自动修复链接
- **API Key 安全**：`.ai-cli.json` 已加入 `.gitignore`，不会上传到 GitHub

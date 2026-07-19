#!/usr/bin/env node
// ============================================================
// AI CLI Assistant — 主入口
// 纯 CLI 交互式 AI 编程助手
// ============================================================

import { Command } from 'commander';
import { StreamEvent, ModelConfig } from '@ai-cli/shared';
import { AIServer } from '@ai-cli/server';
import { ServerClient, CLICommand } from './client';
import { readConfig, writeConfig, getConfigPath } from './config-store';

const chalk = require('chalk');
const inquirer = require('inquirer');

// Windows 下确保 stdout 使用 UTF-8 编码，防止中文乱码
if (process.platform === 'win32') {
  process.stdout.setDefaultEncoding?.('utf-8');
}

const VERSION = '1.0.0';

function getBanner(): string {
  return `
${chalk.bold.cyan('╔══════════════════════════════════════════╗')}
${chalk.bold.cyan('║')}${chalk.bold.white(`      AI CLI Assistant v${VERSION}              `)}${chalk.bold.cyan('║')}
${chalk.bold.cyan('║')}${chalk.dim('  纯终端交互式 AI 编程助手                   ')}${chalk.bold.cyan('║')}
${chalk.bold.cyan('║')}${chalk.dim('  代码生成 / 重构 / Bug 排查                  ')}${chalk.bold.cyan('║')}
${chalk.bold.cyan('║')}${chalk.dim('  MCP 协议 · 文件 · Git · 终端                ')}${chalk.bold.cyan('║')}
${chalk.bold.cyan('╚══════════════════════════════════════════╝')}
`;
}

async function promptConfig(): Promise<ModelConfig> {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: '选择 AI 模型提供商:',
      choices: [
        { name: 'Anthropic Claude (推荐)', value: 'anthropic' },
        { name: 'OpenAI', value: 'openai' },
        { name: '自定义 (OpenAI 兼容接口)', value: 'custom' },
      ],
    },
    {
      type: 'input',
      name: 'model',
      message: '模型名称:',
      default: 'claude-sonnet-4-6',
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'API Key:',
      mask: '*',
    },
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Base URL (可选，自定义提供商时填写):',
      default: '',
    },
  ]);

  return {
    provider: answers.provider as ModelConfig['provider'],
    model: answers.model,
    apiKey: answers.apiKey,
    baseUrl: answers.baseUrl || undefined,
    maxTokens: 4096,
    temperature: 0.3,
  };
}

const DEFAULT_PORT = 3210;

async function findAvailablePort(startPort: number, maxAttempts = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const tryPort = () => {
      const server = require('net').createServer();
      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && port < startPort + maxAttempts) {
          port++;
          server.close(() => tryPort());
        } else {
          reject(new Error(`端口 ${startPort}~${startPort + maxAttempts} 均被占用，请释放端口后重试`));
        }
      });
      server.once('listening', () => {
        server.close(() => resolve(port));
      });
      server.listen(port, '127.0.0.1');
    };
    tryPort();
  });
}

async function startServer(config: ModelConfig): Promise<string> {
  try {
    const port = await findAvailablePort(DEFAULT_PORT);
    const serverConfig = {
      model: config,
      port,
      host: '127.0.0.1',
    };

    const server = new AIServer(serverConfig, true);
    await server.ready;

    return `ws://127.0.0.1:${port}`;
  } catch (err) {
    console.error(chalk.red(`服务器启动失败: ${err instanceof Error ? err.message : String(err)}`));
    throw err;
  }
}

function formatToolResult(result: StreamEvent): string {
  if (result.type === 'tool_call') {
    const args = JSON.stringify(result.call.arguments, null, 2);
    return `\n${chalk.dim('  [工具调用] ')}${chalk.yellow(result.call.name)}${chalk.dim(`(${args})`)}`;
  }
  if (result.type === 'tool_result') {
    const r = result.result;
    const status = r.success ? chalk.green('✓ 成功') : chalk.red('✗ 失败');
    return `\n${chalk.dim('  [工具结果] ')}${status} ${chalk.dim(r.output.slice(0, 2000))}${r.output.length > 2000 ? chalk.dim(`... (截断，共 ${r.output.length} 字符)`) : ''}`;
  }
  return '';
}

async function doSwitchModel(client: ServerClient, currentConfig: ModelConfig): Promise<ModelConfig> {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: '选择 AI 模型提供商:',
      choices: [
        { name: 'Anthropic Claude', value: 'anthropic' },
        { name: 'OpenAI', value: 'openai' },
        { name: 'DeepSeek', value: 'custom' },
        { name: '智谱 GLM', value: 'custom' },
        { name: '通义千问', value: 'custom' },
        { name: 'Moonshot', value: 'custom' },
        { name: '其他 (OpenAI 兼容接口)', value: 'custom' },
      ],
      default: currentConfig.provider,
    },
    {
      type: 'input',
      name: 'model',
      message: '模型名称:',
      default: currentConfig.model,
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'API Key:',
      default: currentConfig.apiKey,
      mask: '*',
    },
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Base URL (仅自定义提供商需要):',
      default: currentConfig.baseUrl || '',
      when: (answers: any) => answers.provider === 'custom',
    },
  ]);

  // 自动填充常见模型的 Base URL
  const presetUrls: Record<string, string> = {
    'deepseek-chat': 'https://api.deepseek.com/v1',
    'deepseek-coder': 'https://api.deepseek.com/v1',
    'glm-4': 'https://open.bigmodel.cn/api/paas/v4',
    'glm-4-flash': 'https://open.bigmodel.cn/api/paas/v4',
    'qwen-plus': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'qwen-turbo': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'qwen-max': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'moonshot-v1-8k': 'https://api.moonshot.cn/v1',
    'moonshot-v1-32k': 'https://api.moonshot.cn/v1',
  };

  if (answers.provider === 'custom' && presetUrls[answers.model]) {
    answers.baseUrl = presetUrls[answers.model];
  }

  const newConfig: ModelConfig = {
    provider: answers.provider as ModelConfig['provider'],
    model: answers.model,
    apiKey: answers.apiKey,
    baseUrl: answers.baseUrl || undefined,
    maxTokens: currentConfig.maxTokens,
    temperature: currentConfig.temperature,
  };

  // 更新本地配置
  currentConfig = newConfig;

  // 通知服务器
  client.send({ type: 'set_config', config: newConfig });
  console.log(`\n${chalk.green('✓')} 模型已切换: ${chalk.cyan(newConfig.model)} (${newConfig.provider})`);
  if (newConfig.baseUrl) {
    console.log(chalk.dim(`  Base URL: ${newConfig.baseUrl}`));
  }
  return newConfig;
}

async function interactiveREPL(client: ServerClient, config: ModelConfig): Promise<void> {
  let currentConfig = { ...config };
  console.log(getBanner());
  console.log(chalk.dim('提示: 输入 /help 查看命令, /quit 退出\n'));

  // 初始化会话
  client.send({ type: 'init' });

  // 等待连接稳定
  await new Promise((r) => setTimeout(r, 500));

  const systemPrompt = `你是一个专业的 AI 编程助手，名为 "AI CLI Assistant"。

## 能力
- 代码生成：根据需求生成高质量代码
- 代码重构：优化现有代码结构和性能
- Bug 排查：分析错误并给出修复方案
- 技术解释：解释代码逻辑和技术概念

## 工具
你可以通过 MCP 工具操作：
- **文件系统**: read_file, write_file, edit_file, list_dir, glob_search
- **Git**: git_status, git_log, git_diff, git_commit
- **终端**: shell_exec, grep_search

## 规则
- 使用中文交流，代码注释也用中文
- 先分析问题再给出方案
- 需要修改代码时，先用 read_file 读取，再用 edit_file/write_file 修改
- 执行命令前说明意图
- 保持回答简洁专业`;

  // 发送系统提示（使用专门的 system 消息类型，不走对话历史计数）
  client.send({ type: 'system', content: systemPrompt });
  await new Promise((r) => setTimeout(r, 1000));

  // 交互式输入循环
  while (true) {
    try {
      const { input } = await inquirer.prompt({
        type: 'input',
        name: 'input',
        message: '',
      });

      if (!input || !input.trim()) continue;

      // 内置命令
      if (input === '/quit' || input === '/exit' || input === 'q') {
        console.log(chalk.dim('\n再见！'));
        break;
      }

      if (input === '/help') {
        console.log(`
${chalk.bold('可用命令:')}
  ${chalk.cyan('/help')}     显示此帮助
  ${chalk.cyan('/quit')}     退出程序
  ${chalk.cyan('/clear')}    清屏
  ${chalk.cyan('/tools')}    列出可用工具
  ${chalk.cyan('/model')}    切换模型（交互式配置）
  ${chalk.cyan('/config')}   查看当前配置
  ${chalk.cyan('/reset')}    重置对话（清空历史）
`);
        continue;
      }

      // 只输入 / 也显示命令列表
      if (input === '/') {
        console.log(`\n${chalk.dim('可用命令:')}`);
        console.log(`  ${chalk.cyan('/help')} ${chalk.cyan('/quit')} ${chalk.cyan('/clear')} ${chalk.cyan('/tools')} ${chalk.cyan('/model')} ${chalk.cyan('/config')} ${chalk.cyan('/reset')}\n`);
        continue;
      }

      if (input === '/clear') {
        process.stdout.write('\x1B[2J\x1B[0f');
        console.log(getBanner());
        continue;
      }

      if (input === '/model') {
        currentConfig = await doSwitchModel(client, currentConfig);
        continue;
      }

      if (input === '/config') {
        console.log(`
${chalk.bold('当前模型配置:')}
  提供商: ${chalk.cyan(currentConfig.provider)}
  模型:   ${chalk.cyan(currentConfig.model)}
  API Key: ${chalk.dim(currentConfig.apiKey ? '***' + currentConfig.apiKey.slice(-4) : '(未设置)')}
  Base URL: ${currentConfig.baseUrl || '(默认)'}
  Max Tokens: ${currentConfig.maxTokens || 4096}
  Temperature: ${currentConfig.temperature ?? 0.3}
`);
        continue;
      }

      if (input === '/reset') {
        client.send({ type: 'reset', conversationId: client.getConversationId() });
        console.log(`\n${chalk.green('✓')} 对话已重置\n`);
        continue;
      }

      if (input === '/tools') {
        client.send({ type: 'get_tools' });
        const toolListener = (event: StreamEvent) => {
          if ('tools' in event) {
            const tools = (event as any).tools;
            console.log(`\n${chalk.bold('可用工具:')}`);
            for (const t of tools) {
              console.log(`  ${chalk.yellow(t.name)} - ${chalk.dim(t.description)}`);
            }
            console.log();
            client.offMessage(toolListener);
          }
        };
        client.onMessage(toolListener);
        continue;
      }

      // 发送消息给 AI
      console.log(); // 空行
      client.send({ type: 'message', content: input });

      // 流式接收回复
      let assistantText = '';
      const donePromise = new Promise<boolean>((resolve) => {
        const listener = (event: StreamEvent) => {
          if (event.type === 'text') {
            process.stdout.write(event.content);
            assistantText += event.content;
          } else if (event.type === 'tool_call' || event.type === 'tool_result') {
            process.stdout.write(formatToolResult(event));
          } else if (event.type === 'done') {
            client.offMessage(listener);
            resolve(false);
          } else if (event.type === 'error') {
            console.log(`\n${chalk.red('错误: ')}${event.error}`);
            client.offMessage(listener);
            resolve(true);
          }
        };
        client.onMessage(listener);
      });

      const isError = await donePromise;

      if (!isError) {
        console.log(); // 回复结束空行
      }
      console.log(); // 分隔线
    } catch (err) {
      if (err && typeof err === 'object' && 'isTtyError' in err) {
        break;
      }
      console.error(chalk.red(`错误: ${err}`));
    }
  }
}

// ==================== 入口 ====================

async function main() {
  const program = new Command();

  program
    .name('ai-cli')
    .description('纯终端交互式 AI 编程助手')
    .version(VERSION)
    .option('-p, --provider <name>', 'AI 提供商 (anthropic|openai|custom)', 'anthropic')
    .option('-m, --model <name>', '模型名称', 'claude-sonnet-4-6')
    .option('-k, --key <key>', 'API Key')
    .option('-u, --url <url>', '自定义 Base URL')
    .option('-s, --server <url>', '连接已有服务器 (ws://...)')
    .option('-c, --cwd <path>', '工作目录', process.cwd())
    .option('--save', '保存配置到全局 ~/.ai-cli.json')
    .option('--save-project', '保存配置到项目 .ai-cli.json（推荐）');

  program.parse(process.argv);
  const opts = program.opts();

  // 切换到工作目录
  process.chdir(opts.cwd);

  let config: ModelConfig;

  // 优先级：命令行参数 > 项目配置 > 全局配置 > 交互式配置
  if (opts.key) {
    config = {
      provider: opts.provider as ModelConfig['provider'],
      model: opts.model,
      apiKey: opts.key,
      baseUrl: opts.url || undefined,
      maxTokens: 4096,
      temperature: 0.3,
    };
    if (opts.saveProject) {
      const p = writeConfig(config, true);
      console.log(chalk.green(`配置已保存到 ${p}`));
    } else if (opts.save) {
      const p = writeConfig(config, false);
      console.log(chalk.green(`配置已保存到 ${p}`));
    }
  } else {
    const saved = readConfig();
    if (saved && saved.apiKey) {
      config = saved;
    } else {
      config = await promptConfig();
      const p = writeConfig(config, false);
      console.log(chalk.dim(`配置已保存到 ${p}`));
    }
  }

  let serverUrl: string;
  if (opts.server) {
    serverUrl = opts.server;
    console.log(chalk.dim(`连接已有服务器: ${serverUrl}`));
  } else {
    try {
      serverUrl = await startServer(config);
    } catch {
      console.log(chalk.dim('使用 --server 参数可连接已有服务器'));
      process.exit(1);
    }
  }

  // 连接服务器
  const client = new ServerClient(true);

  try {
    await client.connect(serverUrl);
  } catch (err) {
    console.error(chalk.red(`连接失败: ${err instanceof Error ? err.message : String(err)}`));
    console.log(chalk.dim('提示: 请检查服务器是否在运行'));
    process.exit(1);
  }

  // 启动交互式 REPL
  await interactiveREPL(client, config);

  // 清理
  client.close();
  console.log(chalk.dim('\n再见！'));
}

main().catch((err) => {
  console.error(chalk.red('启动失败:'), err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    console.error(chalk.dim(err.stack.split('\n').slice(1).join('\n')));
  }
});

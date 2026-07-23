// ============================================================
// Server 启动入口
// ============================================================

import { AIServer } from './server';
import { ServerConfig } from '@ai-cli/shared';

const PROVIDER = process.env.AI_PROVIDER || 'anthropic';
const MODEL = process.env.AI_MODEL || 'claude-sonnet-4-6';
const API_KEY = process.env.AI_API_KEY || '';
const BASE_URL = process.env.AI_BASE_URL || '';
const PORT = parseInt(process.env.SERVER_PORT || '3210', 10);
const ALLOW_SHELL = process.env.AI_CLI_ALLOW_SHELL === '1';
const ALLOW_GIT_COMMIT = process.env.AI_CLI_ALLOW_GIT_COMMIT === '1';

const config: ServerConfig = {
  model: {
    provider: PROVIDER as any,
    model: MODEL,
    apiKey: API_KEY,
    baseUrl: BASE_URL || undefined,
    maxTokens: 4096,
    temperature: 0.3,
  },
  port: PORT,
  host: '127.0.0.1',
  cwd: process.cwd(),
  allowShell: ALLOW_SHELL,
  allowGitCommit: ALLOW_GIT_COMMIT,
};

console.log('[ai-cli-assistant] 启动服务器...');
console.log(`  模型: ${PROVIDER}/${MODEL}`);
console.log(`  端口: ${PORT}`);

const server = new AIServer(config);

process.on('SIGINT', () => {
  console.log('\n[ai-cli-assistant] 关闭服务器...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.stop();
  process.exit(0);
});

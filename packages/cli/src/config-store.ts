import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModelConfig } from '@ai-cli/shared';

const GLOBAL_CONFIG = path.join(os.homedir(), '.ai-cli.json');
const PROJECT_CONFIGS = ['.ai-cli.json', '.ai-cli.config.json'];

function isModelConfig(value: unknown): value is ModelConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  return ['anthropic', 'openai', 'custom'].includes(String(config.provider)) &&
    typeof config.model === 'string' &&
    config.model.trim().length > 0 &&
    typeof config.apiKey === 'string' &&
    config.apiKey.length > 0;
}

function parseConfig(filePath: string): ModelConfig | null {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(data);
    return isModelConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readConfig(
  startDir = process.cwd(),
  globalConfigPath = GLOBAL_CONFIG,
  projectBoundary?: string
): ModelConfig | null {
  // 优先级：项目配置 > 全局配置
  let dir = path.resolve(startDir);
  const boundary = projectBoundary ? path.resolve(projectBoundary) : null;
  if (boundary && path.relative(boundary, dir).startsWith('..')) {
    throw new Error('配置搜索起点必须位于搜索边界内');
  }
  while (dir) {
    for (const name of PROJECT_CONFIGS) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) {
        const config = parseConfig(p);
        if (config) return config;
      }
    }
    if (dir === boundary) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 全局配置
  if (fs.existsSync(globalConfigPath)) return parseConfig(globalConfigPath);
  return null;
}

function writeConfig(config: ModelConfig, toProject = false, globalConfigPath = GLOBAL_CONFIG): string {
  if (!isModelConfig(config)) throw new Error('配置不完整：provider、model 和 apiKey 为必填项');
  const filePath = toProject
    ? path.join(process.cwd(), '.ai-cli.json')
    : globalConfigPath;
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(tempPath, filePath);
    if (process.platform !== 'win32') fs.chmodSync(filePath, 0o600);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
  return filePath;
}

function getConfigPath(): string {
  return GLOBAL_CONFIG;
}

export { readConfig, writeConfig, getConfigPath };

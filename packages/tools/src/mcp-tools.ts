// ============================================================
// MCP 工具执行器 - 文件系统 / Git / Shell
// ============================================================

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { ToolCall, ToolResult } from '@ai-cli/shared';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_READ_LINES = 2000;
const MAX_LIST_ENTRIES = 2000;
const MAX_SEARCH_RESULTS = 500;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const MAX_COMMAND_TIMEOUT_MS = 30_000;

export interface MCPTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface MCPToolExecutorOptions {
  workspaceRoot?: string;
  allowShell?: boolean;
  allowGitCommit?: boolean;
}

function success(name: string, output: string): ToolResult {
  return { id: '', name, success: true, output };
}

function failure(name: string, error: unknown, output = ''): ToolResult {
  return {
    id: '',
    name,
    success: false,
    output,
    error: error instanceof Error ? error.message : String(error),
  };
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} 必须是 ${min} 到 ${max} 之间的整数`);
  }
  return parsed;
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveWorkspacePath(workspaceRoot: string, input: unknown): Promise<string> {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error('路径不能为空');
  }

  const root = await fs.realpath(workspaceRoot);
  const target = path.resolve(root, input);
  if (!isWithin(root, target)) {
    throw new Error(`路径超出工作区: ${input}`);
  }

  // Existing symlinks must not provide an escape from the workspace. For a path
  // that does not exist yet, resolve its nearest existing ancestor.
  let probe = target;
  while (true) {
    try {
      const realProbe = await fs.realpath(probe);
      const resolvedTarget = path.resolve(realProbe, path.relative(probe, target));
      if (!isWithin(root, resolvedTarget)) {
        throw new Error(`路径通过符号链接超出工作区: ${input}`);
      }
      return target;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
      const parent = path.dirname(probe);
      if (parent === probe) throw error;
      probe = parent;
    }
  }
}

function parseGitFiles(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return ['.'];
  if (typeof value !== 'string') throw new Error('files 必须是逗号分隔的路径列表');
  const files = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (files.length === 0 || files.length > 100) {
    throw new Error('files 必须包含 1 到 100 个路径');
  }
  return files;
}

const BLOCKED_COMMAND_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(^|[;&|]\s*)(sudo|su|doas)(\s|$)/i, label: '权限提升' },
  { pattern: /(^|[;&|]\s*)(rm\s+-[a-z]*r[a-z]*|del\s+\/[a-z]*[sq][a-z]*|rmdir\s+\/s|rd\s+\/s)(\s|$)/i, label: '递归删除' },
  { pattern: /(^|[;&|]\s*)(format|fdisk|mkfs|diskpart|shutdown|reboot|halt|poweroff)(\s|$)/i, label: '系统破坏命令' },
  { pattern: /(^|[;&|]\s*)(dd)(\s|$)/i, label: '原始磁盘写入' },
  { pattern: /(^|[;&|]\s*)(chmod\s+777|chown)(\s|$)/i, label: '危险权限修改' },
  { pattern: /\|\s*(sh|bash|zsh|cmd|powershell|pwsh)(\s|$)/i, label: '管道执行脚本' },
  { pattern: /(^|[;&|]\s*)(eval|source)(\s|$)/i, label: '动态脚本执行' },
];

export function isCommandBlocked(command: string): string | null {
  for (const item of BLOCKED_COMMAND_PATTERNS) {
    if (item.pattern.test(command)) return item.label;
  }
  return null;
}

const readFileTool: MCPTool = {
  name: 'read_file',
  description: '读取工作区内的 UTF-8 文本文件内容。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '工作区内的文件路径' },
      limit: { type: 'string', description: '最大读取行数（可选，最多 2000）' },
      offset: { type: 'string', description: '起始行号（可选）' },
    },
    required: ['file_path'],
  },
  handler: async (args) => {
    try {
      const filePath = String(args.file_path);
      const limit = boundedInteger(args.limit, MAX_READ_LINES, 1, MAX_READ_LINES, 'limit');
      const offset = boundedInteger(args.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) throw new Error('目标不是文件');
      if (stat.size > MAX_FILE_BYTES) throw new Error(`文件超过 ${MAX_FILE_BYTES} 字节读取上限`);
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      return success(
        'read_file',
        lines.slice(offset, offset + limit).map((line, index) => `${index + offset + 1}\t${line}`).join('\n')
      );
    } catch (error) {
      return failure('read_file', error);
    }
  },
};

const writeFileTool: MCPTool = {
  name: 'write_file',
  description: '以 UTF-8 写入工作区内的文件，已有文件会被覆盖。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '工作区内的文件路径' },
      content: { type: 'string', description: '要写入的内容' },
    },
    required: ['file_path', 'content'],
  },
  handler: async (args) => {
    try {
      if (typeof args.content !== 'string') throw new Error('content 必须是字符串');
      const filePath = String(args.file_path);
      const bytes = Buffer.byteLength(args.content, 'utf8');
      if (bytes > MAX_FILE_BYTES) throw new Error(`内容超过 ${MAX_FILE_BYTES} 字节写入上限`);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, args.content, 'utf8');
      return success('write_file', `文件已写入: ${filePath} (${bytes} 字节)`);
    } catch (error) {
      return failure('write_file', error);
    }
  },
};

const editFileTool: MCPTool = {
  name: 'edit_file',
  description: '精确替换工作区文件中的 UTF-8 文本。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '工作区内的文件路径' },
      old_string: { type: 'string', description: '要替换的原文本' },
      new_string: { type: 'string', description: '替换后的新文本' },
      replace_all: { type: 'string', description: '是否替换全部匹配 (true/false)' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  handler: async (args) => {
    try {
      if (typeof args.old_string !== 'string' || args.old_string.length === 0) {
        throw new Error('old_string 不能为空');
      }
      if (typeof args.new_string !== 'string') throw new Error('new_string 必须是字符串');
      const filePath = String(args.file_path);
      const stat = await fs.stat(filePath);
      if (stat.size > MAX_FILE_BYTES) throw new Error(`文件超过 ${MAX_FILE_BYTES} 字节编辑上限`);
      const content = await fs.readFile(filePath, 'utf8');
      if (!content.includes(args.old_string)) throw new Error('未找到要替换的文本，文件未修改');
      const updated = args.replace_all === 'true'
        ? content.split(args.old_string).join(args.new_string)
        : content.replace(args.old_string, args.new_string);
      if (Buffer.byteLength(updated, 'utf8') > MAX_FILE_BYTES) {
        throw new Error(`编辑结果超过 ${MAX_FILE_BYTES} 字节上限`);
      }
      await fs.writeFile(filePath, updated, 'utf8');
      return success('edit_file', `文件已编辑: ${filePath}`);
    } catch (error) {
      return failure('edit_file', error);
    }
  },
};

const listDirTool: MCPTool = {
  name: 'list_dir',
  description: '列出工作区内的目录内容。',
  parameters: {
    type: 'object',
    properties: {
      dir_path: { type: 'string', description: '工作区内的目录路径' },
      recursive: { type: 'string', description: '是否递归列出 (true/false)' },
    },
    required: ['dir_path'],
  },
  handler: async (args) => {
    try {
      const dirPath = String(args.dir_path);
      const recursive = args.recursive === 'true';
      const results: string[] = [];
      const visit = async (relative = ''): Promise<void> => {
        const entries = await fs.readdir(path.join(dirPath, relative), { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= MAX_LIST_ENTRIES) return;
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
          const item = relative ? path.join(relative, entry.name) : entry.name;
          results.push(entry.isDirectory() ? `${item}${path.sep}` : item);
          if (recursive && entry.isDirectory() && !entry.isSymbolicLink()) await visit(item);
        }
      };
      await visit();
      const suffix = results.length >= MAX_LIST_ENTRIES ? '\n...结果已截断' : '';
      return success('list_dir', results.join('\n') + suffix);
    } catch (error) {
      return failure('list_dir', error);
    }
  },
};

const globSearchTool: MCPTool = {
  name: 'glob_search',
  description: '在工作区内使用 glob 模式搜索文件。',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'glob 模式，如 **/*.ts' },
      path: { type: 'string', description: '工作区内的搜索根目录（可选）' },
    },
    required: ['pattern'],
  },
  handler: async (args) => {
    try {
      if (typeof args.pattern !== 'string' || args.pattern.length === 0 || args.pattern.length > 500) {
        throw new Error('pattern 必须是 1 到 500 个字符');
      }
      const { glob } = await import('glob');
      const files = await glob(args.pattern, {
        cwd: String(args.path),
        nodir: true,
        dot: false,
        ignore: ['**/.git/**', '**/node_modules/**', '**/dist/**'],
      });
      const limited = files.slice(0, MAX_LIST_ENTRIES);
      return success(
        'glob_search',
        limited.join('\n') + (files.length > limited.length ? '\n...结果已截断' : '')
      );
    } catch (error) {
      return failure('glob_search', error);
    }
  },
};

async function runGit(cwd: string, args: string[]): Promise<string> {
  const disabledHooksPath = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const safeArgs = [
    '--no-pager',
    '-c',
    `core.hooksPath=${disabledHooksPath}`,
    '-c',
    'core.fsmonitor=false',
    '-c',
    'commit.gpgSign=false',
    ...args,
  ];
  const { stdout, stderr } = await execFileAsync('git', safeArgs, {
    cwd,
    timeout: MAX_COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    encoding: 'utf8',
  });
  return String(stdout) + (stderr ? `\n[STDERR]\n${stderr}` : '');
}

const gitStatusTool: MCPTool = {
  name: 'git_status',
  description: '显示工作区内 Git 仓库的状态。',
  parameters: {
    type: 'object',
    properties: { cwd: { type: 'string', description: 'Git 仓库路径（可选）' } },
  },
  handler: async (args) => {
    try {
      return success('git_status', await runGit(String(args.cwd), ['status', '--porcelain']));
    } catch (error) {
      return failure('git_status', error);
    }
  },
};

const gitLogTool: MCPTool = {
  name: 'git_log',
  description: '查看工作区内 Git 仓库的提交历史。',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Git 仓库路径（可选）' },
      count: { type: 'string', description: '显示最近 N 条记录（1-100）' },
    },
  },
  handler: async (args) => {
    try {
      const count = boundedInteger(args.count, 20, 1, 100, 'count');
      const output = await runGit(String(args.cwd), [
        'log',
        '--oneline',
        `--max-count=${count}`,
        '--graph',
        '--decorate',
      ]);
      return success('git_log', output);
    } catch (error) {
      return failure('git_log', error);
    }
  },
};

const gitDiffTool: MCPTool = {
  name: 'git_diff',
  description: '显示工作区内 Git 仓库的差异。',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Git 仓库路径（可选）' },
      staged: { type: 'string', description: '是否显示暂存区差异 (true/false)' },
      file: { type: 'string', description: '工作区内的指定文件（可选）' },
    },
  },
  handler: async (args) => {
    try {
      const gitArgs = ['diff'];
      gitArgs.push('--no-ext-diff', '--no-textconv');
      if (args.staged === 'true') gitArgs.push('--cached');
      if (typeof args.file === 'string' && args.file) gitArgs.push('--', args.file);
      return success('git_diff', (await runGit(String(args.cwd), gitArgs)) || '无差异');
    } catch (error) {
      return failure('git_diff', error);
    }
  },
};

const gitCommitTool: MCPTool = {
  name: 'git_commit',
  description: '提交工作区内的 Git 更改（默认关闭，需显式启用）。',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: '提交信息' },
      cwd: { type: 'string', description: 'Git 仓库路径（可选）' },
      files: { type: 'string', description: '逗号分隔的工作区文件路径（可选，默认全部）' },
    },
    required: ['message'],
  },
  handler: async (args) => {
    try {
      if (typeof args.message !== 'string' || args.message.trim().length === 0 || args.message.length > 500) {
        throw new Error('提交信息必须是 1 到 500 个字符');
      }
      if (/[\0\r\n]/.test(args.message)) throw new Error('提交信息不能包含换行或空字节');
      const cwd = String(args.cwd);
      const files = args.files as string[];
      await runGit(cwd, ['add', '--', ...files]);
      return success('git_commit', await runGit(cwd, ['commit', '-m', args.message]));
    } catch (error) {
      return failure('git_commit', error);
    }
  },
};

const shellExecTool: MCPTool = {
  name: 'shell_exec',
  description: '以工作区为当前目录执行 Shell（默认关闭；启用后命令拥有当前用户权限）。',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的命令' },
      cwd: { type: 'string', description: '工作区内的工作目录（可选）' },
      timeout: { type: 'string', description: '超时毫秒数（100-30000）' },
    },
    required: ['command'],
  },
  handler: async (args) => {
    try {
      if (typeof args.command !== 'string' || args.command.trim().length === 0 || args.command.length > 8000) {
        throw new Error('command 必须是 1 到 8000 个字符');
      }
      const blocked = isCommandBlocked(args.command);
      if (blocked) throw new Error(`命令被安全策略拦截: ${blocked}`);
      const timeout = boundedInteger(args.timeout, MAX_COMMAND_TIMEOUT_MS, 100, MAX_COMMAND_TIMEOUT_MS, 'timeout');
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: String(args.cwd),
        timeout,
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        windowsHide: true,
        encoding: 'utf8',
      });
      const output = String(stdout) + (stderr ? `\n[STDERR]\n${stderr}` : '');
      return success('shell_exec', output || '命令执行成功（无输出）');
    } catch (error) {
      const details = error as { stdout?: string; stderr?: string };
      const output = String(details.stdout || '') + (details.stderr ? `\n[STDERR]\n${details.stderr}` : '');
      return failure('shell_exec', error, output);
    }
  },
};

const grepSearchTool: MCPTool = {
  name: 'grep_search',
  description: '在工作区 UTF-8 文本文件中搜索正则表达式。',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '正则表达式模式' },
      path: { type: 'string', description: '工作区内的文件或目录（可选）' },
      glob: { type: 'string', description: '文件过滤模式，如 *.ts（可选）' },
      case_sensitive: { type: 'string', description: '是否区分大小写 (true/false)' },
    },
    required: ['pattern'],
  },
  handler: async (args) => {
    try {
      if (typeof args.pattern !== 'string' || args.pattern.length === 0 || args.pattern.length > 500) {
        throw new Error('pattern 必须是 1 到 500 个字符');
      }
      const expression = new RegExp(args.pattern, args.case_sensitive === 'false' ? 'i' : '');
      const searchPath = String(args.path);
      const stat = await fs.stat(searchPath);
      let files: string[];
      if (stat.isFile()) {
        files = [searchPath];
      } else if (stat.isDirectory()) {
        const { glob } = await import('glob');
        files = await glob(args.glob ? `**/${String(args.glob)}` : '**/*', {
          cwd: searchPath,
          absolute: true,
          nodir: true,
          dot: false,
          ignore: ['**/.git/**', '**/node_modules/**', '**/dist/**'],
        });
      } else {
        throw new Error('搜索路径必须是文件或目录');
      }

      const matches: string[] = [];
      for (const file of files.slice(0, MAX_LIST_ENTRIES)) {
        if (matches.length >= MAX_SEARCH_RESULTS) break;
        const safeFile = await resolveWorkspacePath(String(args.__workspaceRoot), file);
        const fileStat = await fs.stat(safeFile);
        if (fileStat.size > MAX_FILE_BYTES) continue;
        const content = await fs.readFile(safeFile, 'utf8');
        if (content.includes('\0')) continue;
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
          if (expression.test(lines[index])) {
            matches.push(`${path.relative(searchPath, safeFile) || path.basename(safeFile)}:${index + 1}:${lines[index]}`);
            if (matches.length >= MAX_SEARCH_RESULTS) break;
          }
        }
      }
      return success(
        'grep_search',
        matches.length === 0
          ? '未找到匹配'
          : matches.join('\n') + (matches.length >= MAX_SEARCH_RESULTS ? '\n...结果已截断' : '')
      );
    } catch (error) {
      return failure('grep_search', error);
    }
  },
};

export const MCP_TOOLS: MCPTool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  globSearchTool,
  gitStatusTool,
  gitLogTool,
  gitDiffTool,
  gitCommitTool,
  shellExecTool,
  grepSearchTool,
];

const PATH_ARGUMENTS: Record<string, string[]> = {
  read_file: ['file_path'],
  write_file: ['file_path'],
  edit_file: ['file_path'],
  list_dir: ['dir_path'],
  glob_search: ['path'],
  grep_search: ['path'],
  git_status: ['cwd'],
  git_log: ['cwd'],
  git_diff: ['cwd'],
  git_commit: ['cwd'],
  shell_exec: ['cwd'],
};

export class MCPToolExecutor {
  private readonly tools = new Map<string, MCPTool>();
  private readonly workspaceRoot: string;
  private readonly allowShell: boolean;
  private readonly allowGitCommit: boolean;

  constructor(options: MCPToolExecutorOptions = {}, tools: MCPTool[] = MCP_TOOLS) {
    this.workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    this.allowShell = options.allowShell === true;
    this.allowGitCommit = options.allowGitCommit === true;
    for (const tool of tools) this.tools.set(tool.name, tool);
  }

  getToolDefinitions(): MCPTool[] {
    return Array.from(this.tools.values()).filter((tool) => {
      if (tool.name === 'shell_exec') return this.allowShell;
      if (tool.name === 'git_commit') return this.allowGitCommit;
      return true;
    });
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) return { id: call.id, name: call.name, success: false, output: '', error: `未知工具: ${call.name}` };
    if (call.name === 'shell_exec' && !this.allowShell) {
      return { id: call.id, name: call.name, success: false, output: '', error: 'Shell 工具默认关闭，请使用 --allow-shell 显式启用' };
    }
    if (call.name === 'git_commit' && !this.allowGitCommit) {
      return { id: call.id, name: call.name, success: false, output: '', error: 'Git 提交工具默认关闭，请使用 --allow-git-commit 显式启用' };
    }
    if (!call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) {
      return { id: call.id, name: call.name, success: false, output: '', error: '工具参数必须是对象' };
    }

    for (const required of tool.parameters.required || []) {
      if (!(required in call.arguments)) {
        return { id: call.id, name: call.name, success: false, output: '', error: `缺少必填参数: ${required}` };
      }
    }

    try {
      const args = { ...call.arguments };
      args.__workspaceRoot = this.workspaceRoot;
      for (const key of PATH_ARGUMENTS[call.name] || []) {
        const input = args[key] ?? this.workspaceRoot;
        args[key] = await resolveWorkspacePath(this.workspaceRoot, input);
      }

      if (call.name === 'git_diff' && typeof args.file === 'string' && args.file) {
        const absolute = await resolveWorkspacePath(String(args.cwd), args.file);
        args.file = path.relative(String(args.cwd), absolute);
      }
      if (call.name === 'git_commit') {
        const cwd = String(args.cwd);
        const files = parseGitFiles(args.files);
        args.files = await Promise.all(files.map(async (file) => {
          const absolute = await resolveWorkspacePath(cwd, file);
          return path.relative(cwd, absolute) || '.';
        }));
      }

      const result = await tool.handler(args);
      result.id = call.id;
      return result;
    } catch (error) {
      return failure(call.name, error);
    }
  }
}

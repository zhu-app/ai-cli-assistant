// ============================================================
// MCP 工具执行器 — 文件系统 / Git / Shell
// ============================================================

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolCall, ToolResult } from '@ai-cli/shared';

const execAsync = promisify(exec);

/** 检测当前是否是 Windows 平台 */
const isWindows = os.platform() === 'win32';

// --- 单个工具定义 ---
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

// ==================== 文件系统工具 ====================

const readFileTool: MCPTool = {
  name: 'read_file',
  description: '读取文件内容。支持文本文件和图片/PDF预览。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '文件的绝对路径' },
      limit: { type: 'string', description: '最大读取行数（可选）' },
      offset: { type: 'string', description: '起始行号（可选）' },
    },
    required: ['file_path'],
  },
  handler: async (args) => {
    const filePath = String(args.file_path);
    const limit = args.limit ? Number(args.limit) : 2000;
    const offset = args.offset ? Number(args.offset) : 0;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const sliced = lines.slice(offset, offset + limit);
      const result = sliced.map((l, i) => `${i + offset + 1}\t${l}`).join('\n');
      return {
        id: '',
        name: 'read_file',
        success: true,
        output: result,
      };
    } catch (err) {
      return {
        id: '',
        name: 'read_file',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

const writeFileTool: MCPTool = {
  name: 'write_file',
  description: '写入文件内容，如果文件存在则覆盖。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '文件的绝对路径' },
      content: { type: 'string', description: '要写入的内容' },
    },
    required: ['file_path', 'content'],
  },
  handler: async (args) => {
    const filePath = String(args.file_path);
    const content = String(args.content);

    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return {
        id: '',
        name: 'write_file',
        success: true,
        output: `文件已写入: ${filePath} (${content.length} 字节)`,
      };
    } catch (err) {
      return {
        id: '',
        name: 'write_file',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

const editFileTool: MCPTool = {
  name: 'edit_file',
  description: '精确替换文件中的文本。需要指定要替换的旧文本和新文本。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '文件的绝对路径' },
      old_string: { type: 'string', description: '要替换的原文本' },
      new_string: { type: 'string', description: '替换后的新文本' },
      replace_all: { type: 'string', description: '是否替换所有匹配项 (true/false)' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  handler: async (args) => {
    const filePath = String(args.file_path);
    const oldString = String(args.old_string);
    const newString = String(args.new_string);
    const replaceAll = args.replace_all === 'true';

    try {
      let content = await fs.readFile(filePath, 'utf-8');
      if (replaceAll) {
        content = content.split(oldString).join(newString);
      } else {
        content = content.replace(oldString, newString);
      }
      await fs.writeFile(filePath, content, 'utf-8');
      return {
        id: '',
        name: 'edit_file',
        success: true,
        output: `文件已编辑: ${filePath}`,
      };
    } catch (err) {
      return {
        id: '',
        name: 'edit_file',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

const listDirTool: MCPTool = {
  name: 'list_dir',
  description: '列出目录内容。',
  parameters: {
    type: 'object',
    properties: {
      dir_path: { type: 'string', description: '目录的绝对路径' },
      recursive: { type: 'string', description: '是否递归列出 (true/false)' },
    },
    required: ['dir_path'],
  },
  handler: async (args) => {
    const dirPath = String(args.dir_path);
    const recursive = args.recursive === 'true';

    try {
      async function listDir(dir: string, prefix = ''): Promise<string[]> {
        const entries = await fs.readdir(path.join(dir, prefix), { withFileTypes: true });
        const results: string[] = [];
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const relPath = prefix ? path.join(prefix, entry.name) : entry.name;
          results.push(entry.isDirectory() ? `${relPath}/` : relPath);
          if (entry.isDirectory() && recursive) {
            results.push(...(await listDir(dir, relPath)));
          }
        }
        return results;
      }
      const items = await listDir(dirPath);
      return {
        id: '',
        name: 'list_dir',
        success: true,
        output: items.join('\n'),
      };
    } catch (err) {
      return {
        id: '',
        name: 'list_dir',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

const globSearchTool: MCPTool = {
  name: 'glob_search',
  description: '使用 glob 模式搜索文件。',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'glob 模式，如 **/*.ts' },
      path: { type: 'string', description: '搜索的根目录（可选）' },
    },
    required: ['pattern'],
  },
  handler: async (args) => {
    const pattern = String(args.pattern);
    const basePath = args.path ? String(args.path) : process.cwd();

    try {
      const { glob } = await import('glob');
      const files = await glob(pattern, { cwd: basePath, ignore: ['**/node_modules/**', '**/dist/**'] });
      return {
        id: '',
        name: 'glob_search',
        success: true,
        output: files.join('\n'),
      };
    } catch (err) {
      return {
        id: '',
        name: 'glob_search',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// ==================== Git 工具 ====================

const gitStatusTool: MCPTool = {
  name: 'git_status',
  description: '显示 Git 工作区状态。',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Git 仓库路径（可选，默认当前目录）' },
    },
  },
  handler: async (args) => {
    const cwd = args.cwd ? String(args.cwd) : process.cwd();
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd });
      return { id: '', name: 'git_status', success: true, output: stdout };
    } catch (err) {
      return { id: '', name: 'git_status', success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const gitLogTool: MCPTool = {
  name: 'git_log',
  description: '查看 Git 提交历史。',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Git 仓库路径（可选）' },
      count: { type: 'string', description: '显示最近 N 条记录（可选）' },
    },
  },
  handler: async (args) => {
    const cwd = args.cwd ? String(args.cwd) : process.cwd();
    const count = args.count ? String(args.count) : '20';
    try {
      const { stdout } = await execAsync(
        `git log --oneline --max-count=${count} --graph --decorate`,
        { cwd }
      );
      return { id: '', name: 'git_log', success: true, output: stdout };
    } catch (err) {
      return { id: '', name: 'git_log', success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const gitDiffTool: MCPTool = {
  name: 'git_diff',
  description: '显示 Git 差异。',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Git 仓库路径（可选）' },
      staged: { type: 'string', description: '是否显示暂存区差异 (true/false)' },
      file: { type: 'string', description: '指定文件（可选）' },
    },
  },
  handler: async (args) => {
    const cwd = args.cwd ? String(args.cwd) : process.cwd();
    const staged = args.staged === 'true';
    const file = args.file ? String(args.file) : '';
    try {
      const cmd = staged ? `git diff --cached ${file}` : `git diff ${file}`;
      const { stdout } = await execAsync(cmd, { cwd });
      return { id: '', name: 'git_diff', success: true, output: stdout || '无差异' };
    } catch (err) {
      return { id: '', name: 'git_diff', success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const gitCommitTool: MCPTool = {
  name: 'git_commit',
  description: '提交更改到 Git 仓库。',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: '提交信息' },
      cwd: { type: 'string', description: 'Git 仓库路径（可选）' },
      files: { type: 'string', description: '要添加的文件列表，空格分隔（可选，默认全部）' },
    },
    required: ['message'],
  },
  handler: async (args) => {
    const message = String(args.message);
    const cwd = args.cwd ? String(args.cwd) : process.cwd();
    const files = args.files ? String(args.files) : '.';
    try {
      await execAsync(`git add ${files}`, { cwd });
      const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd });
      return { id: '', name: 'git_commit', success: true, output: stdout };
    } catch (err) {
      return { id: '', name: 'git_commit', success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ==================== Shell 工具 ====================

/** 危险命令黑名单，禁止 AI 自动执行 */
const BLOCKED_COMMANDS: string[] = [
  'rm -rf', 'rm -rf /', 'rm -rf ~', 'rm -rf .',
  'del /f /s /q', 'rd /s /q',
  'format', 'fdisk', 'mkfs',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'sudo', 'su ', 'chmod 777', 'chown',
  '> /dev/sda', '> /dev/sdb',
  'dd if=', ':(){ :|:& };:', 'forkbomb',
  'wget ', 'curl ', 'nc ', 'telnet ',
  'eval ', 'exec ', 'source ~',
  '>|', '| sh', '| bash', '| cmd',
];

function isCommandBlocked(command: string): string | null {
  const lower = command.toLowerCase().trim();
  // 检查是否以危险命令开头
  for (const blocked of BLOCKED_COMMANDS) {
    if (lower.startsWith(blocked)) {
      return blocked;
    }
  }
  return null;
}

const shellExecTool: MCPTool = {
  name: 'shell_exec',
  description: '在终端中执行 Shell 命令。仅限安全的命令。',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的命令' },
      cwd: { type: 'string', description: '工作目录（可选）' },
      timeout: { type: 'string', description: '超时毫秒数（可选，默认 30000）' },
    },
    required: ['command'],
  },
  handler: async (args) => {
    const command = String(args.command);
    const cwd = args.cwd ? String(args.cwd) : process.cwd();
    const timeout = args.timeout ? Number(args.timeout) : 30000;

    // 安全检查：禁止危险命令
    const blocked = isCommandBlocked(command);
    if (blocked) {
      return {
        id: '',
        name: 'shell_exec',
        success: false,
        output: '',
        error: `命令被安全策略拦截（匹配黑名单: "${blocked}"）。不允许执行危险命令。`,
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, { cwd, timeout, maxBuffer: 1024 * 1024 });
      const output = stdout + (stderr ? `\n[STDERR]\n${stderr}` : '');
      return { id: '', name: 'shell_exec', success: true, output: output || '命令执行成功（无输出）' };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const output = (e.stdout || '') + (e.stderr ? `\n[STDERR]\n${e.stderr}` : '');
      return {
        id: '',
        name: 'shell_exec',
        success: false,
        output: output,
        error: e.message || '命令执行失败',
      };
    }
  },
};

const grepSearchTool: MCPTool = {
  name: 'grep_search',
  description: '在文件中搜索正则表达式匹配的内容。',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '正则表达式模式' },
      path: { type: 'string', description: '搜索路径（文件或目录，可选）' },
      glob: { type: 'string', description: '文件过滤模式，如 *.ts（可选）' },
      case_sensitive: { type: 'string', description: '是否区分大小写 (true/false)' },
    },
    required: ['pattern'],
  },
  handler: async (args) => {
    const pattern = String(args.pattern);
    const searchPath = args.path ? String(args.path) : '.';
    const globPattern = args.glob ? String(args.glob) : '';
    const caseSensitive = args.case_sensitive !== 'false';

    try {
      let stdout: string;
      if (isWindows) {
        // Windows 使用 findstr
        const caseFlag = caseSensitive ? '' : '/I';
        const fileFilter = globPattern || '*';
        const cmd = `findstr /S /N ${caseFlag} /C:"${pattern.replace(/"/g, '""')}" "${searchPath}\\${fileFilter}" 2>nul`;
        const result = await execAsync(cmd, { timeout: 15000, maxBuffer: 1024 * 1024 });
        stdout = result.stdout || '未找到匹配';
        stdout = stdout.split('\n')
          .map(l => l.trim())
          .filter(l => l)
          .join('\n');
      } else {
        const flags = caseSensitive ? '' : '-i';
        const globArg = globPattern ? `--glob ${globPattern}` : '';
        const result = await execAsync(
          `grep ${flags} -r -n ${globArg} -- "${pattern}" "${searchPath}"`,
          { timeout: 15000, maxBuffer: 1024 * 1024 }
        );
        stdout = result.stdout || '未找到匹配';
      }
      return { id: '', name: 'grep_search', success: true, output: stdout };
    } catch (err: unknown) {
      const e = err as { stdout?: string; status?: number; message?: string };
      if (!isWindows && e.status === 1 && e.stdout) {
        return { id: '', name: 'grep_search', success: true, output: e.stdout };
      }
      if (isWindows && e.stdout) {
        return { id: '', name: 'grep_search', success: true, output: e.stdout };
      }
      return { id: '', name: 'grep_search', success: false, output: '', error: e.message || '搜索失败' };
    }
  },
};

// ==================== 工具注册表 ====================

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

// --- 工具执行器 ---
export class MCPToolExecutor {
  private tools = new Map<string, MCPTool>();

  constructor(tools: MCPTool[] = MCP_TOOLS) {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  getToolDefinitions(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        id: call.id,
        name: call.name,
        success: false,
        output: '',
        error: `未知工具: ${call.name}`,
      };
    }
    const result = await tool.handler(call.arguments);
    result.id = call.id;
    return result;
  }
}

import { describe, it, after } from 'node:test';
import { fileURLToPath } from 'url';
import assert from 'node:assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================
// 测试 MCP 工具注册表
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWindows = os.platform() === 'win32';

describe('MCPToolExecutor', () => {
  it('should have all 11 tools registered', async () => {
    const { MCP_TOOLS } = await import('../dist/mcp-tools.js');
    assert.strictEqual(MCP_TOOLS.length, 11);
    const names = MCP_TOOLS.map(t => t.name);
    assert.ok(names.includes('read_file'));
    assert.ok(names.includes('write_file'));
    assert.ok(names.includes('edit_file'));
    assert.ok(names.includes('list_dir'));
    assert.ok(names.includes('glob_search'));
    assert.ok(names.includes('git_status'));
    assert.ok(names.includes('git_log'));
    assert.ok(names.includes('git_diff'));
    assert.ok(names.includes('git_commit'));
    assert.ok(names.includes('shell_exec'));
    assert.ok(names.includes('grep_search'));
  });

  it('each tool should have valid handler, name, description, parameters', async () => {
    const { MCP_TOOLS } = await import('../dist/mcp-tools.js');
    for (const tool of MCP_TOOLS) {
      assert.ok(typeof tool.name === 'string' && tool.name.length > 0, `工具 ${tool.name} 缺少有效的 name`);
      assert.ok(typeof tool.description === 'string' && tool.description.length > 0, `工具 ${tool.name} 缺少有效的 description`);
      assert.ok(typeof tool.handler === 'function', `工具 ${tool.name} 缺少 handler`);
      assert.ok(tool.parameters && tool.parameters.type === 'object', `工具 ${tool.name} 缺少有效的 parameters`);
      assert.ok(tool.parameters.properties, `工具 ${tool.name} 缺少 properties`);
    }
  });

  it('read_file should have required file_path parameter', async () => {
    const { MCP_TOOLS } = await import('../dist/mcp-tools.js');
    const tool = MCP_TOOLS.find(t => t.name === 'read_file')!;
    assert.ok(tool.parameters.required?.includes('file_path'));
  });

  it('write_file should have required file_path and content parameters', async () => {
    const { MCP_TOOLS } = await import('../dist/mcp-tools.js');
    const tool = MCP_TOOLS.find(t => t.name === 'write_file')!;
    assert.ok(tool.parameters.required?.includes('file_path'));
    assert.ok(tool.parameters.required?.includes('content'));
  });

  it('shell_exec should have required command parameter', async () => {
    const { MCP_TOOLS } = await import('../dist/mcp-tools.js');
    const tool = MCP_TOOLS.find(t => t.name === 'shell_exec')!;
    assert.ok(tool.parameters.required?.includes('command'));
  });

  it('git_commit should have required message parameter', async () => {
    const { MCP_TOOLS } = await import('../dist/mcp-tools.js');
    const tool = MCP_TOOLS.find(t => t.name === 'git_commit')!;
    assert.ok(tool.parameters.required?.includes('message'));
  });
});

// ============================================================
// 测试 grep_search 的跨平台兼容性（Bug 8 修复验证）
// ============================================================

describe('grep_search cross-platform fix', () => {
  it('should detect Windows platform correctly', () => {
    // 验证 isWindows 变量与实际平台一致
    const expected = process.platform === 'win32';
    assert.strictEqual(isWindows, expected);
  });

  it('should handle platform-specific grep commands via MCPToolExecutor', async () => {
    const { MCPToolExecutor } = await import('../dist/mcp-tools.js');
    const executor = new MCPToolExecutor();

    // 使用 grep_search 在 package.json 中搜索 "name"
    const result = await executor.execute({
      id: 'test-1',
      name: 'grep_search',
      arguments: {
        pattern: 'name',
        path: path.resolve(__dirname, '..'),
        glob: 'package.json',
      },
    });

    // 无论 Windows/Unix 都应该能找到结果
    assert.ok(result.success, `grep_search 失败: ${result.error}`);
    assert.ok(result.output.includes('name'), `输出应包含 'name'，但得到: ${result.output}`);
  });
});

// ============================================================
// 测试 shell_exec 的安全黑名单（Bug 8 修复验证）
// ============================================================

describe('shell_exec security blacklist', () => {
  it('should block dangerous commands', async () => {
    const { MCPToolExecutor } = await import('../dist/mcp-tools.js');
    const executor = new MCPToolExecutor();

    const blockedCommands = [
      'rm -rf /',
      'sudo rm -rf',
      'shutdown -s',
      'format C:',
      'dd if=/dev/zero of=/dev/sda',
    ];

    for (const cmd of blockedCommands) {
      const result = await executor.execute({
        id: 'test-blocked',
        name: 'shell_exec',
        arguments: { command: cmd },
      });
      assert.ok(!result.success, `命令 "${cmd}" 应该被拦截但未被拦截`);
      assert.ok(result.error && result.error.includes('安全策略'), `拦截消息不明确: ${result.error}`);
    }
  });

  it('should allow safe commands', async () => {
    const { MCPToolExecutor } = await import('../dist/mcp-tools.js');
    const executor = new MCPToolExecutor();

    const safeCommands = [
      'node --version',
      'npm list',
    ];

    for (const cmd of safeCommands) {
      const result = await executor.execute({
        id: 'test-safe',
        name: 'shell_exec',
        arguments: { command: cmd, timeout: '5000' },
      });
      // 这些命令应该执行成功，但要注意 windows 上可能 npm 路径不同
      // 至少不应该被安全策略拦截
      if (!result.success) {
        assert.ok(!result.error?.includes('安全策略'), `安全命令 "${cmd}" 被拦截: ${result.error}`);
      }
    }
  });
});

// ============================================================
// 测试文件工具的基本功能
// ============================================================

describe('file tools basic functionality', () => {
  const testDir = path.resolve(__dirname, '../.test-temp');
  const testFile = path.join(testDir, 'test-file.txt');
  const testContent = 'Hello, World!\n第二行内容\n第三行';

  after(async () => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('write_file should create a file with content', async () => {
    const { MCPToolExecutor } = await import('../dist/mcp-tools.js');
    const executor = new MCPToolExecutor();

    const result = await executor.execute({
      id: 'test-write',
      name: 'write_file',
      arguments: { file_path: testFile, content: testContent },
    });

    assert.ok(result.success, `write_file 失败: ${result.error}`);
    assert.ok(result.output.includes('文件已写入'));
    assert.ok(fs.existsSync(testFile));
  });

  it('read_file should read file content', async () => {
    const { MCPToolExecutor } = await import('../dist/mcp-tools.js');
    const executor = new MCPToolExecutor();

    const result = await executor.execute({
      id: 'test-read',
      name: 'read_file',
      arguments: { file_path: testFile },
    });

    assert.ok(result.success, `read_file 失败: ${result.error}`);
    assert.ok(result.output.includes('Hello, World!'));
    assert.ok(result.output.includes('第二行内容'));
  });

  it('edit_file should replace text in file', async () => {
    const { MCPToolExecutor } = await import('../dist/mcp-tools.js');
    const executor = new MCPToolExecutor();

    const result = await executor.execute({
      id: 'test-edit',
      name: 'edit_file',
      arguments: {
        file_path: testFile,
        old_string: 'World',
        new_string: 'AI CLI Assistant',
      },
    });

    assert.ok(result.success, `edit_file 失败: ${result.error}`);

    // 验证文件内容已更新
    const content = fs.readFileSync(testFile, 'utf-8');
    assert.ok(content.includes('AI CLI Assistant'));
    assert.ok(!content.includes('World'));
  });

  it('edit_file with replace_all should replace all occurrences', async () => {
    const { MCPToolExecutor } = await import('../dist/mcp-tools.js');
    const executor = new MCPToolExecutor();

    // 先写入包含多个匹配的文件
    const multiMatchContent = 'foo bar\nhello foo\nfoo world';
    fs.writeFileSync(testFile, multiMatchContent, 'utf-8');

    const result = await executor.execute({
      id: 'test-edit-all',
      name: 'edit_file',
      arguments: {
        file_path: testFile,
        old_string: 'foo',
        new_string: 'baz',
        replace_all: 'true',
      },
    });

    assert.ok(result.success, `edit_file replace_all 失败: ${result.error}`);

    const content = fs.readFileSync(testFile, 'utf-8');
    assert.strictEqual(content, 'baz bar\nhello baz\nbaz world');
  });

  it('list_dir should list directory contents', async () => {
    const { MCPToolExecutor } = await import('../dist/mcp-tools.js');
    const executor = new MCPToolExecutor();

    const result = await executor.execute({
      id: 'test-list',
      name: 'list_dir',
      arguments: { dir_path: testDir },
    });

    assert.ok(result.success, `list_dir 失败: ${result.error}`);
    assert.ok(result.output.includes('test-file.txt'));
  });
});

// ============================================================
// 测试 MCPToolExecutor.execute 的错误处理
// ============================================================

describe('MCPToolExecutor error handling', () => {
  it('should return error for unknown tool', async () => {
    const { MCPToolExecutor } = await import('../dist/mcp-tools.js');
    const executor = new MCPToolExecutor();

    const result = await executor.execute({
      id: 'test-unknown',
      name: 'non_existent_tool',
      arguments: {},
    });

    assert.ok(!result.success);
    assert.ok(result.error?.includes('未知工具'));
  });
});

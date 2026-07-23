'use strict';

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MCPToolExecutor, MCP_TOOLS, isCommandBlocked } = require('../dist/mcp-tools.js');

describe('MCPToolExecutor security boundary', () => {
  let tempParent;
  let workspace;
  let outside;
  let executor;

  before(() => {
    tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cli-tools-'));
    workspace = path.join(tempParent, 'workspace');
    outside = path.join(tempParent, 'outside');
    fs.mkdirSync(workspace);
    fs.mkdirSync(outside);
    executor = new MCPToolExecutor({ workspaceRoot: workspace });
  });

  after(() => {
    fs.rmSync(tempParent, { recursive: true, force: true });
  });

  it('registers all tools but hides opt-in tools by default', () => {
    assert.equal(MCP_TOOLS.length, 11);
    const visible = executor.getToolDefinitions().map((tool) => tool.name);
    assert.equal(visible.length, 9);
    assert.ok(!visible.includes('shell_exec'));
    assert.ok(!visible.includes('git_commit'));
  });

  it('allows UTF-8 file operations inside the workspace', async () => {
    const file = path.join(workspace, 'src', '示例.txt');
    const written = await executor.execute({
      id: 'write',
      name: 'write_file',
      arguments: { file_path: file, content: '第一行\nhello' },
    });
    assert.equal(written.success, true, written.error);

    const read = await executor.execute({
      id: 'read',
      name: 'read_file',
      arguments: { file_path: file },
    });
    assert.equal(read.success, true, read.error);
    assert.match(read.output, /第一行/);

    const edited = await executor.execute({
      id: 'edit',
      name: 'edit_file',
      arguments: { file_path: file, old_string: 'hello', new_string: '你好' },
    });
    assert.equal(edited.success, true, edited.error);
    assert.equal(fs.readFileSync(file, 'utf8'), '第一行\n你好');
  });

  it('rejects traversal and absolute paths outside the workspace', async () => {
    for (const filePath of [path.join(outside, 'secret.txt'), path.join(workspace, '..', 'escape.txt')]) {
      const result = await executor.execute({
        id: 'escape',
        name: 'write_file',
        arguments: { file_path: filePath, content: 'nope' },
      });
      assert.equal(result.success, false);
      assert.match(result.error, /超出工作区/);
    }
    assert.equal(fs.existsSync(path.join(outside, 'secret.txt')), false);
  });

  it('rejects symlink escapes when the platform permits creating one', async (t) => {
    const link = path.join(workspace, 'outside-link');
    try {
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.skip(`当前环境不能创建测试符号链接: ${error.code || error.message}`);
      return;
    }
    const result = await executor.execute({
      id: 'symlink',
      name: 'write_file',
      arguments: { file_path: path.join(link, 'escaped.txt'), content: 'nope' },
    });
    assert.equal(result.success, false);
    assert.match(result.error, /符号链接超出工作区/);
  });

  it('does not modify a file when edit text is absent', async () => {
    const file = path.join(workspace, 'unchanged.txt');
    fs.writeFileSync(file, 'original', 'utf8');
    const result = await executor.execute({
      id: 'edit-missing',
      name: 'edit_file',
      arguments: { file_path: file, old_string: 'missing', new_string: 'new' },
    });
    assert.equal(result.success, false);
    assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  });

  it('searches in-process without shell interpolation', async () => {
    const file = path.join(workspace, 'search.txt');
    fs.writeFileSync(file, 'hello\n你好\nnothing', 'utf8');
    const result = await executor.execute({
      id: 'grep',
      name: 'grep_search',
      arguments: { path: workspace, glob: '*.txt', pattern: 'hello|你好' },
    });
    assert.equal(result.success, true, result.error);
    assert.match(result.output, /search\.txt:1:hello/);
    assert.match(result.output, /search\.txt:2:你好/);
  });

  it('keeps shell disabled unless explicitly enabled', async () => {
    const result = await executor.execute({
      id: 'shell',
      name: 'shell_exec',
      arguments: { command: 'node --version' },
    });
    assert.equal(result.success, false);
    assert.match(result.error, /默认关闭/);
  });

  it('blocks dangerous commands even after a command separator', () => {
    assert.equal(isCommandBlocked('echo ok && rm -rf ./data'), '递归删除');
    assert.equal(isCommandBlocked('echo ok | bash'), '管道执行脚本');
    assert.equal(isCommandBlocked('node --version'), null);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert';

// 测试工具注册表完整性
describe('MCPToolExecutor', () => {
  it('should have all 11 tools registered', async () => {
    const { MCP_TOOLS } = await import('../src/mcp-tools.js');
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
});

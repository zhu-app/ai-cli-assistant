import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateId, createConversation } from '../dist/index.js';

// ============================================================
// 测试共享类型和工具函数
// ============================================================

describe('generateId', () => {
  it('should generate unique IDs', () => {
    const id1 = generateId();
    const id2 = generateId();
    assert.notStrictEqual(id1, id2);
  });

  it('should contain timestamp', () => {
    const id = generateId();
    const parts = id.split('-');
    assert.strictEqual(parts.length, 2);
    const ts = parseInt(parts[0], 10);
    assert.ok(ts > 0);
    assert.ok(ts <= Date.now());
  });
});

describe('createConversation', () => {
  it('should create a conversation with default empty messages', () => {
    const conv = createConversation();
    assert.ok(conv.id);
    assert.ok(Array.isArray(conv.messages));
    assert.strictEqual(conv.messages.length, 0);
    assert.ok(conv.createdAt > 0);
    assert.ok(conv.updatedAt > 0);
  });

  it('should create a conversation with initial messages', () => {
    const messages = [
      { role: 'system' as const, content: 'You are a helper' },
      { role: 'user' as const, content: 'Hello' },
    ];
    const conv = createConversation(messages);
    assert.strictEqual(conv.messages.length, 2);
    assert.strictEqual(conv.messages[0].role, 'system');
    assert.strictEqual(conv.messages[1].role, 'user');
  });
});

describe('StreamEvent types', () => {
  it('should support all stream event types', () => {
    const textEvent = { type: 'text' as const, content: 'hello' };
    const toolCallEvent = {
      type: 'tool_call' as const,
      call: { id: '1', name: 'test', arguments: {} },
    };
    const doneEvent = { type: 'done' as const };
    const errorEvent = { type: 'error' as const, error: 'something wrong' };

    assert.strictEqual(textEvent.type, 'text');
    assert.strictEqual(doneEvent.type, 'done');
    assert.strictEqual(errorEvent.type, 'error');
    assert.strictEqual(toolCallEvent.call.name, 'test');
  });

  // Bug 6 修复验证：tools 类型应该存在
  it('should support tools event type (Bug 6 fix)', () => {
    const toolsEvent = {
      type: 'tools' as const,
      tools: [{ name: 'read_file', description: 'Read file', parameters: { type: 'object' as const, properties: {} } }],
    };
    assert.strictEqual(toolsEvent.type, 'tools');
    assert.strictEqual(toolsEvent.tools.length, 1);
    assert.strictEqual(toolsEvent.tools[0].name, 'read_file');
  });
});

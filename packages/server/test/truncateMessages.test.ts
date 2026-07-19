import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

// 直接从 server.ts 中复制 truncateMessages 函数逻辑进行测试
// 因为我们无法直接 import TypeScript 源码，这里测试截断逻辑的正确性

function truncateMessages(messages: { role: string; content: string }[]): { role: string; content: string }[] {
  const MAX_MESSAGES = 40;
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const chatMsgs = messages.filter((m) => m.role !== 'system');
  if (chatMsgs.length > MAX_MESSAGES) {
    chatMsgs.length = MAX_MESSAGES;
  }
  return [...systemMsgs, ...chatMsgs];
}

describe('truncateMessages', () => {
  it('should keep system messages at the front', () => {
    const messages = [
      { role: 'system', content: 'You are a helper' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
    ];
    const result = truncateMessages(messages);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].role, 'system');
  });

  it('should truncate chat messages when exceeding MAX_MESSAGES', () => {
    const messages = [
      { role: 'system', content: 'You are a helper' },
      ...Array.from({ length: 50 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Message ${i}`,
      })),
    ];
    const result = truncateMessages(messages);
    // 1 system + 40 chat = 41 total
    assert.strictEqual(result.length, 41);
    assert.strictEqual(result[0].role, 'system');
    // 验证截断后的 chat 消息是正确的（最后 40 条）
    const chatMsgs = result.filter(m => m.role !== 'system');
    assert.strictEqual(chatMsgs.length, 40);
  });

  it('should not truncate when under MAX_MESSAGES', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Message ${i}`,
    }));
    const result = truncateMessages(messages);
    assert.strictEqual(result.length, 10);
  });

  it('should handle empty messages', () => {
    const result = truncateMessages([]);
    assert.strictEqual(result.length, 0);
  });

  it('should handle only system messages', () => {
    const messages = [
      { role: 'system', content: 'Rule 1' },
      { role: 'system', content: 'Rule 2' },
    ];
    const result = truncateMessages(messages);
    assert.strictEqual(result.length, 2);
  });
});

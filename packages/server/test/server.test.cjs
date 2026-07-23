'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  AIServer,
  truncateMessages,
  validateModelConfigPatch,
} = require('../dist/server.js');

describe('server input boundaries', () => {
  it('keeps system prompts and the most recent 40 chat messages', () => {
    const messages = [
      { role: 'system', content: 'rules' },
      ...Array.from({ length: 50 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        content: `message-${index}`,
      })),
    ];
    const result = truncateMessages(messages);
    assert.equal(result.length, 41);
    assert.equal(result[0].content, 'rules');
    assert.equal(result[1].content, 'message-10');
    assert.equal(result[40].content, 'message-49');
  });

  it('accepts a bounded model config patch', () => {
    assert.deepEqual(
      validateModelConfigPatch({
        provider: 'custom',
        model: 'test-model',
        baseUrl: 'https://example.com/v1/',
        maxTokens: 4096,
        temperature: 0.3,
      }),
      {
        provider: 'custom',
        model: 'test-model',
        baseUrl: 'https://example.com/v1',
        maxTokens: 4096,
        temperature: 0.3,
      }
    );
  });

  it('rejects unknown fields, credentials in URLs and invalid numeric ranges', () => {
    assert.throws(() => validateModelConfigPatch({ debug: true }), /不支持/);
    assert.throws(
      () => validateModelConfigPatch({ baseUrl: 'https://user:pass@example.com' }),
      /用户名或密码/
    );
    assert.throws(() => validateModelConfigPatch({ temperature: 99 }), /0 到 2/);
  });

  it('refuses non-loopback listeners because the protocol has no authentication', () => {
    assert.throws(
      () => new AIServer({
        host: '0.0.0.0',
        model: { provider: 'openai', model: 'test', apiKey: 'test' },
      }, true),
      /只允许监听本机回环地址/
    );
  });
});

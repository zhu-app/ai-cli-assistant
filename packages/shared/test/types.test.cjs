'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { generateId, createConversation } = require('../dist/index.js');

describe('shared helpers', () => {
  it('generates unique IDs', () => {
    assert.notEqual(generateId(), generateId());
  });

  it('creates an isolated conversation', () => {
    const source = [{ role: 'user', content: '你好' }];
    const conversation = createConversation(source);
    assert.equal(conversation.messages.length, 1);
    assert.equal(conversation.messages[0].content, '你好');
    assert.ok(conversation.createdAt > 0);
  });
});

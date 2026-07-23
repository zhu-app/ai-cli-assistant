'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { ServerClient } = require('../dist/client.js');

describe('ServerClient', () => {
  let wss;
  let client;

  afterEach(() => {
    client?.close();
    wss?.close();
  });

  it('attaches the initialized conversation ID to system messages', async () => {
    let receivedSystem;
    wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise((resolve) => wss.once('listening', resolve));
    wss.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'init') {
          socket.send(JSON.stringify({ type: 'init_ok', conversationId: 'conversation-1' }));
        } else if (message.type === 'system') {
          receivedSystem = message;
          socket.send(JSON.stringify({ type: 'system_ok' }));
        }
      });
    });

    const address = wss.address();
    client = new ServerClient(true);
    await client.connect(`ws://127.0.0.1:${address.port}`);

    await new Promise((resolve) => {
      const listener = (event) => {
        if (event.type !== 'init_ok') return;
        client.offMessage(listener);
        resolve();
      };
      client.onMessage(listener);
      client.send({ type: 'init' });
    });

    await new Promise((resolve) => {
      const listener = (event) => {
        if (event.type !== 'system_ok') return;
        client.offMessage(listener);
        resolve();
      };
      client.onMessage(listener);
      client.send({ type: 'system', content: 'UTF-8 系统提示' });
    });

    assert.equal(receivedSystem.conversationId, 'conversation-1');
    assert.equal(receivedSystem.content, 'UTF-8 系统提示');
  });
});

'use strict';

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readConfig, writeConfig } = require('../dist/config-store.js');

describe('config store', () => {
  let tempDir;
  let globalConfig;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cli-config-'));
    globalConfig = path.join(tempDir, 'home', '.ai-cli.json');
  });

  after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it('writes valid UTF-8 atomically and reads it back', () => {
    const config = {
      provider: 'custom',
      model: '测试模型',
      apiKey: 'test-key',
      maxTokens: 4096,
    };
    assert.equal(writeConfig(config, false, globalConfig), globalConfig);
    assert.deepEqual(readConfig(path.join(tempDir, 'project'), globalConfig, tempDir), config);
    assert.equal(fs.readFileSync(globalConfig, 'utf8').includes('测试模型'), true);

    const updated = { ...config, model: 'updated' };
    writeConfig(updated, false, globalConfig);
    assert.equal(readConfig(tempDir, globalConfig, tempDir).model, 'updated');
    assert.equal(
      fs.readdirSync(path.dirname(globalConfig)).some((name) => name.endsWith('.tmp')),
      false
    );
  });

  it('ignores malformed and structurally invalid config files', () => {
    const project = path.join(tempDir, 'invalid-project');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, '.ai-cli.json'), '{"provider":"custom"}', 'utf8');
    fs.writeFileSync(globalConfig, 'not-json', 'utf8');
    assert.equal(readConfig(project, globalConfig, tempDir), null);
  });

  it('rejects incomplete config before writing', () => {
    assert.throws(
      () => writeConfig({ provider: 'openai', model: 'x' }, false, globalConfig),
      /配置不完整/
    );
  });
});

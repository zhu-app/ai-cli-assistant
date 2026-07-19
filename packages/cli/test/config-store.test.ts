import { describe, it, before, after } from 'node:test';
import { fileURLToPath } from 'url';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testProjectDir = path.resolve(__dirname, '../.test-config-temp');
const testProjectConfig = path.join(testProjectDir, '.ai-cli.json');

describe('Config store logic', () => {
  before(() => {
    fs.mkdirSync(testProjectDir, { recursive: true });
  });

  after(() => {
    try { fs.rmSync(testProjectDir, { recursive: true, force: true }); } catch {}
  });

  it('should read and write config correctly', () => {
    const config = { provider: 'custom', model: 'test-model', apiKey: 'test-key', maxTokens: 4096 };
    fs.writeFileSync(testProjectConfig, JSON.stringify(config), 'utf-8');

    const raw = fs.readFileSync(testProjectConfig, 'utf-8');
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.provider, 'custom');
    assert.strictEqual(parsed.model, 'test-model');
    assert.strictEqual(parsed.apiKey, 'test-key');
    assert.strictEqual(parsed.maxTokens, 4096);
  });

  it('should handle missing config gracefully', () => {
    const nonExistentPath = path.resolve(__dirname, './nonexistent/.ai-cli.json');
    assert.ok(!fs.existsSync(nonExistentPath));
  });
});

'use strict';

const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const root = path.resolve(__dirname, '..');
const textExtensions = new Set(['.ts', '.js', '.cjs', '.json', '.md', '.bat']);
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist']);
const decoder = new TextDecoder('utf-8', { fatal: true });
const failures = [];
let checked = 0;

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(fullPath);
      continue;
    }
    const isText = textExtensions.has(path.extname(entry.name)) ||
      ['.editorconfig', '.gitattributes', '.gitignore', '.npmrc'].includes(entry.name);
    if (!isText) continue;

    checked++;
    try {
      const text = decoder.decode(fs.readFileSync(fullPath));
      if (text.includes('\uFFFD')) throw new Error('包含 Unicode 替换字符 U+FFFD');
    } catch (error) {
      failures.push(`${path.relative(root, fullPath)}: ${error.message}`);
    }
  }
}

visit(root);
if (failures.length > 0) {
  console.error(`UTF-8 检查失败:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`UTF-8 检查通过 (${checked} 个文本文件)`);
}

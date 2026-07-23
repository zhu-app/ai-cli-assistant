'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scopeDirectory = path.join(root, 'node_modules', '@ai-cli');
const packageNames = ['shared', 'tools', 'server', 'cli'];

fs.mkdirSync(scopeDirectory, { recursive: true });

for (const name of packageNames) {
  const source = path.join(root, 'packages', name);
  const target = path.join(scopeDirectory, name);
  const targetManifest = path.join(target, 'package.json');

  if (fs.existsSync(targetManifest)) continue;
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  fs.symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
}

console.log('Workspace package links are ready');

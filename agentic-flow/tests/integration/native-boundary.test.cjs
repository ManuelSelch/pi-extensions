const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../../..');
for (const [label, sdk] of [
 ['development Pi', 'node_modules/@earendil-works/pi-coding-agent/dist/index.js'],
 ['pi-server Pi', 'node_modules/@manuelselch/pi-server/node_modules/@earendil-works/pi-coding-agent/dist/index.js'],
]) test(`${label} accepts a continuation after a finished assistant message`, () => {
 execFileSync(process.execPath, [resolve(__dirname, 'support/native-boundary.mjs'), resolve(root, sdk)], { cwd: root, stdio: 'pipe', timeout: 30000 });
});

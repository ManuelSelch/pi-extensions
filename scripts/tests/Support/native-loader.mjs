import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const [sdkPath, agentDir, cwd] = process.argv.slice(2);
const sdk = await import(pathToFileURL(sdkPath).href);
const { loadExtensions } = await import(pathToFileURL(path.join(path.dirname(sdkPath), 'core/extensions/loader.js')).href);
const settings = JSON.parse(fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8'));
const settingsManager = sdk.SettingsManager.inMemory(settings, { projectTrusted: true });
const resolved = await new sdk.DefaultPackageManager({ cwd, agentDir, settingsManager }).resolve();
const entries = resolved.extensions.filter(entry => entry.enabled).map(entry => entry.path);
const loaded = await loadExtensions(entries, cwd);
assert.deepEqual(loaded.errors, []);
const relative = file => path.relative(path.join(agentDir, 'extensions'), file).split(path.sep).join('/');
const commands = [], tools = [], handlers = {};
for (const extension of loaded.extensions) {
  commands.push(...extension.commands.keys());
  tools.push(...extension.tools.keys());
  handlers[relative(extension.path)] = [...extension.handlers.keys()];
}
console.log(JSON.stringify({
  entries: entries.map(relative).sort(), loaded: loaded.extensions.length, commands, tools, handlers,
  disabled: resolved.extensions.filter(entry => !entry.enabled).map(entry => relative(entry.path)).sort(),
}));

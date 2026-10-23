const { test } = require('node:test');
const { createDriver } = require('./Support/driver.cjs');

test('discovers files and folder entry points, never nested helpers or legacy disabled files', async t => {
  const manager = await createDriver(t);
  manager.addExtension('single.ts');
  manager.addExtension('folder/index.ts');
  manager.addExtension('javascript/index.js');
  manager.addExtension('folder/tests/hidden.test.ts');
  manager.addExtension('folder/src/helper.ts');
  manager.addExtension('old.ts.disabled');
  manager.addExtension('types.d.ts');
  await manager.start();
  await manager.act('Enable / disable extensions');
  manager.thenMenuIncludes('user:extensions/single.ts');
  manager.thenMenuIncludes('user:extensions/folder/index.ts');
  manager.thenMenuIncludes('user:extensions/javascript/index.js');
  manager.thenMenuExcludes('hidden');
  manager.thenMenuExcludes('helper');
  manager.thenMenuExcludes('old.ts.disabled');
  manager.thenMenuExcludes('types.d.ts');
  manager.thenNoNotice(/conversion/i);
});

test('disables a folder using settings only and Pi excludes its unchanged entry point', async t => {
  const manager = await createDriver(t);
  const entry = manager.addExtension('pipeline/index.ts', 'user', 'throw new Error("must not execute");');
  manager.configure('user', { theme: 'dark', extensions: ['+extensions/pipeline/index.ts', '-extensions/other.ts'], skills: ['mine'] });
  await manager.start();
  await manager.act('Enable / disable extensions', 'user:extensions/pipeline/index.ts');
  manager.thenSettings('user', { theme: 'dark', extensions: ['+extensions/pipeline/index.ts', '-extensions/other.ts', '-extensions/pipeline/index.ts'], skills: ['mine'] });
  manager.thenSourcesUnchanged();
  await manager.thenNativeEnabled(entry, false);
  manager.thenNotice(/reload|restart/i);
});

test('enables by removing equivalent relative, absolute, and tilde exclusions', async t => {
  const manager = await createDriver(t);
  const entry = manager.addExtension('single.ts');
  manager.configure('user', { extensions: ['-./extensions/single.ts', `-${entry}`, `-${manager.homeRelative('single.ts')}`, '-extensions/other.ts'] });
  await manager.start();
  await manager.act('Enable / disable extensions', 'user:extensions/single.ts');
  manager.thenSettings('user', { extensions: ['-extensions/other.ts'] });
  manager.thenSourcesUnchanged();
  await manager.thenNativeEnabled(entry, true);
});

test('enabling overrides a broad exclusion with an exact inclusion', async t => {
  const manager = await createDriver(t);
  const entry = manager.addExtension('pipeline/index.ts');
  manager.configure('user', { extensions: ['!extensions/**'] });
  await manager.start();
  await manager.act('Enable / disable extensions', 'user:extensions/pipeline/index.ts');
  manager.thenSettings('user', { extensions: ['!extensions/**', '+extensions/pipeline/index.ts'] });
  await manager.thenNativeEnabled(entry, true);
});

test('project toggles write only project settings and distinguish same-named extensions', async t => {
  const manager = await createDriver(t);
  manager.addExtension('same.ts');
  const project = manager.addExtension('same.ts', 'project');
  manager.configure('user', { theme: 'dark' });
  manager.configure('project', { custom: 42 });
  await manager.start();
  await manager.act('Enable / disable extensions', 'project:extensions/same.ts');
  manager.thenSettings('user', { theme: 'dark' });
  manager.thenSettings('project', { custom: 42, extensions: ['-extensions/same.ts'] });
  manager.thenMenuIncludes('user:extensions/same.ts');
  await manager.thenNativeEnabled(project, false);
});

test('refuses enabling when another scope still excludes an explicitly referenced entry', async t => {
  const manager = await createDriver(t);
  const entry = manager.addExtension('single.ts');
  manager.configure('user', { extensions: ['-extensions/single.ts'] });
  manager.configure('project', { extensions: [entry, `-${entry}`] });
  await manager.start();
  await manager.act('Enable / disable extensions', 'user:extensions/single.ts');
  manager.thenNotice(/blocked|excluded/i);
  manager.thenSettings('user', { extensions: ['-extensions/single.ts'] });
  manager.thenSettings('project', { extensions: [entry, `-${entry}`] });
  await manager.thenNativeEnabled(entry, false);
});

for (const raw of ['{bad json', '[]', 'null', '{"extensions":"not an array"}', '{"extensions":[42]}']) {
  test(`reports invalid settings without overwriting: ${raw}`, async t => {
    const manager = await createDriver(t);
    manager.addExtension('single.ts');
    await manager.start();
    manager.configureRaw('user', raw);
    await manager.act('Enable / disable extensions');
    manager.thenNotice(/Cannot read|Invalid/i);
    manager.thenRawSettings('user', raw);
  });
}

for (const folderSelf of [false, true]) {
  test(`protects the actual manager entry (${folderSelf ? 'folder' : 'file'})`, async t => {
    const manager = await createDriver(t, { folderSelf });
    await manager.start();
    await manager.act('Enable / disable extensions', `user:extensions/${folderSelf ? 'extension-manager/index.ts' : 'extension-manager.ts'}`);
    manager.thenNotice(/Refusing to disable/);
    manager.thenSettings('user', {});
    manager.thenSourcesUnchanged();
  });
}

test('saved defaults restore settings-only enablement', async t => {
  const manager = await createDriver(t);
  const entry = manager.addExtension('single.ts');
  manager.configure('user', { extensions: ['-extensions/single.ts'] });
  await manager.start();
  await manager.act('Save current state as default');
  manager.thenDefault('user:extensions/single.ts', false);
  manager.thenSeen('user:extensions/single.ts');
  await manager.act('Enable / disable extensions', 'user:extensions/single.ts');
  await manager.act('Apply defaults now');
  await manager.thenNativeEnabled(entry, false);
  manager.thenSourcesUnchanged();
});

test('default-for-new disable writes exclusions but never disables the manager', async t => {
  const manager = await createDriver(t, { folderSelf: true });
  const entry = manager.addExtension('new/index.ts');
  manager.setDefaults({ defaults: {}, seen: [], disabledPackages: [], defaultForNew: 'disable' });
  await manager.start();
  manager.thenSettings('user', { extensions: ['-extensions/new/index.ts'] });
  manager.thenDefault('user:extensions/new/index.ts', false);
  manager.thenDefault('user:extensions/extension-manager/index.ts', true);
  manager.thenSourcesUnchanged();
  await manager.thenNativeEnabled(entry, false);
});

test('real Pi loader registers the asynchronous manager with isolated agent settings', async t => {
  const manager = await createDriver(t);
  await manager.thenRegistersWithPiLoader();
});

test('broken extension symlinks do not prevent managing valid entry points', async t => {
  const manager = await createDriver(t);
  manager.addBrokenLink();
  manager.addExtension('valid.ts');
  await manager.start();
  await manager.act('Enable / disable extensions');
  manager.thenMenuIncludes('user:extensions/valid.ts');
  manager.thenMenuExcludes('broken.ts');
});

test('repeated toggles never accumulate duplicate exclusions', async t => {
  const manager = await createDriver(t);
  manager.addExtension('single.ts');
  await manager.start();
  await manager.act('Enable / disable extensions', 'user:extensions/single.ts', 'user:extensions/single.ts', 'user:extensions/single.ts');
  manager.thenSettings('user', { extensions: ['-extensions/single.ts'] });
  manager.thenSourcesUnchanged();
});

test('default-for-new enable respects explicit settings exclusions on first discovery', async t => {
  const manager = await createDriver(t);
  manager.addExtension('single.ts');
  manager.configure('user', { extensions: ['-extensions/single.ts'] });
  await manager.start();
  manager.thenSettings('user', { extensions: ['-extensions/single.ts'] });
  manager.thenDefault('user:extensions/single.ts', false);
});

test('package toggling remains separate from local extension exclusions', async t => {
  const manager = await createDriver(t);
  manager.configure('user', { packages: ['npm:example'], theme: 'dark' });
  await manager.start();
  await manager.act('Enable / disable extensions', 'npm:example  (package)');
  manager.thenSettings('user', { packages: [], theme: 'dark' });
  await manager.act('Enable / disable extensions', 'npm:example  (package)');
  manager.thenSettings('user', { packages: ['npm:example'], theme: 'dark' });
});

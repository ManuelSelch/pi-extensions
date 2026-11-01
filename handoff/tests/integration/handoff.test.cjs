const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HandoffDriver } = require('./support/handoff-driver.cjs');

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('condition did not become true');
}

test('drafts repository facts, matching artifacts, exact Git scope and verification gaps', async t => {
  const handoff = new HandoffDriver(t).featureBranch();
  handoff.confirmReplies = [false];

  await handoff.run();

  assert.match(handoff.draft, /^# Review handoff: handoff-review$/m);
  assert.ok(handoff.draft.includes(`Base: \`${handoff.mergeBase('main')}\` (merge-base with main)`));
  assert.ok(handoff.draft.includes(`Head: \`${handoff.head()}\` feat: add handoff`));
  assert.match(handoff.draft, /Uncommitted changes \(2\):\n  - ` M src\/app\.ts`\n  - `\?\? notes\.txt`/);
  assert.match(handoff.draft, /Plans: `plans\/handoff-review\/PLAN\.md`/);
  assert.match(handoff.draft, /Mockups: `mockups\/handoff-review\/DESIGN\.md`/);
  assert.match(handoff.draft, /PLAN\.md:4`: Approved by the user/);
  assert.doesNotMatch(handoff.draft, /other-feature/);
  assert.match(handoff.draft, /Code \(3\): `notes.txt`, `src\/app\.ts`, `src\/handoff\.ts`/);
  assert.match(handoff.draft, /Tests \(1\): `tests\/handoff\.test\.ts`/);
  assert.match(handoff.draft, /Docs \(1\): `docs\/handoff\.md`/);
  assert.match(handoff.draft, /Verification results are not recorded/);
});

test('finds unchanged mockups by both branch slug and inferred feature name', async t => {
  const handoff = new HandoffDriver(t).featureWithExistingMockups();
  handoff.confirmReplies = [false];

  await handoff.run();

  assert.match(handoff.draft, /^# Review handoff: approved-feature$/m);
  assert.match(handoff.draft, /Mockups: `mockups\/approved-feature\/DESIGN\.md`, `mockups\/implementation\/DESIGN\.md`/);
  assert.match(handoff.draft, /mockups\/approved-feature\/DESIGN\.md:2`: Approved revision 1\./);
  assert.match(handoff.draft, /mockups\/implementation\/DESIGN\.md:2`: Approved revision 1\./);
  assert.doesNotMatch(handoff.draft, /mockups\/unrelated\//);
});

test('editor cancellation, blank input and declined confirmation change nothing', async t => {
  for (const reply of [undefined, '', '  ', draft => draft]) {
    const handoff = new HandoffDriver(t).featureBranch();
    handoff.editorReply = reply;
    handoff.confirmReplies = [false];

    await handoff.run();

    handoff.expectNothingChanged();
    handoff.expectNotified('info', /cancelled.*nothing changed/i);
  }
});

test('creates an unlinked named session and submits the edited handoff once through the reviewer skill', async t => {
  const handoff = new HandoffDriver(t).featureBranch();
  handoff.busyArchiveAttempts = 1;
  handoff.editorReply = draft => draft + '\nReview this note too.\n';
  const sourceBefore = handoff.implementationContents();

  await handoff.run();
  await waitFor(() => handoff.archives.length === 1);

  assert.equal(handoff.newSessions.length, 1);
  assert.equal(handoff.newSessions[0].parentSession, undefined);
  assert.deepEqual(handoff.review.entries, [{ type: 'session_info', name: 'Review: handoff-review' }]);
  assert.deepEqual(handoff.timeline, ['name', 'prompt', 'archive']);
  assert.deepEqual(handoff.archives, [handoff.implementationSession]);
  assert.equal(handoff.archiveCalls, 2);
  assert.equal(handoff.prompts.length, 1);
  assert.equal(handoff.prompts[0].content, '/skill:code-reviewer ' + handoff.draft + '\nReview this note too.\n');
  assert.equal(handoff.prompts[0].cwd, handoff.repo);
  assert.equal(handoff.prompts[0].options.expandPromptTemplates, true);
  assert.match(handoff.confirmation().message, /archive the implementation session after.*review.*start/i);
  handoff.expectNotified('info', /implementation session archived/i);
  assert.equal(handoff.implementationContents(), sourceBefore);
});

test('waits for successful review submission before archiving', async t => {
  const handoff = new HandoffDriver(t).featureBranch();
  let finishPrompt;
  handoff.promptWait = new Promise(resolve => { finishPrompt = resolve; });
  const promptStarted = new Promise(resolve => { handoff.onPrompt = resolve; });

  const running = handoff.run();
  await promptStarted;
  const archivesWhilePending = [...handoff.archives];
  finishPrompt();
  await running;
  await waitFor(() => handoff.archives.length === 1);

  assert.deepEqual(archivesWhilePending, []);
  assert.deepEqual(handoff.archives, [handoff.implementationSession]);
});

test('another extension cancelling creation never submits the handoff', async t => {
  const handoff = new HandoffDriver(t).featureBranch();
  handoff.cancelNewSession = true;

  await handoff.run();

  assert.deepEqual(handoff.prompts, []);
  assert.deepEqual(handoff.archives, []);
  handoff.expectNotified('warning', /cancelled.*unchanged/i);
});

test('review start failure preserves the edited prompt for retry in the new session', async t => {
  const handoff = new HandoffDriver(t).featureBranch();
  handoff.promptError = new Error('model unavailable');

  await handoff.run();

  assert.equal(handoff.newSessions.length, 1);
  assert.equal(handoff.prompts.length, 1);
  assert.deepEqual(handoff.archives, []);
  handoff.expectNotified('error', /model unavailable.*not archived/);
  assert.deepEqual(handoff.editorTexts, ['/skill:code-reviewer ' + handoff.draft]);
});

test('archive failure leaves the review running without restoring or resubmitting its prompt', async t => {
  const handoff = new HandoffDriver(t).featureBranch();
  handoff.archiveError = new Error('metadata persistence uncertain');

  await handoff.run();
  await waitFor(() => handoff.notifications.some(note => note.level === 'warning'));

  assert.deepEqual(handoff.timeline, ['name', 'prompt']);
  assert.deepEqual(handoff.archives, []);
  assert.equal(handoff.prompts.length, 1);
  assert.deepEqual(handoff.editorTexts, []);
  handoff.expectNotified('warning', /review started.*archiv.*metadata persistence uncertain.*Pi Chat/i);
});

test('terminal Pi without a session host keeps manual archiving explicit', async t => {
  const handoff = new HandoffDriver(t).featureBranch();
  handoff.hostAvailable = false;

  await handoff.run();

  assert.deepEqual(handoff.timeline, ['name', 'prompt']);
  assert.deepEqual(handoff.archives, []);
  assert.match(handoff.confirmation().message, /Archive the implementation session manually/);
  handoff.expectNotified('info', /Archive the implementation session manually/);
});

test('an unsaved source session cannot be archived', async t => {
  const handoff = new HandoffDriver(t).featureBranch();
  handoff.implementationSession = undefined;

  await handoff.run();

  assert.deepEqual(handoff.timeline, ['name', 'prompt']);
  assert.deepEqual(handoff.archives, []);
  assert.match(handoff.confirmation().message, /no saved.*session.*archive/i);
  handoff.expectNotified('info', /no saved.*session.*archive/i);
});

test('session creation failure never archives the source', async t => {
  const handoff = new HandoffDriver(t).featureBranch();
  handoff.creationError = new Error('creation failed');

  await handoff.run();

  assert.deepEqual(handoff.archives, []);
  assert.deepEqual(handoff.prompts, []);
  handoff.expectNotified('error', /session could not be created: creation failed.*not archived/i);
});

test('rejects missing reviewer skill, non-Git directory, headless mode and running sessions', async t => {
  for (const [arrange, message] of [
    [driver => { driver.featureBranch(); driver.skills = []; }, /code-reviewer/],
    [() => {}, /Git repository/],
    [driver => { driver.featureBranch(); driver.idle = false; }, /current run/],
    [driver => { driver.featureBranch(); driver.hasUI = false; }, /editor and confirmation/],
  ]) {
    const handoff = new HandoffDriver(t);
    arrange(handoff);

    await handoff.run();

    handoff.expectNothingChanged();
    assert.equal(handoff.dialogs.length, 0);
    handoff.expectNotified('error', message);
  }
});

test('rejects base and feature-name parameters before opening dialogs', async t => {
  for (const args of ['review --base main', 'review Custom feature', 'review --base main Custom feature']) {
    const handoff = new HandoffDriver(t).featureBranch();

    await handoff.run(args);

    handoff.expectNothingChanged();
    assert.equal(handoff.dialogs.length, 0);
    handoff.expectNotified('error', /^Usage: \/handoff review$/);
  }
});

test('missing base is an explicit gap, not a guessed commit range', async t => {
  const handoff = new HandoffDriver(t).onMainWithoutUpstream();
  handoff.confirmReplies = [false];

  await handoff.run();

  assert.match(handoff.draft, /Base: unknown/);
  assert.match(handoff.draft, /Could not determine a base commit/);
  assert.doesNotMatch(handoff.draft, /--base/);
  assert.match(handoff.draft, /No plan directory/);
  assert.match(handoff.draft, /No test files changed/);
  assert.match(handoff.draft, /No documentation files changed/);
});

test('failed Git scope reads abort before showing a misleading handoff', async t => {
  for (const command of ['status', 'diff']) {
    const handoff = new HandoffDriver(t).featureBranch();
    handoff.gitFailure = command;

    await handoff.run();

    handoff.expectNothingChanged();
    assert.equal(handoff.dialogs.length, 0);
    handoff.expectNotified('error', /Could not read Git review scope/);
  }
});

test('rename paths and unusual untracked filenames remain in dirty scope', async t => {
  const handoff = new HandoffDriver(t).featureBranch();
  handoff.git('mv', 'src/handoff.ts', 'src/renamed file.ts');
  handoff.write('odd\nfilename.txt', 'content');
  handoff.confirmReplies = [false];

  await handoff.run();

  assert.ok(handoff.draft.includes('src/handoff.ts -> src/renamed file.ts'));
  assert.ok(handoff.draft.includes('odd\nfilename.txt'));
});

test('rejects invalid subcommands and completes review', async t => {
  const handoff = new HandoffDriver(t).featureBranch();

  await handoff.run('ship');

  handoff.expectNothingChanged();
  handoff.expectNotified('error', /Usage: \/handoff review/);
  assert.deepEqual((await handoff.completions('re')).map(item => item.value), ['review']);
});

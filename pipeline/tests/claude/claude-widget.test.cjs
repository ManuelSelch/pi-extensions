const { test, beforeEach, afterEach } = require('node:test');

const { ClaudePipelineDriver } = require('./claude-driver.cjs');

beforeEach(async t => { t.context = { claude: await ClaudePipelineDriver.create(t, { widget: true }) }; });
afterEach(async t => { await t.context?.claude?.dispose(); });

test('Claude shows local suites and GitHub Actions status in the widget', async t => {
  const claude = t.context.claude;
  const widget = claude.widget;
  await widget.provideStatus('local-and-github');

  await claude.startSession();

  await widget.thenWidgetShowsLocalAndGitHubStatus();
  await widget.thenNoTestsOrPromptsWereStarted();
});

test('Claude hides the widget when there is no pipeline or GitHub status', async t => {
  const claude = t.context.claude;
  const widget = claude.widget;
  await widget.provideStatus('empty');

  await claude.startSession();

  await widget.thenWidgetIsHidden();
});

test('the widget refreshes when pipeline status changes', async t => {
  const claude = t.context.claude;
  const widget = claude.widget;
  await widget.provideStatus('local-and-github');
  await claude.startSession();
  await widget.provideStatus('changed');

  await widget.advanceRefresh();

  await widget.thenWidgetShowsChangedStatus();
  await widget.thenNoTestsOrPromptsWereStarted();
});

test('an unavailable status refresh is not displayed as a current success', async t => {
  const claude = t.context.claude;
  const widget = claude.widget;
  await widget.provideStatus('local-and-github');
  await claude.startSession();
  await widget.failStatusRefresh();

  await widget.advanceRefresh();

  await widget.thenRefreshFailureIsNotShownAsCurrentSuccess();
});

test('ending the session stops background status refreshes', async t => {
  const claude = t.context.claude;
  const widget = claude.widget;
  await claude.startSession();

  await claude.endSession();
  await widget.advanceRefresh();

  await widget.thenNoFurtherRefreshesOccur();
});

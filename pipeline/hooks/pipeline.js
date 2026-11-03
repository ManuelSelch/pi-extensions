// This module runs in Claude Code's mod environment, not Node.js.
let status;
let unavailable = '';
let timers = [];
let generation = 0;
let pending = false;
let terminalActive = false;
const desktopClients = new Set();

function stop() {
  generation += 1;
  for (const timer of timers) timer.cancel();
  timers = [];
  status = undefined;
  unavailable = '';
}

async function refresh($, current) {
  if (pending || current !== generation) return;
  pending = true;
  try {
    const result = await $.mcp.call('plugin:pipeline:pipeline', 'pipeline_status', {});
    if (result.isError) throw new Error('Status unavailable');
    const content = result.content?.find(block => block.type === 'text')?.text;
    const value = JSON.parse(content);
    if (!value || typeof value !== 'object' || !value.suites || typeof value.suites !== 'object') throw new Error('Invalid status response');
    if (current !== generation) return;
    status = value;
    unavailable = '';
  } catch (error) {
    if (current !== generation) return;
    status = undefined;
    const message = String(error?.message ?? error);
    unavailable = /permission|denied|refused|classifier|policy/i.test(message) ? 'permission' :
      /timeout|timed out/i.test(message) ? 'timeout' :
      /invalid|json|syntax/i.test(message) ? 'invalid response' : 'connection';
  } finally {
    pending = false;
    if (current === generation) $.ui.invalidate('ui.render');
  }
}

function start($) {
  stop();
  const current = generation;
  timers = [$.clock.after(0, () => refresh($, current)), $.clock.every(5000, () => refresh($, current))];
}

const safe = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '');

function lines(value) {
  const result = [];
  const suites = Object.entries(value.suites);
  if (value.configured && suites.length) {
    const all = [...(value.prepare && value.prepare.outcome !== 'passed' && value.prepare.outcome !== 'never' ? [['prepare', value.prepare]] : []), ...suites];
    const failed = all.some(([, item]) => ['failed', 'cancelled', 'timed-out'].includes(item.outcome));
    const running = all.some(([, item]) => item.outcome === 'running');
    const stale = all.some(([, item]) => item.stale);
    const passed = suites.filter(([, item]) => item.outcome === 'passed' && !item.stale).length;
    const symbol = failed ? '✗' : running ? '◐' : stale ? '⚠' : passed === suites.length ? '✓' : '○';
    result.push(`${symbol} Local ${passed}/${suites.length}${stale ? ' · stale' : ''}`);
    for (const [name, item] of all) {
      if (item.outcome === 'passed' && !item.stale) continue;
      const mark = item.stale ? '⚠' : ({ never: '○', running: '›', failed: '✗', cancelled: '■', 'timed-out': '⌛' }[item.outcome] ?? '○');
      result.push(`  ${mark} ${safe(name)} ${item.stale ? 'stale' : safe(item.outcome)}`);
    }
  }
  const github = value.github;
  if (!github) return result;
  if (github.error && !github.stale) result.push('⚠ GitHub · unavailable');
  else for (const workflow of github.workflows ?? []) {
    const active = workflow.status !== 'completed' && workflow.status !== 'never';
    const symbol = github.stale || workflow.jobsError ? '⚠' : active ? '◐' : workflow.conclusion === 'success' ? '✓' : workflow.status === 'never' ? '○' : '✗';
    const jobs = workflow.jobs ?? [];
    const count = jobs.length ? `${jobs.filter(job => active ? job.status === 'completed' : job.status === 'completed' && job.conclusion === 'success').length}/${jobs.length}${active ? ' complete' : ''}` : safe(active ? workflow.status : workflow.conclusion ?? workflow.status);
    result.push(`${symbol} GitHub ${safe(workflow.name)} · ${count}${github.stale ? ' · stale' : ''}`);
    if (workflow.jobsError) result.push('  └─ ⚠ jobs unavailable');
    else for (const job of jobs.filter(item => item.status !== 'completed' || item.conclusion !== 'success')) result.push(`  └─ ✗ ${safe(job.name)} ${safe(job.conclusion ?? job.status)}`);
  }
  return result;
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    terminalActive = e.isInteractive && e.surface === 'terminal';
    if (e.isInteractive || e.surface === 'desktop') start($);
    return next(e);
  });
  on('session.attach', { surface: 'desktop' }, async ($, e, next) => {
    desktopClients.add(e.clientId);
    if (!timers.length) start($);
    return next(e);
  });
  on('session.detach', { surface: 'desktop' }, async ($, e, next) => {
    desktopClients.delete(e.clientId);
    if (!desktopClients.size && !terminalActive) {
      stop();
      $.ui.invalidate('ui.render');
    }
    return next(e);
  });
  on('session.end', async ($, e, next) => {
    terminalActive = false;
    desktopClients.clear();
    stop();
    $.ui.invalidate('ui.render');
    return next(e);
  });
  on('classic.SessionStart', async ($, e, next) => {
    if (['clear', 'resume', 'fork'].includes(e.source)) start($);
    return next(e);
  });
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const rows = unavailable ? [`⚠ Pipeline · unavailable · ${unavailable}`] : status ? lines(status) : [];
    if (!rows.length) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    const other = await next(e);
    return Box({ flexDirection: 'column', children: [other, ...rows.map(row => Text({ children: [row] }))] });
  });
}

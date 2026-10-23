// Disposable interaction preview: deterministic fixtures only; no APIs or persistence.
const params = new URLSearchParams(location.search);
const view = params.get('view') === 'terminal' ? 'terminal' : 'chat';
const initialState = params.get('state') || 'populated';
const $ = (selector) => document.querySelector(selector);
const escape = (text) => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const repos = {
  chat: {name:'Pi Chat', local:'passed', github:'failed', suites:[['Typecheck','passed'],['Unit tests · 418 tests','passed'],['Browser tests','passed']], workflows:[['Tests','failed',[['Typecheck','passed'],['Unit tests','passed'],['Browser tests','failed']]]]},
  extensions: {name:'Extensions', local:'stale', github:'passed', suites:[['Typecheck','passed'],['Extension tests · previous pass','stale']], workflows:[['Checks','passed',[['Tests','passed']]]]},
  sdk: {name:'Pi SDK', local:'running', github:'queued', suites:[['Typecheck','passed'],['Integration tests','running']], workflows:[['Tests','queued',[['Test matrix','queued']]]]},
  portfolio: {name:'Portfolio', local:'passed', github:'passed', suites:[['Production build','passed'],['Component tests','passed']], workflows:[['Deploy','passed',[['Build','passed'],['Deploy','passed']]]]},
  notes: {name:'NotesToGo', local:'none', github:'none', suites:[], workflows:[]},
  pulse: {name:'Homelab Pulse', local:'failed', github:'error', suites:[['Unit tests','failed'],['Typecheck','passed']], workflows:[], error:'GitHub status unavailable: authentication required. Other repositories are unaffected.'},
};
const projects = initialState === 'empty' ? [] : [
  {id:'ecosystem',name:'Pi ecosystem',repos:['chat','extensions','sdk']},
  {id:'personal',name:'Personal projects',repos:['portfolio','notes','extensions']},
  {id:'homelab',name:'Homelab',repos:['pulse']},
  {id:'ideas',name:'Ideas',repos:[]},
];
const outcomes = {passed:['✓','Passed'],failed:['✗','Failed'],stale:['⚠','Stale'],running:['◌','Running'],queued:['◷','Queued'],none:['—','No data'],error:['!','Unavailable'],loading:['◌','Loading'],cancelled:['⊘','Cancelled']};
let selected = 'ecosystem/chat';
let detail = null;
let rows = [];
let query = '';
let closed = false;
let refreshing = false;
let generation = 0;
let completed = new Set(Object.keys(repos));
let lastUpdated = 'Snapshot ready';
const collapsed = new Set();
const popup = $('#popup');
const viewport = $('#viewport');
const uniqueRepos = () => [...new Set(projects.flatMap(project => project.repos))];

if (view === 'terminal') {
  document.body.classList.add('terminal');
  $('#host-title').textContent = 'Pi terminal';
  $('#approximation').textContent = 'Terminal approximation rendered in HTML. This does not prove native key handling, sizing, terminal protocols or focus behavior.';
}
for (const link of document.querySelectorAll('[data-view]')) {
  const target = new URLSearchParams(params); target.set('view', link.dataset.view);
  link.href = `?${target}`; link.classList.toggle('active', link.dataset.view === view);
}
for (const link of document.querySelectorAll('.states a')) {
  const target = new URLSearchParams(link.search); target.set('view', view); link.href = `?${target}`;
}
function signal(status, context) {
  const [symbol, label] = outcomes[status] || outcomes.error;
  const text = status === 'none' ? (context === 'local' ? 'No config' : 'No runs') : label;
  return `<span class="signal ${status === 'error' ? 'failed' : status}"><span aria-hidden="true">${symbol}</span>${escape(text)}</span>`;
}
function repoStatus(id, context) {
  if (!completed.has(id)) return 'loading';
  if (initialState === 'error' && id === 'chat') return 'error';
  return repos[id][context];
}
function render() {
  const focused = document.activeElement;
  const focusedKey = focused?.dataset?.key;
  const backFocused = focused?.id === 'back';
  const scrollTop = viewport.scrollTop;
  renderContent();
  viewport.scrollTop = scrollTop;
  if (focusedKey) focusSelected();
  if (backFocused) $('#back')?.focus({preventScroll:true});
}
function renderContent() {
  const needle = query.trim().toLowerCase();
  $('#counts').textContent = `${projects.length} projects · ${uniqueRepos().length} repos`;
  $('#columns').hidden = Boolean(detail);
  $('#progress').textContent = refreshing ? `Refreshing · ${completed.size}/${uniqueRepos().length} repos` : lastUpdated;
  $('#refresh').disabled = refreshing;
  if (detail) { renderDetail(); return; }
  rows = [];
  const content = [];
  for (const project of projects) {
    const projectMatch = project.name.toLowerCase().includes(needle);
    const matches = project.repos.filter(id => projectMatch || repos[id].name.toLowerCase().includes(needle));
    if (!projectMatch && !matches.length) continue;
    const expanded = needle || !collapsed.has(project.id);
    rows.push({key:project.id,project:project.id});
    content.push(`<button class="row project" data-key="${project.id}" aria-expanded="${Boolean(expanded)}"><span class="row-label"><span class="arrow" aria-hidden="true">${expanded ? '▾' : '▸'}</span><span class="name">${escape(project.name)}</span><span class="count">${project.repos.length} repos</span></span></button>`);
    if (!expanded) continue;
    if (!matches.length) content.push('<p class="detail-note">No repositories · use /projects add from a repository session.</p>');
    for (const id of matches) {
      const key = `${project.id}/${id}`;
      rows.push({key,project:project.id,repo:id});
      content.push(`<button class="row repo" data-key="${key}"><span class="row-label"><span class="repo-icon" aria-hidden="true">◇</span><span class="name">${escape(repos[id].name)}</span></span><span class="signals">${signal(repoStatus(id,'local'),'local')}${signal(repoStatus(id,'github'),'github')}</span></button>`);
    }
  }
  if (!rows.some(row => row.key === selected)) selected = rows[0]?.key;
  if (!content.length) content.push(`<div class="empty"><strong>${projects.length ? 'No matching projects or repositories' : 'No registered projects yet'}</strong>${projects.length ? 'Try another name or clear your search.' : 'Use /projects create to create a collection.'}</div>`);
  viewport.innerHTML = content.join('');
  for (const button of viewport.querySelectorAll('[data-key]')) {
    button.classList.toggle('active', button.dataset.key === selected);
    button.tabIndex = button.dataset.key === selected ? 0 : -1;
    button.addEventListener('click', () => { selected = button.dataset.key; activate(); });
    button.addEventListener('focus', () => { selected = button.dataset.key; paintSelection(); });
  }
}
function renderDetail() {
  const repo = repos[detail];
  let html = `<div class="detail-header"><button id="back" aria-label="Back to projects">← Back</button><div><h3>${escape(repo.name)}</h3><p>Registered default checkout · read-only</p></div></div>`;
  if (!completed.has(detail)) html += '<div class="empty"><strong>Reading pipeline status…</strong>You can go back or close this popup while it loads.</div>';
  else if (initialState === 'error' && detail === 'chat') html += '<p class="detail-note failed">Checkout unavailable. The registered folder may have moved. Other repositories are unaffected.</p>';
  else {
    html += '<section class="detail-section"><h4>LOCAL PIPELINE</h4>';
    if (repo.suites.length) {
      html += `<div class="detail-line"><span>Preparation</span>${signal('passed')}</div>`;
      html += repo.suites.map(([name,status]) => `<div class="detail-line"><span>${escape(name)}</span>${signal(status)}</div>`).join('');
    } else html += '<p class="detail-note">No local pipeline configured.</p>';
    html += '</section>';
    if (repo.workflows.length || repo.error) {
      html += '<section class="detail-section"><h4>GITHUB ACTIONS</h4>';
      if (repo.error) html += `<p class="detail-note failed">${escape(repo.error)}</p>`;
      for (const [name,status,jobs] of repo.workflows) {
        html += `<div class="detail-line"><strong>${escape(name)}</strong>${signal(status)}</div>`;
        html += jobs.map(([job,outcome]) => `<div class="detail-line job"><span>└ ${escape(job)}</span>${signal(outcome)}</div>`).join('');
      }
      html += '</section>';
    } else html += '<p class="detail-note">No GitHub workflow runs available.</p>';
    if (repo.local === 'stale') html += '<p class="detail-note stale">⚠ Stale local result · previous outcome: passed. Refresh reads status; it does not rerun tests.</p>';
  }
  viewport.innerHTML = html;
  $('#back').addEventListener('click', back);
}
function paintSelection() {
  for (const button of viewport.querySelectorAll('[data-key]')) {
    button.classList.toggle('active', button.dataset.key === selected);
    button.tabIndex = button.dataset.key === selected ? 0 : -1;
  }
}
function focusSelected() {
  const button = [...viewport.querySelectorAll('[data-key]')].find(element => element.dataset.key === selected);
  button?.focus({preventScroll:true}); button?.scrollIntoView({block:'nearest'});
}
function activate() {
  const row = rows.find(item => item.key === selected);
  if (!row) return;
  if (row.repo) detail = row.repo;
  else if (collapsed.has(row.project)) collapsed.delete(row.project);
  else collapsed.add(row.project);
  render();
  if (detail) $('#back').focus(); else focusSelected();
}
function back() { detail = null; render(); focusSelected(); }
function close() {
  closed = true; generation++; refreshing = false;
  $('#scrim').hidden = true; $('#composer').focus();
}
function open() {
  closed = false; detail = null;
  $('#scrim').hidden = false;
  if (completed.size < uniqueRepos().length) refresh(); else render();
  $('#search').focus();
}
async function refresh() {
  const token = ++generation;
  const ids = uniqueRepos();
  completed = new Set(); refreshing = Boolean(ids.length); render();
  // Deterministic stagger demonstrates deduplicated progressive completion, not real network activity.
  for (const id of ids) {
    await new Promise(resolve => setTimeout(resolve, 380));
    if (closed || token !== generation) return;
    completed.add(id); render();
  }
  refreshing = false;
  lastUpdated = `Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})} · simulated`;
  render();
}
$('#search').addEventListener('input', event => { query = event.target.value; detail = null; render(); });
$('#refresh').addEventListener('click', refresh);
$('#close').addEventListener('click', close);
$('#open').addEventListener('click', open);
popup.addEventListener('cancel', event => { event.preventDefault(); close(); });
popup.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (query) { query = ''; $('#search').value = ''; render(); $('#search').focus(); }
    else if (detail) back(); else close();
    return;
  }
  if (event.key === 'Tab') {
    const elements = [...popup.querySelectorAll('button:not(:disabled),input,[tabindex="0"]')].filter(element => element.getClientRects().length);
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    return;
  }
  const editing = event.target instanceof HTMLInputElement;
  if (!editing && event.key === '/') { event.preventDefault(); $('#search').focus(); return; }
  if (!editing && event.key.toLowerCase() === 'r') { event.preventDefault(); if (!refreshing) refresh(); return; }
  if (detail || !rows.length) return;
  if (['ArrowDown','ArrowUp','PageDown','PageUp'].includes(event.key)) {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : event.key === 'PageDown' ? 6 : -6;
    const index = Math.max(0, rows.findIndex(row => row.key === selected));
    selected = rows[Math.max(0,Math.min(rows.length-1,index+step))].key;
    paintSelection(); focusSelected();
  } else if (event.key === 'Enter' && (editing || event.target === viewport || event.target.matches('[data-key]'))) {
    event.preventDefault(); activate();
  }
});
render();
if (initialState === 'loading') refresh();
$('#search').focus();

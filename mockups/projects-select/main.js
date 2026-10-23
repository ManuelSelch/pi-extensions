// Mockup only: every screen is represented by a ui.select(title, string[]) call.
const params = new URLSearchParams(location.search);
const view = params.get('view') === 'chat' ? 'chat' : 'terminal';
const state = params.get('state') || 'populated';
const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const repositories = {
  chat: {name:'Pi Chat',local:'✓ passed',github:'✗ failed',body:'Local pipeline\n  ✓ Preparation\n  ✓ Typecheck\n  ✓ Unit tests\n\nGitHub Actions\n  ✗ Tests\n    ├ ✓ Typecheck\n    ├ ✓ Unit tests\n    └ ✗ Browser tests'},
  extensions: {name:'Extensions',local:'⚠ stale (passed)',github:'✓ passed',body:'Local pipeline\n  ✓ Typecheck\n  ⚠ Extension tests · stale, previously passed\n\nGitHub Actions\n  ✓ Checks\n    └ ✓ Tests'},
  sdk: {name:'Pi SDK',local:'◌ running',github:'◷ queued',body:'Local pipeline\n  ✓ Typecheck\n  ◌ Integration tests running\n\nGitHub Actions\n  ◷ Tests queued'},
  notes: {name:'NotesToGo',local:'not configured',github:'no runs',body:'Local pipeline\n  Not configured.\n\nNo GitHub workflow runs available.'},
  portfolio: {name:'Portfolio',local:'✓ passed',github:'✓ passed',body:'Local pipeline\n  ✓ Production build\n\nGitHub Actions\n  ✓ Deploy\n    ├ ✓ Build\n    └ ✓ Deploy'},
};
if (state === 'error') repositories.chat = {...repositories.chat,local:'unavailable',github:'unavailable',body:'Status unavailable\n  Registered checkout could not be read.\n  The folder may have moved.\n\nOther repositories are unaffected.'};
const projects = state === 'empty' ? [] : [
  {name:'Pi ecosystem',repos:['chat','extensions','sdk']},
  {name:'Personal projects',repos:['notes','portfolio']},
  {name:'Ideas',repos:[]},
];
let level = 'projects', project = null, repo = null, selected = 0, choices = [], busy = false, closed = false, refreshed = false;
let refreshToken = 0;
document.body.classList.add(view);
$('#host-name').textContent = view === 'chat' ? 'Pi Chat' : 'Pi terminal';
$('#platform-note').textContent = view === 'chat'
  ? 'Pi Chat: the existing native prompt modal, with its standard Cancel and OK buttons. No new web component.'
  : 'Pi terminal: the native selector replaces the editor below the conversation; it is not a floating overlay. Use ↑↓ and Enter (clicks are enabled here for preview convenience).';
for (const link of document.querySelectorAll('[data-view],[data-state]')) {
  const target = new URLSearchParams(params);
  if (link.dataset.view) { target.set('view',link.dataset.view); link.classList.toggle('active',link.dataset.view === view); }
  else target.set('state',link.dataset.state);
  link.href = `?${target}`;
}
function menu() {
  choices = [];
  let heading = '', body = '';
  if (level === 'projects') {
    heading = 'Projects';
    body = projects.length ? 'Choose a registered project.' : 'No registered projects. Use /projects create <name>.';
    projects.forEach((item,index) => choices.push({label:`${index + 1}. ${item.name} — ${item.repos.length} repositories`,run:() => {project=item;level='repos';}}));
    choices.push({label:'↻ Refresh catalogue',run:refresh},{label:'Close',run:close});
  } else if (level === 'repos') {
    heading = project.name;
    body = project.repos.length ? `Local pipeline / GitHub Actions${refreshed ? '\nSnapshot refreshed · simulated' : ''}` : 'No repositories. Use /projects add from a repository session.';
    project.repos.forEach((id,index) => {
      const item = repositories[id];
      choices.push({label:`${index + 1}. ${item.name} — Local: ${item.local} · GitHub: ${item.github}`,run:() => {repo=id;level='details';}});
    });
    choices.push({label:'← Back to projects',run:back},{label:'↻ Refresh status',run:refresh},{label:'Close',run:close});
  } else {
    heading = repositories[repo].name;
    body = `${repositories[repo].body}\n\nRegistered checkout · read-only${refreshed ? '\nSnapshot refreshed · simulated' : ''}\nGitHub cache: up to 60 seconds. Refresh does not run tests.`;
    choices.push({label:`← Back to ${project.name}`,run:back},{label:'↻ Refresh status',run:refresh},{label:'Close',run:close});
  }
  // Exactly the serialized content production can pass through native select.
  const title = `${heading}\n${body}`;
  $('#selector').dataset.selectTitle = title;
  $('#title').textContent = heading;
  $('#body').textContent = body; $('#body').hidden = !body;
  $('#options').innerHTML = choices.map((choice,index) => `<button class="option" role="option" aria-selected="${index===selected}" tabindex="-1" data-index="${index}">${escape(choice.label)}</button>`).join('');
  $('#options').querySelectorAll('button').forEach(button => button.addEventListener('click',() => choose(Number(button.dataset.index))));
  paint();
}
function paint() {
  $('#options').querySelectorAll('.option').forEach((element,index) => {element.classList.toggle('active',index===selected);element.removeAttribute('id');element.setAttribute('aria-selected',String(index===selected));});
  const active = $('#options').children[selected];
  if (active) { active.id='selected-option'; $('#options').setAttribute('aria-activedescendant','selected-option'); }
}
function choose(index=selected) {
  if (busy || closed) return;
  const choice = choices[index]; if (!choice) return;
  choice.run(); selected=0;
  if (!busy && !closed) {menu();$('#options').focus();}
}
function back() {
  if (level==='details') level='repos';
  else if (level==='repos') level='projects';
  else close();
}
function cancel() {if(busy||closed)return;back();selected=0;if(!closed){menu();$('#options').focus();}}
function close() {
  closed=true;refreshToken++;busy=false;
  $('#presentation').hidden=true;$('#notice').hidden=true;
  document.body.classList.remove('busy');$('#composer').focus();
}
function refresh() {
  const token=++refreshToken;
  busy=true;document.body.classList.add('busy');$('#presentation').hidden=true;
  $('#notice').textContent=level==='projects'?'Reading registered catalogue… (simulated)':'Reading pipeline status… (simulated; no live menu updates)';
  $('#notice').hidden=false;
  setTimeout(() => {
    if(closed||token!==refreshToken)return;
    busy=false;refreshed=true;document.body.classList.remove('busy');$('#notice').hidden=true;
    $('#presentation').hidden=false;selected=0;menu();$('#options').focus();
  },800);
}
$('#options').addEventListener('keydown',event => {
  if(event.key==='ArrowDown'||event.key==='ArrowUp'||(view==='terminal'&&['j','k'].includes(event.key))) {
    event.preventDefault();const delta=['ArrowDown','j'].includes(event.key)?1:-1;
    selected=view==='chat'?(selected+delta+choices.length)%choices.length:Math.max(0,Math.min(choices.length-1,selected+delta));
    paint();$('#options').children[selected]?.scrollIntoView({block:'nearest'});
  }else if(event.key==='Enter'){event.preventDefault();choose();}
});
$('#selector').addEventListener('keydown',event => {
  if(event.key==='Escape'){event.preventDefault();cancel();}
  if(event.key==='Tab'&&view==='chat') {
    const controls=[$('#x'),$('#options'),$('#cancel'),$('#ok')];
    const index=controls.indexOf(document.activeElement);
    if(event.shiftKey&&index===0){event.preventDefault();controls.at(-1).focus();}
    else if(!event.shiftKey&&index===controls.length-1){event.preventDefault();controls[0].focus();}
  }
});
$('#x').addEventListener('click',cancel);$('#cancel').addEventListener('click',cancel);$('#ok').addEventListener('click',() => choose());
$('#reopen').addEventListener('click',() => {if(busy)return;closed=false;level='projects';selected=0;$('#presentation').hidden=false;menu();$('#options').focus();});
menu();$('#options').focus();

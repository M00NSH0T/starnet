/* stockblitz.js — StockBlitz fork: show the StockBlitz work board as display-only crew.

   Read-only. Polls the sidecar's /api/stockblitz/board (which reads the local StockBlitz dashboard) and
   gives each working or ready lane a body on the floor via World.spawnAgent — never App.summonAgent, so
   these bodies are not roster agents: no system prompt, no model, nothing persisted to the save or roster.
   A small HUD lists the watchdog and what each working lane is doing. Nothing here can start, stop or
   edit StockBlitz work. */
(() => {
  'use strict';
  const POLL_MS = 5000;
  const SHOWN = { running: true, ready: true };
  const LAYER_COLOR = {
    control: '#7ad5c1', research: '#b884ff', score: '#ffc46b', train: '#ff8a5c',
    news: '#6fb7ff', data: '#c9a36b', infra: '#8aa0b8',
  };
  let DASHBOARD = 'http://127.0.0.1:8765/';   // replaced by the sidecar's dashboardUrl (STOCKBLITZ_BOARD_URL)
  // Every dashboard tab has a place on the station. The mission board and trophy case are real props;
  // the rest open from the deck list in the HUD.
  const PLACES = [
    { place: 'Mission board', title: 'Work board', hash: 'board' },
    { place: 'Trophy case', title: 'Latest scores', hash: 'latest' },
    { place: 'Archive', title: 'Archived catalog', hash: 'overview' },
    { place: 'Chart table', title: 'Market map', hash: 'mapview' },
    { place: 'Lab bench', title: 'Model comparison', hash: 'models' },
    { place: 'Engine room', title: 'Data health', hash: 'health' },
    { place: 'Observatory', title: 'World twin globe', hash: 'worldtwin' },
  ];
  const bodies = new Map();   // crew id -> { status, name }
  let hud = null;
  let term = null;

  const token = () => { try { return String(window.__STARNET_API_TOKEN__ || ''); } catch (_) { return ''; } };
  const crewId = laneId => ('sb-' + String(laneId).replace(/^seq-/, '')).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40);
  const world = () => (typeof World !== 'undefined' ? World : window.World);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function ensureHud() {
    if (hud) return hud;
    const style = el('style');
    style.textContent = [
      '#sb-hud{position:fixed;right:14px;bottom:14px;z-index:950;width:min(330px,calc(100vw - 28px));max-height:46vh;overflow:auto;',
      'background:rgba(12,9,4,.88);border:1px solid #c98a2b;color:#f3d9a4;font:11px/1.45 ui-monospace,Consolas,monospace;padding:10px 12px;',
      'box-shadow:0 0 18px rgba(201,138,43,.25)}',
      '#sb-hud h4{margin:0 0 6px;font:700 11px ui-monospace,Consolas,monospace;letter-spacing:.14em;color:#ffb547}',
      '#sb-hud .sb-row{margin:5px 0;border-left:3px solid var(--c,#ffb547);padding-left:7px}',
      '#sb-hud .sb-name{color:#fff3d6}#sb-hud .sb-note{color:#c9ad7c}#sb-hud .sb-dim{color:#9c865e}',
      '#sb-hud button{background:none;border:1px solid #6b4d1c;color:#f3d9a4;font:inherit;cursor:pointer;padding:0 6px}',
      '#sb-hud .sb-toggle{float:right}',
      '#sb-hud .sb-decks{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:8px 0}',
      '#sb-hud .sb-decks button{text-align:left;padding:3px 6px}#sb-hud .sb-decks small{display:block;color:#9c865e}',
      '#sb-hud a.sb-dash{display:block;margin-top:8px;color:#ffb547;text-decoration:none;border:1px solid #c98a2b;padding:3px 6px;text-align:center}',
      '#sb-hud button:focus-visible,#sb-hud a:focus-visible,#sb-term button:focus-visible{outline:2px solid #ffb547}',
      '#sb-term{position:fixed;left:6vw;top:8vh;width:min(1100px,88vw);height:78vh;z-index:960;display:flex;flex-direction:column;',
      'background:#0b0f14;border:1px solid #c98a2b;box-shadow:0 0 30px rgba(0,0,0,.7)}',
      '#sb-term .sb-bar{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 10px;cursor:move;',
      'background:#1a1206;color:#ffb547;font:700 11px ui-monospace,Consolas,monospace;letter-spacing:.12em;user-select:none}',
      '#sb-term .sb-bar button{background:none;border:1px solid #6b4d1c;color:#f3d9a4;font:inherit;cursor:pointer;min-width:28px}',
      '#sb-term iframe{flex:1;border:0;width:100%;background:#101419}#sb-term[hidden]{display:none}',
    ].join('');
    document.head.appendChild(style);
    hud = el('div');
    hud.id = 'sb-hud';
    hud.setAttribute('aria-live', 'polite');
    document.body.appendChild(hud);
    return hud;
  }

  // The HUD frame (title, deck buttons, dashboard toggle) is built once; only the live part repaints,
  // so buttons keep focus and hover between polls.
  function buildHud() {
    const box = ensureHud();
    if (box.dataset.built) return box;
    box.dataset.built = '1';
    const toggle = el('button', 'sb-toggle', '–');
    toggle.setAttribute('aria-label', 'Collapse StockBlitz board');
    const summary = el('div', 'sb-dim sb-summary', 'Waiting for the StockBlitz dashboard on :8765…');
    const body = el('div', 'sb-body');
    const decks = el('div', 'sb-decks');
    PLACES.forEach(p => {
      const btn = el('button', null, p.place);
      btn.append(el('small', null, p.title));
      btn.onclick = () => openTerminal(p);
      decks.append(btn);
    });
    const dash = el('a', 'sb-dash', 'Dashboard view');
    dash.href = DASHBOARD;
    body.append(decks, el('div', 'sb-live'), dash);
    toggle.onclick = () => {
      body.hidden = !body.hidden;
      toggle.textContent = body.hidden ? '+' : '–';
      toggle.setAttribute('aria-label', (body.hidden ? 'Expand' : 'Collapse') + ' StockBlitz board');
    };
    box.append(toggle, el('h4', null, 'STOCKBLITZ BOARD'), summary, body);
    return box;
  }

  function renderHud(data) {
    const box = buildHud();
    const summary = box.querySelector('.sb-summary');
    const live = box.querySelector('.sb-live');
    live.replaceChildren();
    if (!data || !data.ok) {
      summary.textContent = (data && data.error) || 'Waiting for the StockBlitz dashboard on :8765…';
      return;
    }
    if (data.dashboardUrl && data.dashboardUrl !== DASHBOARD) {
      DASHBOARD = data.dashboardUrl;
      const dash = box.querySelector('.sb-dash');
      if (dash) dash.href = DASHBOARD;
    }
    const counts = {};
    data.lanes.forEach(l => { counts[l.status] = (counts[l.status] || 0) + 1; });
    const wd = data.watchdog || {};
    summary.textContent = (wd.live ? 'watchdog on duty' : 'watchdog off duty') + ' · ' +
      ['running', 'ready', 'blocked', 'done'].map(k => (counts[k] || 0) + ' ' + k).join(' · ');
    const working = data.lanes.filter(l => SHOWN[l.status]).sort((a, b) => (a.status === 'running' ? -1 : 1) - (b.status === 'running' ? -1 : 1));
    working.forEach(l => {
      const row = el('div', 'sb-row');
      row.style.setProperty('--c', LAYER_COLOR[l.layer] || '#ffb547');
      row.append(el('div', 'sb-name', l.name + (l.status === 'ready' ? ' (ready)' : '')));
      if (l.note) row.append(el('div', 'sb-note', l.note));
      live.append(row);
    });
    if (wd.nextAction) live.append(el('div', 'sb-dim', 'last: ' + wd.nextAction));
  }

  // A station terminal showing one live dashboard section (the dashboard's ?embed=1 hides its own chrome).
  function openTerminal(p) {
    if (!term) {
      term = el('div');
      term.id = 'sb-term';
      term.setAttribute('role', 'dialog');
      const bar = el('div', 'sb-bar');
      const title = el('span');
      const close = el('button', null, '×');
      close.setAttribute('aria-label', 'Close terminal');
      close.onclick = () => { term.hidden = true; };
      bar.append(title, close);
      const frame = el('iframe');
      term.append(bar, frame);
      document.body.appendChild(term);
      let drag = null;
      bar.addEventListener('pointerdown', e => {
        if (e.target === close) return;
        const r = term.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        bar.setPointerCapture(e.pointerId);
      });
      bar.addEventListener('pointermove', e => {
        if (!drag) return;
        term.style.left = Math.max(0, e.clientX - drag.dx) + 'px';
        term.style.top = Math.max(0, e.clientY - drag.dy) + 'px';
      });
      bar.addEventListener('pointerup', () => { drag = null; });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && term && !term.hidden) term.hidden = true; });
    }
    term.querySelector('.sb-bar span').textContent = (p.place + ' · ' + p.title).toUpperCase();
    // A distinct query per place makes the frame reload; the dashboard only reads its hash on load.
    term.querySelector('iframe').src = DASHBOARD + 'index.html?embed=1&place=' + p.hash + '#' + p.hash;
    term.querySelector('iframe').title = p.title;
    term.hidden = false;
  }

  // The station's own mission board and trophy case open the matching dashboard sections.
  function bindProps() {
    const W = world();
    if (!W) return;
    const byHash = h => PLACES.find(p => p.hash === h);
    if (W.setOnMissionBoard) W.setOnMissionBoard(() => openTerminal(byHash('board')));
    if (W.setOnTrophyCase) W.setOnTrophyCase(() => openTerminal(byHash('latest')));
  }

  function syncCrew(data) {
    const W = world();
    if (!W || !W.spawnAgent || !data || !data.ok) return;
    const want = new Map();
    data.lanes.forEach(l => { if (SHOWN[l.status]) want.set(crewId(l.id), l); });
    for (const [id, lane] of want) {
      const had = bodies.get(id);
      if (!had) {
        W.spawnAgent({ id, name: lane.name, color: LAYER_COLOR[lane.layer] || '#ffb547' });
      } else if (had.name !== lane.name && W.relabel) {
        W.relabel(id, lane.name);
      }
      const kind = lane.status === 'running' ? 'task' : 'idle';
      if (!had || had.status !== lane.status) W.setActivityFor(id, kind);
      bodies.set(id, { status: lane.status, name: lane.name });
    }
    for (const id of Array.from(bodies.keys())) {
      if (!want.has(id)) { if (W.despawnAgent) W.despawnAgent(id); bodies.delete(id); }
    }
  }

  async function poll() {
    let data = null;
    try {
      const headers = {};
      const tok = token();
      if (tok) headers['X-StarNet-Token'] = tok;
      const r = await fetch('/api/stockblitz/board', { headers, cache: 'no-store' });
      data = await r.json();
    } catch (e) {
      data = { ok: false, error: 'StarNet could not reach its own board route.' };
    }
    try { syncCrew(data); } catch (e) { console.warn('[stockblitz] crew sync failed', e); }
    renderHud(data);
  }

  function start() {
    // app.js wires these props during boot; re-bind after it so ours win.
    [1500, 5000, 12000].forEach(ms => setTimeout(bindProps, ms));
    poll();
    setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

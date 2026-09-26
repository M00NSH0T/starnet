/* stockblitz.js — StockBlitz fork: the StockBlitz work board as crew on the station.

   Polls the sidecar's /api/stockblitz/board (which reads the local StockBlitz dashboard) and gives each
   working or ready lane a body on the floor via World.spawnAgent — never App.summonAgent, so these bodies
   are not StarNet roster agents: no system prompt, no model, nothing persisted to the save or roster.
   Clicking one opens its lane (pause, priority, put an agent on it), and "Ask the crew" queues free text
   for a Claude Code agent. All of it goes through the dashboard's own board API, which the StockBlitz
   watchdog acts on; the station itself runs no agents. */
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
      '#sb-hud{position:fixed;right:14px;bottom:14px;z-index:950;width:min(340px,calc(100vw - 28px));max-height:72vh;overflow:auto;',
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
      '#sb-hud .sb-ask{margin:8px 0;display:flex;flex-direction:column;gap:4px}',
      '#sb-hud .sb-ask label{color:#ffb547;letter-spacing:.14em;font-weight:700}',
      '#sb-hud textarea{background:#140e05;color:#fff3d6;border:1px solid #6b4d1c;font:inherit;padding:4px 6px;resize:vertical}',
      '#sb-hud .sb-ask>button{align-self:flex-start;padding:3px 8px;border-color:#c98a2b}',
      '#sb-hud .sb-askrow{display:block;width:100%;text-align:left;margin-top:3px;padding:3px 6px}#sb-hud .sb-askrow small{display:block;color:#9c865e}',
      '#sb-reader{position:fixed;left:50%;top:10vh;transform:translateX(-50%);z-index:965;width:min(640px,92vw);max-height:76vh;overflow:auto;',
      'background:rgba(12,9,4,.97);border:1px solid #c98a2b;color:#f3d9a4;font:12px/1.5 ui-monospace,Consolas,monospace;padding:12px 16px}',
      '#sb-reader[hidden]{display:none}#sb-reader h4{margin:10px 0 4px;color:#ffb547;letter-spacing:.12em}',
      '#sb-reader pre{white-space:pre-wrap;margin:0;color:#fff3d6;font:inherit}',
      '#sb-reader>button{float:right;background:none;border:1px solid #6b4d1c;color:#f3d9a4;font:inherit;cursor:pointer;min-width:28px}',
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
    body.append(buildAsk(), decks, el('div', 'sb-live'), dash);
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

  // ---- Ask the crew: free text to a Claude Code agent through the StockBlitz watchdog ----
  const ASK_STATUS = { queued: 'waiting for a free agent', running: 'agent working', done: 'answered', failed: 'failed' };
  let askList = null;
  let asks = [];

  function apiHeaders(json) {
    const h = json ? { 'Content-Type': 'application/json' } : {};
    const tok = token();
    if (tok) h['X-StarNet-Token'] = tok;
    return h;
  }

  function buildAsk() {
    const wrap = el('div', 'sb-ask');
    const label = el('label', null, 'ASK THE CREW');
    label.htmlFor = 'sb-ask-text';
    const text = el('textarea');
    text.id = 'sb-ask-text';
    text.rows = 2;
    text.placeholder = 'e.g. Which research lanes are blocked, and why?';
    const send = el('button', null, 'Send to the crew');
    const msg = el('div', 'sb-dim');
    send.onclick = async () => {
      const value = text.value.trim();
      if (!value) { msg.textContent = 'Type a question or request first.'; return; }
      send.disabled = true;
      msg.textContent = 'Sending…';
      try {
        const r = await fetch('/api/stockblitz/ask', { method: 'POST', headers: apiHeaders(true), body: JSON.stringify({ text: value }) });
        const body = await r.json().catch(() => ({}));
        if (!body.ok) throw new Error(body.error || 'the board refused');
        text.value = '';
        msg.textContent = 'Queued. A Claude Code agent picks it up within two minutes.';
        pollAsks();
      } catch (e) {
        msg.textContent = e.message;
      } finally {
        send.disabled = false;
      }
    };
    text.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send.click(); });
    askList = el('div', 'sb-asks');
    wrap.append(label, text, send, msg, askList);
    return wrap;
  }

  function renderAsks() {
    if (!askList) return;
    askList.replaceChildren();
    asks.slice(0, 4).forEach(a => {
      const row = el('button', 'sb-askrow');
      row.append(el('span', 'sb-name', a.text.length > 60 ? a.text.slice(0, 59) + '…' : a.text));
      row.append(el('small', null, ASK_STATUS[a.status] || a.status));
      row.onclick = () => openAnswer(a);
      askList.append(row);
    });
  }

  async function pollAsks() {
    try {
      const r = await fetch('/api/stockblitz/asks', { headers: apiHeaders(false), cache: 'no-store' });
      const body = await r.json();
      if (body.ok) { asks = body.asks || []; renderAsks(); }
    } catch (_) { /* the HUD summary already reports an unreachable board */ }
  }

  let reader = null;
  function openAnswer(a) {
    if (!reader) {
      reader = el('div');
      reader.id = 'sb-reader';
      reader.setAttribute('role', 'dialog');
      document.body.appendChild(reader);
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && reader && !reader.hidden) reader.hidden = true; });
    }
    reader.replaceChildren();
    const close = el('button', null, '×');
    close.setAttribute('aria-label', 'Close reply');
    close.onclick = () => { reader.hidden = true; };
    reader.append(close, el('h4', null, 'YOU ASKED'), el('p', null, a.text));
    reader.append(el('h4', null, 'CREW REPLY · ' + (ASK_STATUS[a.status] || a.status).toUpperCase()));
    const pre = el('pre', null, a.answer || (a.status === 'done' || a.status === 'failed' ? '(no reply was saved)' : 'Not answered yet. This updates when the agent finishes.'));
    reader.append(pre);
    if (a.answer_truncated) reader.append(el('p', 'sb-dim', 'Reply shortened here; the full text is in outputs/task_watchdog/owner_asks/' + a.id + '.answer.md'));
    reader.hidden = false;
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

  // The station's own mission board and trophy case open the matching dashboard sections; the bridge
  // hologram and the StockBlitz crew go through World.setOverlay.
  function bindProps() {
    const W = world();
    if (!W) return;
    const byHash = h => PLACES.find(p => p.hash === h);
    if (W.setOnMissionBoard) W.setOnMissionBoard(() => openTerminal(byHash('board')));
    if (W.setOnTrophyCase) W.setOnTrophyCase(() => openTerminal(byHash('latest')));
    if (W.setOverlay) {
      const globe = typeof StockBlitzGlobe !== 'undefined' ? StockBlitzGlobe : null;
      W.setOverlay(
        env => {
          // The overlay only runs once the floor geometry exists, so crew spawned from here get real feet.
          if (!floorReady) { floorReady = true; if (lastBoard) syncCrew(lastBoard); }
          return globe ? globe.items(env, token()) : [];
        },
        (click) => {
          if (click.agentId && String(click.agentId).startsWith('sb-')) { openLane(click.agentId); return true; }
          if (!click.agentId && globe && globe.hit(click.wp)) { openTerminal(byHash('worldtwin')); return true; }
          return false;
        },
      );
    }
  }

  // ---- lane control panel: click a StockBlitz crew member ----
  let lanePanel = null;
  let laneOpen = null;   // crew id currently shown
  let laneMsg = '';      // survives the 5s repaint
  const lanesById = new Map();   // crew id -> lane

  async function laneAction(lane, action, value) {
    const headers = { 'Content-Type': 'application/json' };
    const tok = token();
    if (tok) headers['X-StarNet-Token'] = tok;
    const r = await fetch('/api/stockblitz/lane', { method: 'POST', headers, body: JSON.stringify({ id: lane.id, action, value }) });
    const body = await r.json().catch(() => ({}));
    if (!body.ok) throw new Error(body.error || 'the board refused');
  }

  function openLane(id) {
    laneOpen = id;
    laneMsg = '';
    if (!lanePanel) {
      lanePanel = el('div');
      lanePanel.id = 'sb-lane';
      lanePanel.setAttribute('role', 'dialog');
      document.body.appendChild(lanePanel);
      const style = el('style');
      style.textContent = [
        '#sb-lane{position:fixed;left:50%;top:14vh;transform:translateX(-50%);z-index:955;width:min(380px,92vw);',
        'background:rgba(12,9,4,.95);border:1px solid #c98a2b;color:#f3d9a4;font:12px/1.5 ui-monospace,Consolas,monospace;padding:12px 14px;',
        'box-shadow:0 0 24px rgba(0,0,0,.6)}#sb-lane[hidden]{display:none}',
        '#sb-lane h4{margin:0 0 4px;color:#ffb547;font:700 12px ui-monospace,Consolas,monospace;letter-spacing:.1em}',
        '#sb-lane p{margin:6px 0;color:#c9ad7c}#sb-lane .sb-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}',
        '#sb-lane button{background:none;border:1px solid #c98a2b;color:#f3d9a4;font:inherit;cursor:pointer;padding:4px 8px}',
        '#sb-lane button:hover{background:#2a1c08}#sb-lane button:focus-visible{outline:2px solid #ffb547}',
        '#sb-lane .sb-msg{color:#7ad5c1;min-height:1.4em}',
      ].join('');
      document.head.appendChild(style);
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && lanePanel && !lanePanel.hidden) lanePanel.hidden = true; });
    }
    paintLane();
    lanePanel.hidden = false;
  }

  function paintLane() {
    if (!lanePanel || !laneOpen) return;
    const lane = lanesById.get(laneOpen);
    lanePanel.replaceChildren();
    const close = el('button', null, '×');
    close.style.float = 'right';
    close.setAttribute('aria-label', 'Close lane');
    close.onclick = () => { lanePanel.hidden = true; };
    lanePanel.append(close);
    if (!lane) { lanePanel.append(el('p', null, 'This lane is no longer on the floor.')); return; }
    lanePanel.append(el('h4', null, lane.name.toUpperCase()));
    lanePanel.append(el('p', null, lane.status + ' · ' + lane.layer + ' · priority ' + lane.priority));
    if (lane.plain) lanePanel.append(el('p', null, lane.plain));
    if (lane.note) lanePanel.append(el('p', null, 'Now: ' + lane.note));
    const msg = el('div', 'sb-msg', laneMsg);
    const say = t => { laneMsg = t; msg.textContent = t; };
    const acts = el('div', 'sb-acts');
    const act = (label, action, value, done) => {
      const b = el('button', null, label);
      b.onclick = async () => {
        say('Sending…');
        try { await laneAction(lane, action, value); say(done); poll(); }
        catch (e) { say(e.message); }
      };
      acts.append(b);
    };
    if (lane.priority > 0) act('Pause', 'pause', null, 'Paused. The watchdog stops it on its next check.');
    else act('Resume', 'resume', 50, 'Resumed at priority 50.');
    act('Priority +10', 'priority', Math.min(100, lane.priority + 10), 'Priority raised.');
    act('Priority −10', 'priority', Math.max(0, lane.priority - 10), 'Priority lowered.');
    if (lane.layer === 'research') act('Put an agent on it now', 'agent_now', null, 'Requested. An agent picks it up within two minutes.');
    lanePanel.append(acts, msg);
    const dash = el('a', null, 'Open on the work board');
    dash.href = DASHBOARD + '#board';
    dash.style.cssText = 'display:inline-block;margin-top:8px;color:#ffb547';
    lanePanel.append(dash);
  }

  let floorReady = false;   // spawning before the floor exists parks bodies at the origin, unplaced
  let lastBoard = null;

  function syncCrew(data) {
    const W = world();
    if (data && data.ok) lastBoard = data;
    if (!W || !W.spawnAgent || !data || !data.ok || !floorReady) return;
    const want = new Map();
    lanesById.clear();
    data.lanes.forEach(l => { lanesById.set(crewId(l.id), l); if (SHOWN[l.status]) want.set(crewId(l.id), l); });
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
    if (lanePanel && !lanePanel.hidden) paintLane();
  }

  function start() {
    // app.js wires these props during boot; re-bind after it so ours win.
    [1500, 5000, 12000].forEach(ms => setTimeout(bindProps, ms));
    poll();
    pollAsks();
    setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
    setInterval(() => { if (!document.hidden) pollAsks(); }, 10000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

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
  const bodies = new Map();   // crew id -> { status, name }
  let hud = null;

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
      '#sb-hud button{background:none;border:1px solid #6b4d1c;color:#f3d9a4;font:inherit;cursor:pointer;float:right;padding:0 6px}',
    ].join('');
    document.head.appendChild(style);
    hud = el('div');
    hud.id = 'sb-hud';
    hud.setAttribute('aria-live', 'polite');
    document.body.appendChild(hud);
    return hud;
  }

  function renderHud(data) {
    const box = ensureHud();
    box.replaceChildren();
    const collapsed = box.dataset.collapsed === '1';
    const toggle = el('button', null, collapsed ? '+' : '–');
    toggle.setAttribute('aria-label', collapsed ? 'Expand StockBlitz board' : 'Collapse StockBlitz board');
    toggle.onclick = () => { box.dataset.collapsed = collapsed ? '0' : '1'; renderHud(data); };
    box.append(toggle, el('h4', null, 'STOCKBLITZ BOARD'));
    if (!data || !data.ok) {
      box.append(el('div', 'sb-dim', (data && data.error) || 'Waiting for the StockBlitz dashboard on :8765…'));
      return;
    }
    const counts = {};
    data.lanes.forEach(l => { counts[l.status] = (counts[l.status] || 0) + 1; });
    const wd = data.watchdog || {};
    box.append(el('div', 'sb-dim',
      (wd.live ? 'watchdog on duty' : 'watchdog off duty') + ' · ' +
      ['running', 'ready', 'blocked', 'done'].map(k => (counts[k] || 0) + ' ' + k).join(' · ')));
    if (collapsed) return;
    const working = data.lanes.filter(l => SHOWN[l.status]).sort((a, b) => (a.status === 'running' ? -1 : 1) - (b.status === 'running' ? -1 : 1));
    working.forEach(l => {
      const row = el('div', 'sb-row');
      row.style.setProperty('--c', LAYER_COLOR[l.layer] || '#ffb547');
      row.append(el('div', 'sb-name', l.name + (l.status === 'ready' ? ' (ready)' : '')));
      if (l.note) row.append(el('div', 'sb-note', l.note));
      box.append(row);
    });
    if (wd.nextAction) box.append(el('div', 'sb-dim', 'last: ' + wd.nextAction));
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
    poll();
    setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

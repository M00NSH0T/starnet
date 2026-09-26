/* stockblitz-globe.js — StockBlitz fork: the world-twin globe as a hologram on the bridge.

   Draws in world space through World.setOverlay (wired by stockblitz.js), so it depth-sorts with props
   and bodies and picks up the station's lighting, bloom and CRT curve. Data comes from the sidecar's
   /api/stockblitz/globe: country points sized by GDP, the largest trade arcs, and shipping chokepoints.
   Clicking the globe opens the full dashboard globe in the Observatory terminal. */
const StockBlitzGlobe = (() => {
  'use strict';
  const TILT = 0.38;              // radians the globe leans toward the viewer
  const SPIN = 0.00012;           // radians per ms
  const REFRESH_MS = 10 * 60 * 1000;
  let data = null;
  let loadedAt = 0;
  let loading = false;
  let anchor = null;              // { cx, cy, r } in world pixels, recomputed each frame

  async function load(token) {
    if (loading) return;
    loading = true;
    try {
      const headers = token ? { 'X-StarNet-Token': token } : {};
      const r = await fetch('/api/stockblitz/globe', { headers, cache: 'no-store' });
      const body = await r.json();
      if (body && body.ok) {
        const maxGdp = Math.max(1, ...body.nodes.map(n => n.gdp || 0));
        const vec = (lat, lon) => {
          const p = lat * Math.PI / 180, l = lon * Math.PI / 180;
          return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
        };
        const byId = new Map();
        const nodes = body.nodes.map(n => {
          const v = { id: n.id, name: n.name, v: vec(n.lat, n.lon), size: 0.35 + 1.1 * Math.sqrt((n.gdp || 0) / maxGdp) };
          byId.set(n.id, v);
          return v;
        });
        const maxUsd = Math.max(1, ...body.arcs.map(a => a.usd || 0));
        const arcs = body.arcs.map((a, i) => ({ a: byId.get(a.src).v, b: byId.get(a.dst).v, w: 0.25 + 0.75 * (a.usd / maxUsd), phase: i * 0.37 }));
        const chokepoints = body.chokepoints.map(c => ({ name: c.name, v: vec(c.lat, c.lon) }));
        data = { nodes, arcs, chokepoints };
      }
      loadedAt = Date.now();
    } catch (e) {
      loadedAt = Date.now() - REFRESH_MS + 30000;   // retry in 30s
    } finally {
      loading = false;
    }
  }

  // The bridge: the first hab room (the station's main room), else the first room at all.
  function pickAnchor(env) {
    const rooms = env.rooms || [];
    const room = rooms.find(r => r.kind === 'hab') || rooms[0];
    if (!room) return null;
    const w = room.x2 - room.x1, h = room.y2 - room.y1;
    // Upper third of the room, clear of the hero's spot in the middle of the deck.
    const r = Math.max(16, Math.min(40, Math.min(w, h) * 0.22));
    return { cx: (room.x1 + room.x2) / 2, cy: room.y1 + Math.max(r * 1.3, h * 0.3), r };
  }

  function rotate(v, lon0) {
    const s = Math.sin(lon0), c = Math.cos(lon0);
    const x = v[0] * c - v[2] * s, z0 = v[0] * s + v[2] * c, y0 = v[1];
    const y = y0 * Math.cos(TILT) - z0 * Math.sin(TILT);
    const z = y0 * Math.sin(TILT) + z0 * Math.cos(TILT);
    return [x, y, z];
  }

  function slerp(a, b, f) {
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const om = Math.acos(dot);
    if (om < 1e-4) return a;
    const s = Math.sin(om), k1 = Math.sin((1 - f) * om) / s, k2 = Math.sin(f * om) / s;
    return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
  }

  function draw(ctx, now, A, still) {
    const { cx, cy, r } = A;
    const lon0 = still ? 0.6 : now * SPIN;
    const flicker = still ? 1 : 0.9 + 0.1 * Math.sin(now * 0.013) * Math.sin(now * 0.0071);
    const px = (v, lift) => { const k = r * (lift || 1); return [cx + v[0] * k, cy - v[1] * k]; };
    ctx.save();
    // projector pad and light cone
    const baseY = cy + r * 1.35;
    ctx.fillStyle = 'rgba(20,40,60,0.9)';
    ctx.beginPath(); ctx.ellipse(cx, baseY, r * 0.62, r * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(90,220,255,0.8)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.ellipse(cx, baseY, r * 0.62, r * 0.18, 0, 0, Math.PI * 2); ctx.stroke();
    const cone = ctx.createLinearGradient(0, baseY, 0, cy - r);
    cone.addColorStop(0, 'rgba(80,210,255,0.28)'); cone.addColorStop(1, 'rgba(80,210,255,0)');
    ctx.fillStyle = cone;
    ctx.beginPath(); ctx.moveTo(cx - r * 0.55, baseY); ctx.lineTo(cx - r * 1.05, cy); ctx.lineTo(cx + r * 1.05, cy); ctx.lineTo(cx + r * 0.55, baseY); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = flicker;
    // sphere body
    const glow = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.05);
    glow.addColorStop(0, 'rgba(120,230,255,0.28)'); glow.addColorStop(0.8, 'rgba(40,150,220,0.14)'); glow.addColorStop(1, 'rgba(40,150,220,0.02)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,235,255,0.75)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    // graticule (front half only)
    ctx.lineWidth = 0.35; ctx.strokeStyle = 'rgba(120,235,255,0.28)';
    const line = pts => {
      let open = false;
      ctx.beginPath();
      for (const v of pts) {
        const q = rotate(v, lon0);
        if (q[2] < 0) { open = false; continue; }
        const [x, y] = px(q);
        if (open) ctx.lineTo(x, y); else { ctx.moveTo(x, y); open = true; }
      }
      ctx.stroke();
    };
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts = [];
      for (let lon = -180; lon <= 180; lon += 10) { const p = lat * Math.PI / 180, l = lon * Math.PI / 180; pts.push([Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)]); }
      line(pts);
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const pts = [];
      for (let lat = -90; lat <= 90; lat += 10) { const p = lat * Math.PI / 180, l = lon * Math.PI / 180; pts.push([Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)]); }
      line(pts);
    }
    if (data) {
      // countries: bright on the near side, faint through the glass on the far side
      for (const n of data.nodes) {
        const q = rotate(n.v, lon0);
        const [x, y] = px(q);
        const near = q[2] >= 0;
        ctx.fillStyle = near ? 'rgba(170,250,255,0.95)' : 'rgba(120,220,255,0.18)';
        const s = n.size * (near ? 1 : 0.7);
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
      // trade arcs lifted off the surface, with a travelling pulse
      for (const a of data.arcs) {
        const steps = 14;
        const pts = [];
        for (let i = 0; i <= steps; i++) {
          const f = i / steps;
          const q = rotate(slerp(a.a, a.b, f), lon0);
          pts.push({ q, lift: 1 + 0.28 * Math.sin(Math.PI * f) });
        }
        if (pts[0].q[2] < -0.2 && pts[steps].q[2] < -0.2) continue;
        ctx.strokeStyle = 'rgba(255,196,107,' + (0.18 + 0.35 * a.w).toFixed(2) + ')';
        ctx.lineWidth = 0.25 + 0.45 * a.w;
        ctx.beginPath();
        pts.forEach((p, i) => { const [x, y] = px(p.q, p.lift); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.stroke();
        if (!still) {
          const f = ((now * 0.00035 + a.phase) % 1);
          const i = Math.min(steps, Math.floor(f * steps));
          const [x, y] = px(pts[i].q, pts[i].lift);
          ctx.fillStyle = 'rgba(255,230,170,0.95)';
          ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
        }
      }
      // chokepoints
      for (const c of data.chokepoints) {
        const q = rotate(c.v, lon0);
        if (q[2] < 0) continue;
        const [x, y] = px(q);
        ctx.strokeStyle = 'rgba(255,120,110,0.9)'; ctx.lineWidth = 0.4;
        ctx.strokeRect(x - 1, y - 1, 2, 2);
      }
    }
    // scanlines
    ctx.globalAlpha = 0.18 * flicker;
    ctx.fillStyle = 'rgba(0,20,30,1)';
    for (let y = cy - r; y < cy + r; y += 1.5) {
      const half = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy)));
      ctx.fillRect(cx - half, y, half * 2, 0.5);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(140,235,255,0.9)';
    ctx.font = '4px monospace'; ctx.textAlign = 'center';
    ctx.fillText(data ? 'WORLD TWIN · LIVE' : 'WORLD TWIN · LINKING…', cx, baseY + r * 0.3 + 4);
    ctx.restore();
  }

  function items(env, token) {
    if (!data || Date.now() - loadedAt > REFRESH_MS) load(token);
    anchor = pickAnchor(env);
    if (!anchor) return [];
    const A = anchor;
    return [{ y: A.cy + A.r * 1.35, draw: ctx => draw(ctx, env.now, A, env.reduceMotion) }];
  }

  function hit(wp) {
    if (!anchor || !wp) return false;
    const dx = wp.x - anchor.cx, dy = wp.y - anchor.cy;
    return dx * dx + dy * dy <= anchor.r * anchor.r * 1.4;
  }

  return { items, hit };
})();

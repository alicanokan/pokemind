// PokeMind cloud backend adapter.
// Intercepts the app's original `/api/*` calls and routes them to Supabase,
// so the same pages run from any static host (GitHub Pages, pokemind.art)
// with one shared world for all players. Include BEFORE the page script.
(function () {
  const SUPA = 'https://ralyyojiwvnsqdnxkfwb.supabase.co/rest/v1';
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhbHl5b2ppd3Zuc3FkbnhrZndiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMzE2NDIsImV4cCI6MjA5MjgwNzY0Mn0.GNB1YMIWt0tswz6FcmuSCwb0tYoUITYpKKEFDgM2bAY'; // public anon key (safe to ship; RLS governs access)
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

  const realFetch = window.fetch.bind(window);
  const j = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  const rowToObj = (r) => ({
    id: r.id, name: r.name, sprite: r.sprite, lat: r.lat, lng: r.lng,
    floor: r.floor || 0, buildingId: r.building_id, buildingName: r.building_name,
    spaceId: r.space_id, ownerId: r.owner_id, ownerName: r.owner_name,
    kind: r.kind || 'wild', createdAt: r.created_at,
  });
  const rowToBld = (r) => ({
    id: r.id, name: r.name, floors: r.floors, polygon: r.polygon, createdAt: r.created_at,
  });
  const rowToSpace = (r) => ({
    id: r.id, name: r.name, ownerId: r.owner_id, ownerName: r.owner_name,
    polygon: r.polygon, lat: r.lat, lng: r.lng,
    wifiSsid: r.wifi_ssid, wifiPass: r.wifi_pass, createdAt: r.created_at,
  });

  async function getState(key) {
    const r = await realFetch(`${SUPA}/pokemind_state?key=eq.${key}&select=value`, { headers: H });
    const rows = await r.json();
    return (rows[0] && rows[0].value) || {};
  }
  async function setState(key, value) {
    await realFetch(`${SUPA}/pokemind_state?on_conflict=key`, {
      method: 'POST',
      headers: { ...H, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });
  }

  window.fetch = async function (input, init = {}) {
    const raw = typeof input === 'string' ? input : input.url;
    let path;
    try { path = new URL(raw, location.href).pathname; } catch { path = raw; }
    if (!path.startsWith('/api/') && !path.includes('/api/')) return realFetch(input, init);
    path = path.slice(path.indexOf('/api/')); // tolerate subpath hosting
    const method = (init.method || 'GET').toUpperCase();

    try {
      // ---- objects ----
      // /api/objects            -> wild world objects (no space)
      // /api/objects?space=ID   -> that space's artworks
      // /api/objects?all=1      -> everything (admin)
      if (path === '/api/objects' && method === 'GET') {
        const q = new URL(raw, location.href).searchParams;
        let filter = '&space_id=is.null';
        if (q.get('space')) filter = `&space_id=eq.${encodeURIComponent(q.get('space'))}`;
        else if (q.get('all')) filter = '';
        const r = await realFetch(`${SUPA}/pokemind_objects?select=*&order=created_at${filter}`, { headers: H });
        return j((await r.json()).map(rowToObj));
      }
      if (path === '/api/objects' && method === 'POST') {
        const b = JSON.parse(init.body || '{}');
        const r = await realFetch(`${SUPA}/pokemind_objects`, {
          method: 'POST',
          headers: { ...H, Prefer: 'return=representation' },
          body: JSON.stringify({
            name: String(b.name).slice(0, 40),
            sprite: String(b.sprite).slice(0, 300),
            lat: Number(b.lat), lng: Number(b.lng),
            floor: Math.max(0, Math.floor(Number(b.floor) || 0)),
            building_id: b.buildingId || null,
            building_name: b.buildingName || null,
            space_id: b.spaceId || null,
            owner_id: b.ownerId || null,
            owner_name: b.ownerName ? String(b.ownerName).slice(0, 40) : null,
            kind: b.kind === 'artwork' ? 'artwork' : 'wild',
          }),
        });
        return j(rowToObj((await r.json())[0]), 201);
      }
      if (path.startsWith('/api/objects/') && method === 'DELETE') {
        const id = path.slice('/api/objects/'.length);
        await realFetch(`${SUPA}/pokemind_objects?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: H });
        return j({ deleted: 1 });
      }

      // ---- buildings ----
      if (path === '/api/buildings' && method === 'GET') {
        const r = await realFetch(`${SUPA}/pokemind_buildings?select=*&order=created_at`, { headers: H });
        return j((await r.json()).map(rowToBld));
      }
      if (path === '/api/buildings' && method === 'POST') {
        const b = JSON.parse(init.body || '{}');
        const r = await realFetch(`${SUPA}/pokemind_buildings`, {
          method: 'POST',
          headers: { ...H, Prefer: 'return=representation' },
          body: JSON.stringify({
            name: String(b.name).slice(0, 60),
            floors: Math.max(1, Math.min(100, Math.floor(Number(b.floors) || 1))),
            polygon: b.polygon,
          }),
        });
        return j(rowToBld((await r.json())[0]), 201);
      }
      if (path.startsWith('/api/buildings/') && method === 'DELETE') {
        const id = path.slice('/api/buildings/'.length);
        await realFetch(`${SUPA}/pokemind_buildings?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: H });
        return j({ deleted: 1 });
      }

      // ---- spaces (claimed territories / homes) ----
      if (path === '/api/spaces' && method === 'GET') {
        const r = await realFetch(`${SUPA}/pokemind_spaces?select=*&order=created_at.desc`, { headers: H });
        return j((await r.json()).map(rowToSpace));
      }
      if (path === '/api/spaces' && method === 'POST') {
        const b = JSON.parse(init.body || '{}');
        const r = await realFetch(`${SUPA}/pokemind_spaces`, {
          method: 'POST',
          headers: { ...H, Prefer: 'return=representation' },
          body: JSON.stringify({
            name: String(b.name || 'My space').slice(0, 60),
            owner_id: b.ownerId || null,
            owner_name: b.ownerName ? String(b.ownerName).slice(0, 40) : null,
            polygon: b.polygon || null,
            lat: Number(b.lat), lng: Number(b.lng),
            wifi_ssid: b.wifiSsid ? String(b.wifiSsid).slice(0, 64) : null,
            wifi_pass: b.wifiPass ? String(b.wifiPass).slice(0, 64) : null,
          }),
        });
        return j(rowToSpace((await r.json())[0]), 201);
      }
      if (path.startsWith('/api/spaces/') && method === 'GET') {
        const id = path.slice('/api/spaces/'.length);
        const r = await realFetch(`${SUPA}/pokemind_spaces?id=eq.${encodeURIComponent(id)}&select=*`, { headers: H });
        const rows = await r.json();
        return rows[0] ? j(rowToSpace(rows[0])) : j({ error: 'space not found' }, 404);
      }
      if (path.startsWith('/api/spaces/') && method === 'PATCH') {
        const id = path.slice('/api/spaces/'.length);
        const b = JSON.parse(init.body || '{}');
        const patch = {};
        if ('name' in b) patch.name = String(b.name || 'My space').slice(0, 60);
        if ('wifiSsid' in b) patch.wifi_ssid = b.wifiSsid ? String(b.wifiSsid).slice(0, 64) : null;
        if ('wifiPass' in b) patch.wifi_pass = b.wifiPass ? String(b.wifiPass).slice(0, 64) : null;
        const r = await realFetch(`${SUPA}/pokemind_spaces?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { ...H, Prefer: 'return=representation' },
          body: JSON.stringify(patch),
        });
        const rows = await r.json();
        return rows[0] ? j(rowToSpace(rows[0])) : j({ error: 'space not found' }, 404);
      }
      if (path.startsWith('/api/spaces/') && method === 'DELETE') {
        const id = path.slice('/api/spaces/'.length);
        // orphan the space's artworks too — they belong to the home
        await realFetch(`${SUPA}/pokemind_objects?space_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: H });
        await realFetch(`${SUPA}/pokemind_spaces?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: H });
        return j({ deleted: 1 });
      }

      // ---- players (trainer identities) ----
      if (path === '/api/players' && method === 'POST') {
        const b = JSON.parse(init.body || '{}');
        const row = { name: String(b.name || 'Trainer').slice(0, 40) };
        if (b.id) row.id = b.id;
        const r = await realFetch(`${SUPA}/pokemind_players?on_conflict=id`, {
          method: 'POST',
          headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify(row),
        });
        const rows = await r.json();
        return j({ id: rows[0].id, name: rows[0].name }, 201);
      }

      // ---- calibration & settings ----
      if (path === '/api/calibration' && method === 'GET') {
        const [calib, settings] = await Promise.all([getState('calibration'), getState('settings')]);
        return j({ active: false, ...calib, floorHeight: Number(settings.floorHeight) || 3 });
      }
      if (path === '/api/calibration' && method === 'POST') {
        const patch = JSON.parse(init.body || '{}');
        const merged = { ...(await getState('calibration')), ...patch, updatedAt: new Date().toISOString() };
        await setState('calibration', merged);
        return j(merged);
      }
      if (path === '/api/settings' && method === 'GET') {
        const s = await getState('settings');
        return j({ floorHeight: Number(s.floorHeight) || 3 });
      }
      if (path === '/api/settings' && method === 'POST') {
        const b = JSON.parse(init.body || '{}');
        const fh = Number(b.floorHeight);
        const s = await getState('settings');
        if (isFinite(fh) && fh > 0.5 && fh < 20) s.floorHeight = Math.round(fh * 100) / 100;
        await setState('settings', s);
        return j(s);
      }

      // ---- info (only meaningful on the local dev server) ----
      if (path === '/api/info') return j({ lanUrl: location.origin });

      return j({ error: 'unknown api route ' + path }, 404);
    } catch (e) {
      return j({ error: e.message }, 500);
    }
  };

  // escape user-supplied strings before they touch innerHTML anywhere
  window.escHtml = (t) => String(t ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- trainer identity (name + device id, no passwords) ----
  // PokeID.get() -> {id, name} | null      PokeID.ensure(name) -> {id, name}
  const ID_KEY = 'pokemind_player';
  window.PokeID = {
    get() {
      try { return JSON.parse(localStorage.getItem(ID_KEY)) || null; } catch { return null; }
    },
    async ensure(name) {
      let p = this.get();
      const newName = String(name || (p && p.name) || 'Trainer').slice(0, 40).trim() || 'Trainer';
      if (!p) p = { id: crypto.randomUUID(), name: newName };
      else p.name = newName;
      localStorage.setItem(ID_KEY, JSON.stringify(p));
      try {
        await window.fetch('/api/players', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
        });
      } catch {} // offline is fine — identity still works locally
      return p;
    },
  };
})();

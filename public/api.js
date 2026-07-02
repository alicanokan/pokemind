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
    createdAt: r.created_at,
  });
  const rowToBld = (r) => ({
    id: r.id, name: r.name, floors: r.floors, polygon: r.polygon, createdAt: r.created_at,
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
      if (path === '/api/objects' && method === 'GET') {
        const r = await realFetch(`${SUPA}/pokemind_objects?select=*&order=created_at`, { headers: H });
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
})();

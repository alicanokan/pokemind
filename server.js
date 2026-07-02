// PokeMind — zero-dependency Node server
// Serves the AR game + admin map and a tiny JSON API backed by data/objects.json
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data', 'objects.json');
const BUILDINGS_FILE = path.join(ROOT, 'data', 'buildings.json');
const CALIB_FILE = path.join(ROOT, 'data', 'calibration.json');
const SETTINGS_FILE = path.join(ROOT, 'data', 'settings.json');
const HTTP_PORT = Number(process.env.PORT || 8080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
};

function loadList(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
}
function saveList(file, list) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
}
const loadObjects = () => loadList(DATA_FILE);
const saveObjects = (l) => saveList(DATA_FILE, l);
const loadBuildings = () => loadList(BUILDINGS_FILE);
const saveBuildings = (l) => saveList(BUILDINGS_FILE, l);

function lanIP() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'localhost';
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);

  try {
    // --- API ---
    if (p === '/api/objects' && req.method === 'GET') {
      return sendJSON(res, 200, loadObjects());
    }
    if (p === '/api/objects' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!body.name || !body.sprite || !isFinite(lat) || !isFinite(lng)) {
        return sendJSON(res, 400, { error: 'need name, sprite, lat, lng' });
      }
      const obj = {
        id: crypto.randomUUID(),
        name: String(body.name).slice(0, 40),
        sprite: String(body.sprite).slice(0, 300),
        lat, lng,
        floor: Number.isFinite(Number(body.floor)) ? Math.max(0, Math.floor(Number(body.floor))) : 0,
        buildingId: body.buildingId ? String(body.buildingId).slice(0, 60) : null,
        buildingName: body.buildingName ? String(body.buildingName).slice(0, 60) : null,
        createdAt: new Date().toISOString(),
      };
      const list = loadObjects();
      list.push(obj);
      saveObjects(list);
      return sendJSON(res, 201, obj);
    }
    if (p.startsWith('/api/objects/') && req.method === 'DELETE') {
      const id = p.slice('/api/objects/'.length);
      const list = loadObjects();
      const next = list.filter((o) => o.id !== id);
      saveObjects(next);
      return sendJSON(res, 200, { deleted: list.length - next.length });
    }
    // --- buildings ---
    if (p === '/api/buildings' && req.method === 'GET') {
      return sendJSON(res, 200, loadBuildings());
    }
    if (p === '/api/buildings' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      const polygon = Array.isArray(body.polygon)
        ? body.polygon
            .filter(pt => Array.isArray(pt) && isFinite(Number(pt[0])) && isFinite(Number(pt[1])))
            .map(pt => [Number(pt[0]), Number(pt[1])])
        : [];
      const floors = Math.max(1, Math.min(100, Math.floor(Number(body.floors) || 1)));
      if (!body.name || polygon.length < 3) {
        return sendJSON(res, 400, { error: 'need name, floors, polygon (>= 3 [lat,lng] points)' });
      }
      const bld = {
        id: crypto.randomUUID(),
        name: String(body.name).slice(0, 60),
        floors,
        polygon,
        createdAt: new Date().toISOString(),
      };
      const list = loadBuildings();
      list.push(bld);
      saveBuildings(list);
      return sendJSON(res, 201, bld);
    }
    if (p.startsWith('/api/buildings/') && req.method === 'DELETE') {
      const id = p.slice('/api/buildings/'.length);
      const list = loadBuildings();
      const next = list.filter((b) => b.id !== id);
      saveBuildings(next);
      return sendJSON(res, 200, { deleted: list.length - next.length });
    }

    // --- height calibration (phone marks a spot, desktop moves a test object up/down) ---
    if (p === '/api/calibration' && req.method === 'GET') {
      let calib = {};
      try { calib = JSON.parse(fs.readFileSync(CALIB_FILE, 'utf8')); } catch {}
      let settings = { floorHeight: 3 };
      try { settings = { floorHeight: 3, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}
      return sendJSON(res, 200, { active: false, ...calib, floorHeight: settings.floorHeight });
    }
    if (p === '/api/calibration' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      let calib = {};
      try { calib = JSON.parse(fs.readFileSync(CALIB_FILE, 'utf8')); } catch {}
      const allowed = ['active', 'lat', 'lng', 'height', 'sprite', 'userLat', 'userLng'];
      for (const k of allowed) if (k in body) calib[k] = body[k];
      calib.updatedAt = new Date().toISOString();
      saveList(CALIB_FILE, calib); // saveList just JSON-writes; object is fine
      return sendJSON(res, 200, calib);
    }
    if (p === '/api/settings' && req.method === 'GET') {
      let settings = { floorHeight: 3 };
      try { settings = { floorHeight: 3, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}
      return sendJSON(res, 200, settings);
    }
    if (p === '/api/settings' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      let settings = {};
      try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch {}
      const fh = Number(body.floorHeight);
      if (isFinite(fh) && fh > 0.5 && fh < 20) settings.floorHeight = Math.round(fh * 100) / 100;
      saveList(SETTINGS_FILE, settings);
      return sendJSON(res, 200, settings);
    }

    if (p === '/api/info') {
      return sendJSON(res, 200, { lanUrl: `https://${lanIP()}:${HTTPS_PORT}` });
    }

    // --- static files ---
    let file = p === '/' ? '/index.html' : p;
    const full = path.normalize(path.join(PUBLIC_DIR, file));
    if (!full.startsWith(PUBLIC_DIR)) {
      res.writeHead(403); return res.end('forbidden');
    }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
}

http.createServer(handler).listen(HTTP_PORT, () => {
  console.log(`HTTP  : http://localhost:${HTTP_PORT}`);
});

const keyFile = path.join(ROOT, 'certs', 'key.pem');
const certFile = path.join(ROOT, 'certs', 'cert.pem');
if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
  https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, handler)
    .listen(HTTPS_PORT, () => {
      console.log(`HTTPS : https://${lanIP()}:${HTTPS_PORT}  (open this on your phone)`);
    });
} else {
  console.log('No certs/key.pem + certs/cert.pem found — HTTPS disabled (phone camera/GPS needs HTTPS).');
}

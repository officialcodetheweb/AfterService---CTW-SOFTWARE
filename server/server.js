/* =====================================================================
   After Service — online licence & update server (CTW Software)
   Zero dependencies: Node 18+ only.  Start:  node server.js

   Settings (environment variables):
     ADMIN_TOKEN   long secret password used by the Licence Manager (required)
     PUBKEY        the public licence key, x+y in hex (128 characters) — from the Licence Manager → Settings
     DATA_DIR      where data and update installers are stored (default ./data) — use a persistent disk
     PORT          default 8787

   Nothing the server stores can be forged: licences, cancellations and updates are all signed with
   CTW's private key on the Licence Manager PC. The server checks every signature with PUBKEY before
   accepting it, and After Service checks them again before acting on them.
   ===================================================================== */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = +process.env.PORT || 8787;
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const ADMIN = String(process.env.ADMIN_TOKEN || '');
const REL = path.join(DATA, 'releases'), DB = path.join(DATA, 'db.json');
fs.mkdirSync(REL, { recursive: true });
if (ADMIN.length < 16) console.warn('⚠  ADMIN_TOKEN is missing or shorter than 16 characters — the admin API is switched off until it is set.');

let pub = null;
function setPub(hex) {
  hex = String(hex || '').trim().toLowerCase(); if (!/^[0-9a-f]{128}$/.test(hex)) return false;
  try { pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(hex.slice(0, 64), 'hex').toString('base64url'), y: Buffer.from(hex.slice(64), 'hex').toString('base64url') }, format: 'jwk' }); return true; } catch { return false; }
}

/* ---------- tiny JSON database (written atomically) ---------- */
let db = { licences: {}, revokes: {}, devices: {}, release: null, pubkey: null, log: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB, 'utf8')) }; } catch {}
if (process.env.PUBKEY) { if (setPub(process.env.PUBKEY)) db.pubkey = process.env.PUBKEY.toLowerCase(); else console.warn('⚠  PUBKEY is not valid.'); }
else if (db.pubkey) setPub(db.pubkey);
let saveT = null;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { const t = DB + '.tmp'; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, DB); }, 150); };
const log = (msg) => { db.log.unshift({ at: Date.now(), msg }); db.log = db.log.slice(0, 500); save(); };

/* ---------- signed tokens:  PREFIX . base64url(payload) . base64url(signature) ---------- */
function verify(token, prefix) {
  const m = new RegExp('^' + prefix + '\\.([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]{86})$').exec(String(token || '').trim());
  if (!m || !pub) return null;
  const payload = Buffer.from(m[1], 'base64url'), sig = Buffer.from(m[2], 'base64url');
  try { if (!crypto.verify('sha256', payload, { key: pub, dsaEncoding: 'ieee-p1363' }, sig)) return null; } catch { return null; }
  return payload.toString('utf8');
}
const fields = s => Object.fromEntries(String(s).split(';').map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

/* ---------- http helpers ---------- */
const send = (rsp, code, obj, hdr = {}) => { rsp.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...hdr }); rsp.end(JSON.stringify(obj)); };
const readBody = (req, max = 1e6) => new Promise((res, rej) => { const b = []; let n = 0; req.on('data', d => { n += d.length; if (n > max) { rej(new Error('too big')); req.destroy(); } else b.push(d); }); req.on('end', () => res(Buffer.concat(b))); req.on('error', rej); });
const json = async req => { try { return JSON.parse(String(await readBody(req)) || '{}'); } catch { return {}; } };
const isAdmin = req => ADMIN.length >= 16 && crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(String((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))).digest()), Buffer.from(crypto.createHash('sha256').update(ADMIN).digest()));
const hits = new Map();   // simple flood protection per IP
const limited = ip => { const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 60000); h.push(now); hits.set(ip, h); return h.length > 120; };

function licenceView(L) {
  const dev = db.devices[L.hw] || {}, rv = db.revokes[L.id], now = Date.now() / 1000;
  const cancelled = rv && rv.act === 'revoke';
  return { id: L.id, name: L.name, hw: L.hw, exp: L.exp, iss: L.iss, note: L.note || '', created: L.created, updated: L.updated,
    status: cancelled ? 'cancelled' : L.exp <= now ? 'expired' : 'active', lastSeen: dev.lastSeen || null, version: dev.version || null, ip: dev.ip || null, computer: dev.computer || null };
}

const server = http.createServer(async (req, rsp) => {
  const u = new URL(req.url, 'http://x'), ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  try {
    if (u.pathname === '/' || u.pathname === '/health') return send(rsp, 200, { ok: true, service: 'After Service licence server', keys: !!pub, release: db.release ? db.release.version : null });
    if (limited(ip)) return send(rsp, 429, { error: 'Too many requests' });

    /* ---------- for After Service on each computer ---------- */
    if (u.pathname === '/api/checkin' && req.method === 'POST') {
      const b = await json(req), id = String(b.id || '').slice(0, 20), hw = String(b.hw || '').toUpperCase().slice(0, 24);
      if (!/^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/.test(hw)) return send(rsp, 400, { error: 'bad device' });
      db.devices[hw] = { ...(db.devices[hw] || {}), lastSeen: Date.now(), version: String(b.version || '').slice(0, 20), id, ip, computer: String(b.computer || '').slice(0, 60), name: String(b.name || '').slice(0, 80) };
      save();
      const L = db.licences[id], out = { now: Math.floor(Date.now() / 1000) };
      if (L && L.hw === hw) out.key = L.key;                       // the newest licence (an extension is a newer key)
      const rv = db.revokes[id]; if (rv && (!L || L.hw === hw)) out.revoke = rv.token;
      if (db.release && cmpVer(db.release.version, b.version || '0') > 0) out.update = { manifest: db.release.manifest, url: `/releases/${encodeURIComponent(db.release.file)}` };
      return send(rsp, 200, out);
    }
    if (u.pathname.startsWith('/releases/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const name = path.basename(decodeURIComponent(u.pathname.slice(10))), file = path.join(REL, name);
      if (!fs.existsSync(file)) return send(rsp, 404, { error: 'not found' });
      const size = fs.statSync(file).size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      const h = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Disposition': `attachment; filename="${name}"` };
      if (m) { const s = m[1] ? +m[1] : size - +m[2], e = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1; rsp.writeHead(206, { ...h, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': e - s + 1 }); return req.method === 'HEAD' ? rsp.end() : fs.createReadStream(file, { start: s, end: e }).pipe(rsp); }
      rsp.writeHead(200, { ...h, 'Content-Length': size }); return req.method === 'HEAD' ? rsp.end() : fs.createReadStream(file).pipe(rsp);
    }

    /* ---------- for the Licence Manager (CTW) ---------- */
    if (u.pathname.startsWith('/api/admin/')) {
      if (!isAdmin(req)) { log(`refused admin request from ${ip}`); return send(rsp, 401, { error: 'Wrong admin password' }); }
      const p = u.pathname.slice(11);
      if (p === 'status') return send(rsp, 200, { ok: true, keys: !!pub, pubkey: db.pubkey, release: db.release && { version: db.release.version, file: db.release.file, size: db.release.size, notes: db.release.notes, at: db.release.at }, licences: Object.keys(db.licences).length, devices: Object.keys(db.devices).length });
      if (p === 'pubkey' && req.method === 'POST') { const b = await json(req); if (db.pubkey && !b.replace) return send(rsp, 409, { error: 'A public key is already set' }); if (!setPub(b.pubkey)) return send(rsp, 400, { error: 'Not a valid public key' }); db.pubkey = b.pubkey.toLowerCase(); save(); log('public key set'); return send(rsp, 200, { ok: true }); }
      if (!pub) return send(rsp, 409, { error: 'Set the public key first (Licence Manager → Settings → Connect).' });
      if (p === 'licences' && req.method === 'GET') return send(rsp, 200, { licences: Object.values(db.licences).map(licenceView).sort((a, b) => (b.updated || 0) - (a.updated || 0)), devices: db.devices });
      if (p === 'licences' && req.method === 'POST') {
        // add or replace (extend) a licence: the key must be genuine
        const b = await json(req), payload = verify(b.key, 'ASL1'); if (!payload) return send(rsp, 400, { error: 'This licence key is not genuine' });
        const f = fields(payload), prev = db.licences[f.id];
        db.licences[f.id] = { id: f.id, name: f.name || '', hw: f.hw, exp: +f.exp, iss: +f.iss, key: b.key.trim(), note: String(b.note || (prev && prev.note) || '').slice(0, 200), created: (prev && prev.created) || Date.now(), updated: Date.now() };
        save(); log(`${prev ? 'licence updated' : 'licence added'} ${f.id} ${f.name} until ${new Date(+f.exp * 1000).toISOString()}`);
        return send(rsp, 200, { ok: true, licence: licenceView(db.licences[f.id]) });
      }
      if (p === 'revoke' && req.method === 'POST') {
        const b = await json(req), payload = verify(b.token, 'ASR1'); if (!payload) return send(rsp, 400, { error: 'This cancellation is not genuine' });
        const f = fields(payload), prev = db.revokes[f.id];
        if (prev && +prev.ts >= +f.ts) return send(rsp, 409, { error: 'A newer change already exists' });
        db.revokes[f.id] = { token: b.token.trim(), act: f.act, ts: +f.ts }; save(); log(`licence ${f.id} ${f.act === 'revoke' ? 'cancelled' : 'restored'}`);
        return send(rsp, 200, { ok: true });
      }
      if (p.startsWith('release/') && req.method === 'PUT') {
        // upload the installer; header x-manifest = signed update manifest (version, file name, sha256, size, notes)
        const payload = verify(req.headers['x-manifest'], 'ASU1'); if (!payload) return send(rsp, 400, { error: 'This update is not signed by CTW' });
        let man; try { man = JSON.parse(payload); } catch { return send(rsp, 400, { error: 'bad manifest' }); }
        const name = path.basename(decodeURIComponent(p.slice(8))); if (name !== man.file) return send(rsp, 400, { error: 'file name does not match the manifest' });
        const tmp = path.join(REL, '.' + name + '.part'), hash = crypto.createHash('sha256'); let size = 0;
        await new Promise((res, rej) => { const w = fs.createWriteStream(tmp); req.on('data', d => { hash.update(d); size += d.length; }); req.pipe(w); w.on('finish', res); w.on('error', rej); req.on('error', rej); });
        const sha = hash.digest('hex');
        if (sha !== man.sha256 || size !== man.size) { fs.unlinkSync(tmp); return send(rsp, 400, { error: 'The upload was damaged — try again' }); }
        fs.renameSync(tmp, path.join(REL, name));
        // keep only this release and the one before it
        const keep = new Set([name, db.release && db.release.file]); for (const f of fs.readdirSync(REL)) if (!keep.has(f) && !f.startsWith('.')) try { fs.unlinkSync(path.join(REL, f)); } catch {}
        db.release = { version: man.version, file: name, size, sha256: sha, notes: man.notes || '', manifest: req.headers['x-manifest'], at: Date.now() };
        save(); log(`update ${man.version} published (${(size / 1048576).toFixed(1)} MB)`);
        return send(rsp, 200, { ok: true, release: { version: man.version, file: name, size } });
      }
      if (p === 'release' && req.method === 'DELETE') { db.release = null; save(); log('update withdrawn'); return send(rsp, 200, { ok: true }); }
      if (p === 'log') return send(rsp, 200, { log: db.log.slice(0, 200) });
      return send(rsp, 404, { error: 'unknown' });
    }
    send(rsp, 404, { error: 'not found' });
  } catch (e) { send(rsp, 500, { error: String(e.message || e) }); }
});
server.requestTimeout = 0;          // big installer uploads
server.listen(PORT, () => console.log(`After Service licence server on :${PORT} — data in ${DATA}${pub ? '' : ' — waiting for the public key'}`));

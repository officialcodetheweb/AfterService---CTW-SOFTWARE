/* =====================================================================
   After Service ↔ CTW online service
   - checks in now and then (licence id, Device ID, version): CTW sees which licences are in use
   - picks up a licence extension (a newer signed key) and a cancellation (a signed "revoke")
   - downloads a signed update in the background, then installs it when the user says so
   Every message is signed with CTW's private key and checked here with the public key,
   so nobody else (not even someone who took over the server) can cancel, extend or push an update.
   Without internet nothing changes: the licence keeps working until it expires.
   ===================================================================== */
const { app, ipcMain, net } = require('electron');
const path = require('path'), fs = require('fs'), crypto = require('crypto'), os = require('os'), { spawn } = require('child_process');

const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
const fields = s => Object.fromEntries(String(s).split(';').map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));

module.exports = function initOnline({ UD, lic, getWin }) {
  let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'license-pub.json'), 'utf8')); } catch {}
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(path.join(UD, 'online.json'), 'utf8')) }; } catch {}       // override (testing / moved server)
  const SERVER = String(cfg.server || '').replace(/\/+$/, '');
  let pub = null; try { pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(cfg.x, 'hex').toString('base64url'), y: Buffer.from(cfg.y, 'hex').toString('base64url') }, format: 'jwk' }); } catch {}
  const UPD = path.join(UD, 'updates'), REVOKED = path.join(UD, 'license.revoked'), STATE = path.join(UD, 'online.state');
  const send = (ch, x) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, x); };
  let st = {}; try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
  const saveSt = () => { try { fs.writeFileSync(STATE, JSON.stringify(st)); } catch {} };
  let ready = null, busy = false;    // ready = { version, notes, file }

  function verify(token, prefix) {
    const m = new RegExp('^' + prefix + '\\.([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]{86})$').exec(String(token || '').trim());
    if (!m || !pub) return null;
    const payload = Buffer.from(m[1], 'base64url'), sig = Buffer.from(m[2], 'base64url');
    try { return crypto.verify('sha256', payload, { key: pub, dsaEncoding: 'ieee-p1363' }, sig) ? payload.toString('utf8') : null; } catch { return null; }
  }
  // is this licence cancelled? (checked by the licence gate every minute)
  function revokedFor(id) {
    try { const t = fs.readFileSync(REVOKED, 'utf8'), f = fields(verify(t, 'ASR1') || ''); return f.id === id && f.act === 'revoke' ? { ts: +f.ts } : null; } catch { return null; }
  }
  const req = (method, url, body) => new Promise((res, rej) => {
    const r = net.request({ method, url, headers: { 'Content-Type': 'application/json' } });
    const to = setTimeout(() => { r.abort(); rej(new Error('timeout')); }, 20000);
    r.on('response', rsp => { const b = []; rsp.on('data', d => b.push(d)); rsp.on('end', () => { clearTimeout(to); try { res({ code: rsp.statusCode, json: JSON.parse(String(Buffer.concat(b)) || '{}') }); } catch { res({ code: rsp.statusCode, json: {} }); } }); });
    r.on('error', e => { clearTimeout(to); rej(e); });
    if (body) r.write(JSON.stringify(body)); r.end();
  });

  async function checkin() {
    if (!SERVER || !pub || busy) return { skipped: true };
    busy = true;
    try {
      const L = await lic.current(); if (!L) return { skipped: true };
      const r = await req('POST', SERVER + '/api/checkin', { id: L.id, hw: L.hw, version: app.getVersion(), name: L.name, computer: os.hostname() });
      if (r.code !== 200) return { error: 'server ' + r.code };
      const j = r.json; st.last = Date.now(); saveSt();
      // cancellation / restore (newest wins)
      if (j.revoke) {
        const f = fields(verify(j.revoke, 'ASR1') || '');
        if (f.id === L.id && (!st.revTs || +f.ts > st.revTs)) {
          st.revTs = +f.ts; saveSt();
          if (f.act === 'revoke') { fs.writeFileSync(REVOKED, j.revoke.trim()); lic.recheck(); }
          else { try { fs.unlinkSync(REVOKED); } catch {} lic.recheck(); }
        }
      }
      // extension: a newer key for the same licence and computer
      if (j.key && j.key.trim() !== L.key) {
        const f = fields(verify(j.key, 'ASL1') || '');
        if (f.id === L.id && String(f.hw).toUpperCase() === L.hw && +f.exp !== L.exp) { const r2 = await lic.install(j.key.trim()); if (r2.ok) send('online:notice', { kind: 'extended', until: r2.until }); }
      }
      // update
      if (j.update && j.update.manifest) {
        const man = JSON.parse(verify(j.update.manifest, 'ASU1') || 'null');
        if (man && cmpVer(man.version, app.getVersion()) > 0) download(man, SERVER + j.update.url).catch(e => console.log('update download', e.message));
      }
      return { ok: true };
    } catch (e) { return { error: e.message }; } finally { busy = false; }
  }

  /* ---------- updates ---------- */
  let dl = null;
  async function download(man, url) {
    if (dl || (ready && ready.version === man.version)) return;
    fs.mkdirSync(UPD, { recursive: true });
    const file = path.join(UPD, path.basename(man.file)), sha = () => new Promise(r => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => r(h.digest('hex'))).on('error', () => r('')); });
    if (fs.existsSync(file) && fs.statSync(file).size === man.size && await sha() === man.sha256) { ready = { version: man.version, notes: man.notes || '', file }; send('online:update', { ...ready, file: undefined }); return; }
    dl = { version: man.version, got: 0, size: man.size };
    try {
      // resume a half-finished download
      const part = file + '.part', have = fs.existsSync(part) ? fs.statSync(part).size : 0;
      await new Promise((res, rej) => {
        const r = net.request({ method: 'GET', url }); if (have && have < man.size) r.setHeader('Range', `bytes=${have}-`);
        r.on('response', rsp => {
          if (rsp.statusCode !== 200 && rsp.statusCode !== 206) return rej(new Error('server ' + rsp.statusCode));
          const w = fs.createWriteStream(part, { flags: rsp.statusCode === 206 ? 'a' : 'w' }); dl.got = rsp.statusCode === 206 ? have : 0;
          rsp.on('data', d => { w.write(d); dl.got += d.length; if (Math.random() < .02) send('online:progress', { version: man.version, p: dl.got / man.size }); });
          rsp.on('end', () => w.end(res)); rsp.on('error', rej);
        });
        r.on('error', rej); r.end();
      });
      fs.renameSync(part, file);
      if (fs.statSync(file).size !== man.size || await sha() !== man.sha256) { fs.unlinkSync(file); throw new Error('The update download was damaged'); }
      ready = { version: man.version, notes: man.notes || '', file };
      send('online:update', { version: ready.version, notes: ready.notes });
    } finally { dl = null; }
  }
  function installNow() {
    if (!ready || !fs.existsSync(ready.file)) return { error: 'No update is ready' };
    if (process.platform !== 'win32') return { error: 'Updates install on Windows' };
    // the installer updates quietly (it keeps the licence, workspace and settings) and starts After Service again
    const p = spawn(ready.file, ['/S', '--force-run', '--updated'], { detached: true, stdio: 'ignore', windowsHide: false });
    p.unref(); setTimeout(() => app.quit(), 400); return { ok: true };
  }

  ipcMain.handle('online:status', () => ({ server: !!SERVER, last: st.last || null, ready: ready && { version: ready.version, notes: ready.notes }, downloading: dl && { version: dl.version, p: dl.got / dl.size }, version: app.getVersion() }));
  ipcMain.handle('online:check', () => checkin());
  ipcMain.handle('online:install', () => installNow());
  // check in shortly after start, then every 6 hours
  if (SERVER) {
    setTimeout(checkin, 8000); setInterval(checkin, 6 * 3600 * 1000);
    // while locked (expired / cancelled), ask more often, so an extension or a restore opens the app again quickly
    setInterval(() => { if (lic.locked && lic.locked()) checkin(); }, (+process.env.AS_ONLINE_FAST || 120) * 1000);
  }
  // remove the installer of an update that is already installed
  try { for (const f of fs.readdirSync(UPD)) { const v = (f.match(/(\d+\.\d+\.\d+)/) || [])[1]; if (v && cmpVer(v, app.getVersion()) <= 0) fs.unlinkSync(path.join(UPD, f)); } } catch {}
  return { checkin, revokedFor, verify };
};

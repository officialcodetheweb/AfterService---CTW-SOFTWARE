/* =====================================================================
   Hot folder — insert the memory card and walk away.
   New photos are imported, HEIC → JPG, your preset is applied and the
   ready-to-post sizes are saved. Also watches a folder (camera Wi-Fi, phone sync…).
   ===================================================================== */
(function () {
  const A = window.api; if (!A || !A.dev) return;
  const q = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const FIRE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h5l2 2h9v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M13 12l-2 3h3l-2 3"/></svg>';
  const DEF = { on: false, cards: true, phones: false, folder: '', preset: '', formats: ['sq', 'p45', 'st'], skipBad: false, after: 'notify' };
  let C = { ...DEF }, devices = [], queue = [], busy = null, poll = null, lastFolder = '';
  const handled = new Set();      // devices already done this time they were plugged in
  const H = window.HotFolder = { busy: () => !!busy, handles: d => C.on && wants(d) };

  q('#impPhone').insertAdjacentHTML('afterend', `<button id="hotBtn" class="btn imp hot" title="Hot folder: insert a memory card and everything happens by itself">${FIRE}<span>Hot folder</span><i id="hotState">Off</i></button>`);
  q('#hotBtn').onclick = settings;

  const wants = d => d && d.ready !== false && ((d.kind === 'drive' && !d.manual && C.cards) || (d.kind === 'mtp' && C.phones && d.ready));
  async function load() {
    try { const cfg = await bridge.getCfg(); C = { ...DEF, ...((cfg && cfg.hot) || {}) }; } catch {}
    paintBtn(); startFolder();
    if (C.on) { try { gotList(await A.dev.watch()); } catch {} }
  }
  const saveC = () => bridge.saveCfg({ hot: C });
  function paintBtn(txt) {
    const b = q('#hotBtn'), s = q('#hotState'); if (!b) return;
    b.classList.toggle('on', C.on); b.classList.toggle('busy', !!busy);
    s.textContent = txt || (busy ? 'Working…' : C.on ? (C.folder ? 'On · watching' : 'On · waiting for a card') : 'Off');
  }

  /* ---------- noticing cards, phones and new files in the watched folder ---------- */
  function gotList(list) {
    devices = list || [];
    const ids = new Set(devices.map(d => d.id));
    for (const id of [...handled]) if (!id.startsWith('hot:') && !ids.has(id)) handled.delete(id);   // unplugged → next time it runs again
    if (!C.on) return;
    for (const d of devices) if (wants(d) && !handled.has(d.id)) { handled.add(d.id); enqueue({ id: d.id, name: d.name.replace(/\s*\(\w:\)$/, '') }); }
  }
  A.dev.onList(gotList);
  function startFolder() {
    clearInterval(poll); poll = null; lastFolder = '';
    if (!C.on || !C.folder) return;
    // a folder counts as "ready" when the same new files are there two checks in a row (copying has finished)
    poll = setInterval(async () => {
      if (busy || queue.length) return;
      const id = 'hot:' + C.folder; let r; try { r = await A.dev.scan(id); } catch { return; }
      if (!r || r.error) return;
      const fresh = r.files.filter(f => f.isNew && !f.video), sig = fresh.map(f => f.rel + ':' + f.size).join('|');
      if (fresh.length && sig === lastFolder) { lastFolder = ''; enqueue({ id, name: r.dev.name, folder: true }); }
      else lastFolder = sig;
    }, 5000);
  }
  function enqueue(job) { if (busy && busy.id === job.id || queue.some(j => j.id === job.id)) return; queue.push(job); next(); }
  async function next() {
    if (busy || !queue.length) return;
    busy = queue.shift(); paintBtn();
    try { await run(busy); } catch (e) { card({ title: busy.name, line: 'Stopped: ' + (e.message || e), err: true, done: true }); }
    busy = null; paintBtn(); next();
  }

  /* ---------- the hands-off pipeline ---------- */
  async function lookFor(name) {
    if (!name) return { P: { ...S.P }, ov: S.ov, match: S.match, name: 'the look on screen' };
    const pr = (await bridge.listPresets()).find(p => p.name === name);
    if (!pr) return { P: { ...S.P }, ov: S.ov, match: S.match, name: 'the look on screen' };
    let ov = null; if (pr.overlay) { try { ov = { path: pr.overlay.path, bmp: await loadBmp(pr.overlay.path), cx: pr.overlay.cx ?? .5, cy: pr.overlay.cy ?? .85, w: pr.overlay.w ?? .4, op: pr.overlay.op ?? 1 }; } catch {} }
    return { P: { ...zero(), ...pr.params }, ov, match: null, name: '“' + pr.name + '”' };
  }
  async function run(job) {
    const t0 = Date.now();
    card({ title: job.name, line: 'Looking for new photos…', step: 0 });
    const sc = await A.dev.scan(job.id); if (!sc || sc.error) throw new Error((sc && sc.error) || 'Could not read the card');
    const files = sc.files.filter(f => f.isNew);
    if (!files.length) { card({ title: job.name, line: 'No new photos — everything on it was imported before.', done: true, quiet: true }); return; }
    // 1 · import (and HEIC → JPG)
    const off = A.dev.onProgress(p => card({ title: job.name, line: p.phase === 'convert' ? `Converting iPhone photos (HEIC → JPG)…` : `Copying ${p.done} / ${p.total}…`, step: 1, pct: p.total ? p.done / p.total : 0 }));
    const r = await A.dev.import(job.id, files, { dest: sc.dest, convertHeic: true, keepHeic: true, quality: 92 }); if (typeof off === 'function') off();
    if (r.error) throw new Error(r.error);
    if (A.services) A.services.log({ kind: 'import', path: r.dest, label: job.name, count: r.pictures.length, cover: r.pictures[0] });
    let pics = r.pictures.filter(p => /\.(jpe?g|png|webp|bmp)$/i.test(p)), skipped = 0;
    if (!pics.length) { card({ title: job.name, line: `${r.videos.length} video${r.videos.length === 1 ? '' : 's'} imported — no photos to edit.`, done: true, dir: r.dest }); return; }
    // 2 · leave out the bad shots (optional)
    if (C.skipBad && A.cull) {
      card({ title: job.name, line: `Checking ${pics.length} photos for blur, duplicates, closed eyes…`, step: 2 });
      try { const c = await A.cull.start(pics, { level: 'normal' }); if (c && !c.error && c.list) { const rm = new Set(c.list.filter(d => d.suggest === 'remove').map(d => d.path)); skipped = rm.size; pics = pics.filter(p => !rm.has(p)); } } catch {}
    }
    // 3 · apply the preset and save the sizes for posting
    const look = await lookFor(C.preset), d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const { dir } = await bridge.beginExport(`${day} ${job.name} — ready to post`);
    const res = await exportCore(pics, C.formats || [], look, { dir, onItem: (i, n) => card({ title: job.name, line: `Applying ${look.name} · ${i + 1} / ${pics.length}`, step: 3, pct: i / pics.length }) });
    const secs = Math.round((Date.now() - t0) / 1000), took = secs < 60 ? `${Math.max(1, secs)} s` : `${Math.round(secs / 60)} min`;
    card({ title: job.name, line: `${res.ok} photo${res.ok === 1 ? '' : 's'} ready to post${skipped ? ` · ${skipped} weak shots left out` : ''}${res.fail ? ` · ${res.fail} failed` : ''} · ${took}`, done: true, dir, imp: r.dest });
    try { new Notification('After Service — ready to post', { body: `${res.ok} photos from ${job.name} are edited and saved.`, silent: false }); } catch {}
    if (C.after === 'open') bridge.open(dir);
    if (C.after === 'phones' && window.ShareUI) ShareUI.shareFolder(dir);
  }

  /* ---------- the little progress card (bottom right) ---------- */
  function card(o) {
    let c = q('#hotCard'); if (!c) { c = document.createElement('div'); c.id = 'hotCard'; document.body.append(c); }
    const steps = ['Card', 'Import', 'Pick', 'Edit & save'];
    c.className = 'on' + (o.done ? ' done' : '') + (o.err ? ' err' : '');
    c.innerHTML = `<div class="hch">${FIRE}<b>Hot folder · ${esc(o.title)}</b><button class="dpx" id="hcX">×</button></div>
      ${o.done ? '' : `<div class="hsteps">${steps.map((s, i) => i === 2 && !C.skipBad ? '' : `<span class="${i < (o.step || 0) ? 'ok' : i === (o.step || 0) ? 'now' : ''}">${s}</span>`).join('')}</div>`}
      <p>${esc(o.line)}</p>${o.pct != null && !o.done ? `<div class="pbar"><i style="width:${Math.round(o.pct * 100)}%"></i></div>` : ''}
      ${o.done && o.dir ? `<div class="hacts"><button class="ghost" id="hcO">Open folder</button>${o.imp ? `<button class="ghost" id="hcL">Edit them here</button>` : ''}<button class="ghost" id="hcP">Send to phones</button></div>` : ''}`;
    q('#hcX').onclick = () => c.classList.remove('on');
    if (o.done && o.dir) {
      q('#hcO').onclick = () => bridge.open(o.dir);
      if (q('#hcL')) q('#hcL').onclick = () => { const t = document.querySelector('.tab[data-t="pic"]'); if (t) t.click(); loadFolder(o.imp); c.classList.remove('on'); };
      q('#hcP').onclick = () => { if (window.ShareUI) ShareUI.shareFolder(o.dir); };
    }
    clearTimeout(card.t); if (o.done) card.t = setTimeout(() => c.classList.remove('on'), o.quiet ? 6000 : 60000);
    paintBtn(o.done ? null : o.line.length > 26 ? o.line.slice(0, 24) + '…' : o.line);
  }

  /* ---------- settings ---------- */
  async function settings() {
    const presets = await bridge.listPresets().catch(() => []);
    const F = { sq: 'Square 1:1', p45: 'Portrait 4:5', st: 'Story 9:16' };
    const m = modal(`<div class="hotset"><h3>${FIRE} Hot folder</h3>
      <p class="muted">Insert the memory card and walk away: new photos are copied in, iPhone HEIC photos become JPG, your preset is applied and the sizes for posting are saved — all by itself.</p>
      <label class="hsw"><input type="checkbox" id="hOn" ${C.on ? 'checked' : ''}><i></i><b>Hot folder is <span id="hOnT">${C.on ? 'on' : 'off'}</span></b></label>
      <h4>Start when…</h4>
      <label class="chk2"><input type="checkbox" id="hCards" ${C.cards ? 'checked' : ''}> a memory card or camera is plugged in</label>
      <label class="chk2"><input type="checkbox" id="hPhones" ${C.phones ? 'checked' : ''}> a phone is plugged in and unlocked</label>
      <label class="chk2"><input type="checkbox" id="hFold" ${C.folder ? 'checked' : ''}> new photos arrive in a folder</label>
      <div class="hfold"><span id="hFolder" class="muted small">${esc(C.folder || 'No folder chosen — e.g. your camera’s Wi-Fi or phone-sync folder')}</span><button class="ghost" id="hPick">Choose…</button></div>
      <h4>Look</h4>
      <select id="hPreset"><option value="">The look on screen now</option>${presets.map(p => `<option value="${esc(p.name)}" ${p.name === C.preset ? 'selected' : ''}>Preset: ${esc(p.name)}${p.overlay ? ' (with logo)' : ''}</option>`).join('')}</select>
      <h4>Save for posting</h4>
      <div class="hfmt">${Object.entries(F).map(([k, l]) => `<label class="chk2"><input type="checkbox" data-f="${k}" ${(C.formats || []).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <p class="muted small">The full-size edited photo is always saved too. Social sizes are cropped around faces.</p>
      <label class="chk2"><input type="checkbox" id="hBad" ${C.skipBad ? 'checked' : ''}> Leave out blurry, duplicate and closed-eye shots</label>
      <h4>When it’s done</h4>
      <div class="seg2" id="hAfter">${[['notify', 'Just tell me'], ['open', 'Open the folder'], ['phones', 'Send to phones']].map(([k, l]) => `<button data-a="${k}" class="${k === C.after ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="acts"><button class="ghost" id="c">Cancel</button><button class="primary" id="o">Save</button></div></div>`);
    let folder = C.folder, after = C.after;
    m.querySelector('#hOn').onchange = e => { m.querySelector('#hOnT').textContent = e.target.checked ? 'on' : 'off'; };
    m.querySelector('#hPick').onclick = async () => { const d = await bridge.chooseFolder(); if (d) { folder = d; m.querySelector('#hFolder').textContent = d; m.querySelector('#hFold').checked = true; } };
    m.querySelectorAll('#hAfter button').forEach(b => b.onclick = () => { after = b.dataset.a; m.querySelectorAll('#hAfter button').forEach(x => x.classList.toggle('on', x === b)); });
    m.querySelector('#c').onclick = () => m.remove();
    m.querySelector('#o').onclick = async () => {
      const was = C.on;
      C = { ...C, on: m.querySelector('#hOn').checked, cards: m.querySelector('#hCards').checked, phones: m.querySelector('#hPhones').checked,
        folder: m.querySelector('#hFold').checked ? folder : '', preset: m.querySelector('#hPreset').value, skipBad: m.querySelector('#hBad').checked, after,
        formats: [...m.querySelectorAll('[data-f]')].filter(x => x.checked).map(x => x.dataset.f) };
      await saveC(); m.remove(); paintBtn(); startFolder();
      if (C.on && !was) {
        // cards already plugged in count as "inserted" right now
        handled.clear(); try { gotList(await A.dev.watch()); } catch {}
        toast(C.folder && !C.cards ? 'Hot folder is on — watching the folder' : 'Hot folder is on — insert a memory card');
      } else if (!C.on && was) toast('Hot folder is off');
    };
  }

  load();
})();

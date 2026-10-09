/* =====================================================================
   Phone / camera import (cable), HEIC banner, Converter button
   Works on both the Picture and the Video side.
   ===================================================================== */
(function () {
  const A = window.api; if (!A || !A.dev) return;
  const q = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const human = n => n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B';
  const PHONE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/><path d="M12 7v6m-2.5-2.5L12 13l2.5-2.5"/></svg>';
  const CONV = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/></svg>';
  let devices = [], dlg = null, seen = new Set(), readyOnce = new Set(), importing = false;

  /* ---------- buttons ---------- */
  q('#openPlayer').insertAdjacentHTML('afterend', `<button id="openConverter" class="ghost plbtn cvbtn" title="Open After Service Converter — HEIC, JPG, PNG, ICO, MOV, MP4, MP3…">${CONV}Converter</button>`);
  q('#openConverter').onclick = () => A.openConverter([]);
  A.converterInstalled().then(ok => { if (!ok) q('#openConverter').style.display = 'none'; });
  q('#pickFolder').insertAdjacentHTML('afterend', `<button id="impPhone" class="btn imp">${PHONE} Import from phone / camera</button><div id="heicBanner"></div>`);
  q('#impPhone').onclick = () => openImport();
  const tools = q('#vid .vtools .tools');
  if (tools) tools.insertAdjacentHTML('afterend', `<div class="vimp"><button class="ghost" id="vImport">${PHONE} Import from phone</button><button class="ghost" id="vConvert">${CONV} Convert files</button></div>`);
  if (q('#vImport')) { q('#vImport').onclick = () => openImport('vid'); q('#vConvert').onclick = () => A.openConverter([]); }

  /* ---------- HEIC banner on the picture side ---------- */
  window.onFolderLoaded = async dir => {
    const b = q('#heicBanner'); b.innerHTML = ''; b.classList.remove('on');
    const n = await A.dev.heicCount(dir); if (!n) return;
    b.classList.add('on');
    b.innerHTML = `<b>${n} iPhone picture${n === 1 ? '' : 's'} (HEIC)</b><span>HEIC can't be edited directly. Convert to JPG — originals are kept in “HEIC originals”.</span><button class="primary sm" id="heicGo">Convert to JPG</button>`;
    q('#heicGo').onclick = async () => {
      const btn = q('#heicGo'); btn.disabled = true; btn.textContent = 'Converting 0 / ' + n;
      const off = A.dev.onHeicProgress(p => { if (q('#heicGo')) q('#heicGo').textContent = `Converting ${p.done} / ${p.total}`; });
      const r = await A.dev.convertHeic(dir, true); if (typeof off === 'function') off();
      toast(`${r.ok} picture${r.ok === 1 ? '' : 's'} converted to JPG` + (r.fail.length ? ` · ${r.fail.length} failed` : ''));
      loadFolder(dir);
    };
  };

  /* ---------- "phone connected" pop-up ---------- */
  function pop(dev) {
    if (importing || dlg) return;
    if (window.HotFolder && HotFolder.handles(dev)) return;      // the hot folder takes care of it
    let p = q('#devPop'); if (!p) { p = document.createElement('div'); p.id = 'devPop'; document.body.append(p); }
    p.innerHTML = `<div class="dpi">${PHONE}</div><div class="dpt"><b>${esc(dev.name)} connected</b><span>${dev.ready ? 'Import its pictures and videos?' : dev.apple ? 'Unlock it and tap “Trust” — then Import.' : 'Unlock it and choose “File transfer” — then Import.'}</span></div><button class="primary sm" id="dpGo">Import</button><button class="dpx" id="dpX">×</button>`;
    p.classList.add('on');
    q('#dpGo').onclick = () => { p.classList.remove('on'); openImport(document.querySelector('#vid.on') ? 'vid' : 'pic', dev.id); };
    q('#dpX').onclick = () => p.classList.remove('on');
    clearTimeout(pop.t); pop.t = setTimeout(() => p.classList.remove('on'), 15000);
  }
  function gotList(list) {
    devices = list || [];
    const ids = new Set(devices.map(d => d.id));
    for (const id of [...seen]) if (!ids.has(id)) seen.delete(id);      // unplugged → pop again next time
    for (const d of devices) if (!seen.has(d.id) && !d.manual) { seen.add(d.id); if (d.ready) readyOnce.add(d.id); pop(d); }
    // a phone that was locked when plugged in and is unlocked now: say so straight away
    for (const d of devices) if (d.ready && !readyOnce.has(d.id) && !d.manual) { readyOnce.add(d.id); pop(d); }
    for (const id of [...readyOnce]) if (!ids.has(id)) readyOnce.delete(id);
    const p = q('#devPop'); if (p && p.classList.contains('on') && !devices.some(d => !d.manual)) p.classList.remove('on');
    if (dlg && dlg.step === 'devices') renderDevices();
  }
  A.dev.onList(gotList);
  A.dev.watch().then(gotList);

  /* ---------- import dialog ---------- */
  function shell(html) {
    if (!dlg) {
      const m = document.createElement('div'); m.className = 'mask'; m.innerHTML = '<div class="modal impm"></div>'; document.body.append(m);
      dlg = { m, box: m.querySelector('.impm') };
      m.addEventListener('mousedown', e => { if (e.target === m && !importing) close(); });
    }
    dlg.box.innerHTML = `<button class="impx" title="Close">×</button>` + html;
    dlg.box.querySelector('.impx').onclick = () => { if (importing) A.dev.cancel(); else close(); };
    return dlg.box;
  }
  function close() { if (dlg) dlg.m.remove(); dlg = null; }

  async function openImport(side, devId) {
    side = side || (document.querySelector('#vid.on') ? 'vid' : 'pic');
    shell(''); dlg.side = side;
    devices = await A.dev.list();
    if (devId) return scanDev(devId);
    if (devices.length === 1 && devices[0].ready) return scanDev(devices[0].id);
    renderDevices();
  }
  function renderDevices() {
    dlg.step = 'devices';
    const b = shell(`<h3>Import from phone or camera</h3>
      <p>Plug in the phone with its USB cable. On an iPhone tap <b>Trust</b>, on Android choose <b>File transfer</b>. Memory cards and cameras show up too.</p>
      <div class="devs">${devices.length ? devices.map(d => `<button class="dev ${d.ready ? '' : 'wait'}" data-id="${esc(d.id)}">${PHONE}<span><b>${esc(d.name)}</b><small>${d.kind === 'mtp' ? (d.ready ? 'Phone · ready' : d.apple ? 'iPhone · unlock it and tap Trust — or just click to try' : 'Phone · unlock it and choose File transfer — or just click to try') : d.manual ? 'Folder' : 'Camera / memory card'}</small></span></button>`).join('')
        : `<div class="nodev"><div class="spin"></div>Waiting for a phone or camera…</div>`}</div>
      <div class="acts"><button class="ghost" id="impFolder">Choose a folder instead</button><button class="ghost" id="impWifi">Use Wi-Fi (no cable)</button><span class="sp"></span><button class="ghost" id="impCancel">Cancel</button></div>`);
    b.querySelectorAll('.dev').forEach(x => x.onclick = () => scanDev(x.dataset.id));
    b.querySelector('#impFolder').onclick = async () => { const id = await A.dev.pickFolder(); if (id) scanDev(id); };
    b.querySelector('#impCancel').onclick = close;
    b.querySelector('#impWifi').onclick = () => { close(); window.ShareUI && ShareUI.open('from'); };
  }

  async function scanDev(id) {
    dlg.step = 'scan';
    const dev = devices.find(d => d.id === id) || { name: 'device' };
    shell(`<h3>Looking for pictures and videos…</h3><p>${esc(dev.name)}</p><div class="nodev"><div class="spin"></div><span id="scanN">Reading the device…</span></div>
      <div class="muted small">Phones with thousands of pictures can take a minute.</div>`);
    const off = A.dev.onScanCount(n => { const e = q('#scanN'); if (e) e.textContent = `${n} files found so far…`; });
    const r = await A.dev.scan(id); if (typeof off === 'function') off();
    if (!dlg) return;
    if (r.error) {
      const locked = r.error === 'locked', nophotos = /^nophotos/.test(r.error), apple = dev.apple || /iphone|ipad|apple/i.test(dev.name || '');
      const help = apple ? `<ol class="phelp"><li>Unlock the iPhone and keep it on the home screen.</li><li>When it asks <b>“Trust this computer?”</b> tap <b>Trust</b> and enter the passcode.</li><li>No question on the phone? Unplug the cable and plug it in again.</li><li>Tapped <b>Don’t Trust</b> before? On the iPhone: Settings → General → Transfer or Reset iPhone → Reset → <b>Reset Location &amp; Privacy</b>, then plug in again.</li><li>Still nothing? Install the free <b>Apple Devices</b> app from the Microsoft Store (it adds the iPhone driver to Windows).</li></ol>`
        : `<ol class="phelp"><li>Unlock the phone.</li><li>Swipe down from the top and tap the <b>USB</b> notification (“Charging this device via USB”).</li><li>Choose <b>File transfer</b> (or “Transfer files / Android Auto”). <b>Photo transfer (PTP)</b> also works.</li><li>Samsung: if it asks <b>“Allow access to phone data?”</b>, tap <b>Allow</b>.</li></ol>`;
      shell(`<h3>${locked ? (apple ? 'The iPhone isn’t sharing its photos yet' : 'The phone isn’t sharing its files yet') : nophotos ? 'No photos folder found' : "Couldn't read the device"}</h3>
        ${locked || nophotos ? `${nophotos ? `<p class="muted small">The phone shows: ${esc(r.error.replace(/^nophotos\s*/, '') || 'nothing')}</p>` : ''}${help}` : `<p>${esc(r.error)}</p>`}
        <div class="acts"><button class="ghost" id="b">Back</button><span class="sp"></span><button class="primary" id="t">Try again</button></div>`);
      q('#b').onclick = renderDevices; q('#t').onclick = () => scanDev(id); return;
    }
    options(id, r);
  }

  function options(id, r) {
    dlg.step = 'opts';
    const st = { onlyNew: true, convert: true, keep: false, when: 'all', dest: r.dest, kind: dlg.side === 'vid' ? 'all' : 'all' };
    const pick = () => {
      const now = Date.now(), lim = { today: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })(), d7: now - 7 * 864e5, d30: now - 30 * 864e5 }[st.when] || 0;
      return r.files.filter(f => (!st.onlyNew || f.isNew) && (!lim || new Date(f.mtime).getTime() >= lim) && (st.kind === 'all' || (st.kind === 'pics' ? !f.video : f.video)));
    };
    const draw = () => {
      const sel = pick(), pics = sel.filter(f => !f.video).length, vids = sel.length - pics, heic = sel.filter(f => f.heic).length, size = sel.reduce((a, f) => a + (f.size || 0), 0);
      const newN = r.files.filter(f => f.isNew).length;
      const b = shell(`<h3>${esc(r.dev.name)}</h3>
        <div class="istats"><div><b>${r.files.length}</b><span>on the device</span></div><div><b>${newN}</b><span>new</span></div><div><b>${r.files.filter(f => f.heic).length}</b><span>HEIC</span></div><div><b>${r.files.filter(f => f.video).length}</b><span>videos</span></div></div>
        <div class="iopt">
          <label class="ck2"><input type="checkbox" id="oNew" ${st.onlyNew ? 'checked' : ''}><span>Only new files <small>skip what was imported before</small></span></label>
          <label class="ck2"><input type="checkbox" id="oConv" ${st.convert ? 'checked' : ''}><span>Convert iPhone HEIC pictures to JPG <small>videos and other files are copied as they are</small></span></label>
          <label class="ck2 sub ${st.convert ? '' : 'off'}"><input type="checkbox" id="oKeep" ${st.keep ? 'checked' : ''} ${st.convert ? '' : 'disabled'}><span>Also keep the HEIC originals <small>in a “HEIC originals” folder</small></span></label>
          <div class="irow"><span>Taken</span><div class="seg" id="oWhen">${[['all', 'Any time'], ['today', 'Today'], ['d7', 'Last 7 days'], ['d30', 'Last 30 days']].map(([k, l]) => `<button data-k="${k}" class="${st.when === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <div class="irow"><span>Import</span><div class="seg" id="oKind">${[['all', 'Pictures & videos'], ['pics', 'Pictures only'], ['vids', 'Videos only']].map(([k, l]) => `<button data-k="${k}" class="${st.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <div class="irow"><span>Save to</span><div class="dest" title="${esc(st.dest)}">${esc(st.dest)}</div><button class="ghost" id="oDest">Change</button></div>
        </div>
        <div class="isum">${sel.length ? `<b>${pics}</b> picture${pics === 1 ? '' : 's'} · <b>${vids}</b> video${vids === 1 ? '' : 's'} · ${human(size)}${st.convert && heic ? ` · ${heic} HEIC → JPG` : ''}` : 'Nothing to import with these options.'}</div>
        <div class="acts"><button class="ghost" id="oBack">Back</button><span class="sp"></span><button class="primary" id="oGo" ${sel.length ? '' : 'disabled'}>Import ${sel.length} file${sel.length === 1 ? '' : 's'}</button></div>`);
      b.querySelector('#oNew').onchange = e => { st.onlyNew = e.target.checked; draw(); };
      b.querySelector('#oConv').onchange = e => { st.convert = e.target.checked; draw(); };
      b.querySelector('#oKeep').onchange = e => { st.keep = e.target.checked; };
      b.querySelectorAll('#oWhen button').forEach(x => x.onclick = () => { st.when = x.dataset.k; draw(); });
      b.querySelectorAll('#oKind button').forEach(x => x.onclick = () => { st.kind = x.dataset.k; draw(); });
      b.querySelector('#oDest').onclick = async () => { const d = await A.chooseFolder(st.dest); if (d) { st.dest = d; draw(); } };
      b.querySelector('#oBack').onclick = renderDevices;
      b.querySelector('#oGo').onclick = () => run(id, sel, st);
    };
    draw();
  }

  async function run(id, files, st) {
    dlg.step = 'run'; importing = true;
    shell(`<h3>Importing…</h3><p id="iFile" class="ifile">Starting…</p><div class="ibar"><i id="iBar"></i></div><div class="muted" id="iTxt">0 / ${files.length}</div>
      <div class="acts"><span class="sp"></span><button class="ghost" id="iCancel">Cancel</button></div>`);
    q('#iCancel').onclick = () => { A.dev.cancel(); q('#iCancel').disabled = true; q('#iCancel').textContent = 'Stopping…'; };
    const off = A.dev.onProgress(p => {
      if (!q('#iBar')) return;
      q('#iBar').style.width = (p.total ? p.done / p.total * 100 : 0) + '%';
      q('#iTxt').textContent = p.phase === 'convert' ? `Copied ${p.done} · converting HEIC to JPG…` : `${p.done} / ${p.total} copied` + (p.converted ? ` · ${p.converted} HEIC → JPG` : '') + (p.failed ? ` · ${p.failed} failed` : '');
      if (p.file) q('#iFile').textContent = p.file;
    });
    const r = await A.dev.import(id, files, { dest: st.dest, convertHeic: st.convert, keepHeic: st.keep, quality: 92 });
    if (typeof off === 'function') off(); importing = false;
    if (!dlg) return;
    if (r.error) { shell(`<h3>Import stopped</h3><p>${esc(r.error)}</p><div class="acts"><span class="sp"></span><button class="primary" id="d">Close</button></div>`); q('#d').onclick = close; return; }
    done(r);
  }

  function done(r) {
    dlg.step = 'done';
    const b = shell(`<div class="idone">✓</div><h3>${r.cancelled ? 'Import cancelled' : 'Import complete'}</h3>
      <p><b>${r.copied}</b> file${r.copied === 1 ? '' : 's'} copied${r.converted ? `, <b>${r.converted}</b> HEIC converted to JPG` : ''}.<br><span class="muted">${esc(r.dest)}</span></p>
      ${r.failed.length ? `<details class="ifail"><summary>${r.failed.length} file${r.failed.length === 1 ? '' : 's'} could not be imported</summary>${r.failed.slice(0, 50).map(f => `<div>${esc(f.rel)} — ${esc(f.error)}</div>`).join('')}</details>` : ''}
      <div class="acts"><button class="ghost" id="dOpen">Open folder</button><span class="sp"></span>
        ${r.videos.length ? `<button class="ghost" id="dVid">Add ${r.videos.length} video${r.videos.length === 1 ? '' : 's'} to timeline</button>` : ''}
        ${r.pictures.length ? `<button class="primary" id="dPic">Edit pictures</button>` : `<button class="primary" id="dClose">Done</button>`}</div>`);
    b.querySelector('#dOpen').onclick = () => A.open(r.dest);
    const goTab = t => document.querySelector(`.tab[data-t="${t}"]`).click();
    if (b.querySelector('#dVid')) b.querySelector('#dVid').onclick = () => { close(); goTab('vid'); window.VideoEditor && VideoEditor.addVideos(r.videos); };
    if (b.querySelector('#dPic')) b.querySelector('#dPic').onclick = () => { close(); goTab('pic'); loadFolder(r.dest); };
    if (b.querySelector('#dClose')) b.querySelector('#dClose').onclick = close;
    if (dlg.side === 'vid' && r.videos.length && !r.pictures.length) { /* stay — user picks */ }
  }
  window.ImportUI = { open: openImport };
})();

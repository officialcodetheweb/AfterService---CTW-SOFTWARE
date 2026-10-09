/* =====================================================================
   Auto-cull — review screen (Picture side)
   Finds blurry, closed-eye, duplicate and near-identical photos. Nothing is removed until you say so.
   ===================================================================== */
(function () {
  const A = window.api; if (!A || !A.cull) return;
  const C = A.cull, q = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SPARK = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.9L19 9.7l-4.6 2.6L15.6 18 12 14.8 8.4 18l1.2-5.7L5 9.7l5.2-1.8z"/></svg>';
  const FILTERS = [
    ['remove', 'Suggested to remove', d => d.suggest === 'remove'],
    ['check', 'Worth a look', d => d.suggest === 'check'],
    ['blurry', 'Blurry', d => d.flags.includes('blurry')],
    ['eyes', 'Eyes closed', d => d.flags.includes('eyes')],
    ['similar', 'Similar shots', d => d.group != null],
    ['dup', 'Duplicates', d => d.flags.includes('dup')],
    ['dark', 'Too dark', d => d.flags.includes('dark')],
    ['bright', 'Washed out', d => d.flags.includes('bright')],
    ['all', 'All photos', () => true]
  ];
  const BADGE = { blurry: 'Blurry', eyes: 'Eyes closed', similar: 'Similar', dup: 'Duplicate', dark: 'Dark', bright: 'Washed out' };
  let ov = null, res = null, dec = null, items = new Map(), marks = new Set(), touched = new Map(), filter = 'remove', level = 'normal', keep = 1, folder = '', running = false, lastMove = null, viewIdx = -1, viewList = [];

  q('#impPhone').insertAdjacentHTML('afterend', `<button id="cullBtn" class="btn imp cull">${SPARK} Auto-cull — find bad shots</button>`);
  q('#cullBtn').onclick = () => { if (!S.source || !S.files.length) return toast('Choose a picture folder first'); open(); };

  function open() {
    folder = S.source; touched.clear(); filter = 'remove'; lastMove = null;
    ov = document.createElement('div'); ov.id = 'cullOv'; document.body.append(ov);
    ov.innerHTML = `<div class="cbar"><div class="ctitle">${SPARK}<div><b>Auto-cull</b><small>${esc(folder)}</small></div></div><span class="sp"></span>
      <div class="cseg" id="cLevel" title="How picky the check is">${['gentle', 'normal', 'strict'].map(l => `<button data-l="${l}" class="${l === level ? 'on' : ''}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('')}</div>
      <label class="ckeep">Keep the best <select id="cKeep"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select> of similar shots</label>
      <button class="impx" id="cClose" title="Close (Esc)">×</button></div>
      <div class="cbody" id="cBody"></div>`;
    q('#cKeep').value = keep;
    q('#cClose').onclick = close;
    ov.querySelectorAll('#cLevel button').forEach(b => b.onclick = () => { level = b.dataset.l; ov.querySelectorAll('#cLevel button').forEach(x => x.classList.toggle('on', x === b)); redecide(); });
    q('#cKeep').onchange = e => { keep = +e.target.value; redecide(); };
    document.addEventListener('keydown', keys, true);
    analyze();
  }
  function close() { if (running) C.cancel(); document.removeEventListener('keydown', keys, true); if (ov) ov.remove(); ov = null; }

  async function analyze() {
    running = true;
    q('#cBody').innerHTML = `<div class="cprog"><div class="cring"><i></i></div><h2>Checking your photos…</h2><p id="cpTxt">Starting…</p><div class="ibar"><i id="cpBar"></i></div>
      <p class="muted">Looks for blurry shots, closed eyes, duplicates and near-identical bursts. Everything stays on this computer.</p><button class="ghost" id="cpStop">Stop</button></div>`;
    q('#cpStop').onclick = () => C.cancel();
    const off = C.onProgress(p => {
      if (!q('#cpBar')) return;
      q('#cpBar').style.width = (p.total ? p.done / p.total * 100 : 0) + '%';
      q('#cpTxt').textContent = `${p.done} of ${p.total} photos` + (p.eta != null && p.eta > 3 ? ` · about ${p.eta > 90 ? Math.round(p.eta / 60) + ' min' : p.eta + ' s'} left` : '');
    });
    res = await C.start(S.files.map(f => f.path), { level, keepPerGroup: keep });
    off(); running = false;
    if (!ov) return;
    if (res.error) { q('#cBody').innerHTML = `<div class="cprog"><h2>Could not check the photos</h2><p>${esc(res.error)}</p></div>`; return; }
    items = new Map(res.items.map(i => [i.path, i]));
    apply(res, true);
  }
  async function redecide() { if (!res || running) return; const d = await C.decide({ level, keepPerGroup: keep }); if (d) apply(d, false); }
  function apply(d, first) {
    dec = d; marks = new Set(d.list.filter(x => x.suggest === 'remove').map(x => x.path));
    for (const [p, v] of touched) v ? marks.add(p) : marks.delete(p);      // the user's own choices win
    if (first && !d.counts.remove && d.counts.check) filter = 'check';
    render();
  }

  const thumb = p => { const i = items.get(p); return i && i.thumb ? fileUrl(i.thumb) : fileUrl(p); };
  function render() {
    if (!ov) return;
    const by = new Map(dec.list.map(x => [x.path, x])), c = dec.counts;
    const counts = Object.fromEntries(FILTERS.map(([k, , fn]) => [k, dec.list.filter(fn).length]));
    q('#cBody').innerHTML = `
      <aside class="cside">
        <div class="csum"><b>${c.checked}</b> photos checked${res.faceCheck === false ? '<br><small>Face check unavailable on this PC — blur, duplicates and similar shots still work.</small>' : ''}</div>
        ${FILTERS.map(([k, label]) => counts[k] || k === 'remove' || k === 'all' ? `<button class="cf ${filter === k ? 'on' : ''}" data-f="${k}"><span>${label}</span><em>${counts[k]}</em></button>` : '').join('')}
        <div class="chelp"><b>How it works</b><br>Ticked photos are the ones to remove. Click a photo to tick or untick it, double-click to look closer.<br><br>Closed eyes on their own are never ticked — people may be praying.</div>
      </aside>
      <section class="cmain"><div class="cgrid" id="cGrid"></div></section>
      <div class="cfoot"><span id="cCount"></span><span class="sp"></span>
        <button class="ghost" id="cNone">Untick all</button>
        <button class="ghost" id="cSel" title="Select these in the picture editor">Select in editor</button>
        <button class="ghost dng" id="cDel">Delete…</button>
        <button class="primary" id="cMove">Move to “Rejected” folder</button></div>
      <div class="cundo" id="cUndo"></div>`;
    ov.querySelectorAll('.cf').forEach(b => b.onclick = () => { filter = b.dataset.f; render(); });
    const grid = q('#cGrid'), fn = FILTERS.find(f => f[0] === filter)[2];
    let html = '';
    viewList = [];
    if (filter === 'similar') {
      dec.groups.forEach((g, gi) => {
        const ds = g.map(p => by.get(p)).sort((a, b) => a.rank - b.rank);
        html += `<div class="cgrp"><div class="cgh">Similar shots · ${g.length} photos<span>best ${keep === 1 ? 'one is' : keep + ' are'} kept</span></div><div class="cgr">${ds.map(tile).join('')}</div></div>`;
        viewList.push(...ds.map(x => x.path));
      });
      if (!dec.groups.length) html = empty('No near-identical bursts in this folder.');
    } else {
      const list = dec.list.filter(fn).sort((a, b) => (a.group ?? 1e9) - (b.group ?? 1e9) || a.name.localeCompare(b.name, undefined, { numeric: true }));
      html = list.length ? `<div class="cgr wrap">${list.map(tile).join('')}</div>` : empty(filter === 'remove' ? 'Nothing to remove — this folder looks great.' : 'Nothing here.');
      viewList = list.map(x => x.path);
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.ct').forEach(t => {
      t.onclick = () => toggle(t.dataset.p);
      t.ondblclick = e => { e.preventDefault(); view(viewList.indexOf(t.dataset.p)); };
    });
    q('#cNone').onclick = () => { for (const p of marks) touched.set(p, false); marks.clear(); paintMarks(); };
    q('#cSel').onclick = () => { S.sel = new Set([...marks].filter(p => S.files.some(f => f.path === p))); close(); buildThumbs(); toast(`${S.sel.size} pictures selected`); };
    q('#cMove').onclick = move; q('#cDel').onclick = del;
    paintMarks();
  }
  const empty = t => `<div class="cempty">${SPARK}<b>${t}</b></div>`;
  function tile(d) {
    const tags = d.flags.map(f => `<i class="tg ${f}">${BADGE[f]}</i>`).join('');
    return `<div class="ct ${d.best && d.group != null ? 'best' : ''}" data-p="${esc(d.path)}" title="${esc(d.name + (d.why.length ? '\n' + d.why.join('\n') : ''))}">
      <div class="im" style="background-image:url('${thumb(d.path)}')"></div>
      <span class="ck">✕</span>${d.best && d.group != null ? '<span class="bst">★ Best</span>' : ''}
      <div class="cap"><b>${esc(d.name)}</b><div class="tgs">${tags || '<i class="tg ok">Looks good</i>'}</div></div></div>`;
  }
  function toggle(p) { if (marks.has(p)) { marks.delete(p); touched.set(p, false); } else { marks.add(p); touched.set(p, true); } paintMarks(); }
  function paintMarks() {
    if (!ov) return;
    ov.querySelectorAll('.ct').forEach(t => t.classList.toggle('x', marks.has(t.dataset.p)));
    const n = marks.size; q('#cCount').innerHTML = n ? `<b>${n}</b> photo${n === 1 ? '' : 's'} ticked to remove` : 'Nothing ticked';
    q('#cMove').disabled = q('#cDel').disabled = q('#cSel').disabled = !n;
    const v = q('#cView'); if (v) v.classList.toggle('x', marks.has(viewList[viewIdx]));
  }

  async function move() {
    const paths = [...marks]; if (!paths.length) return;
    const r = await C.reject(paths);
    lastMove = r.moves;
    afterRemove(r.moves.map(m => m.from), `${r.moves.length} photo${r.moves.length === 1 ? '' : 's'} moved to the “Rejected” folder` + (r.failed.length ? ` · ${r.failed.length} could not be moved` : ''), true);
  }
  async function del() {
    const paths = [...marks]; if (!paths.length) return;
    if (!await confirmBox(`Delete ${paths.length} photo${paths.length === 1 ? '' : 's'}?`, 'They go to the Recycle Bin, so you can still get them back from there.')) return;
    const r = await bridge.trash(paths); lastMove = null;
    afterRemove(r.done, `${r.done.length} photo${r.done.length === 1 ? '' : 's'} moved to the Recycle Bin` + (r.failed.length ? ` · ${r.failed.length} could not be deleted` : ''), false);
  }
  function afterRemove(gone, msg, canUndo) {
    const g = new Set(gone);
    dec.list = dec.list.filter(d => !g.has(d.path)); dec.groups = dec.groups.map(x => x.filter(p => !g.has(p))).filter(x => x.length > 1);
    gone.forEach(p => { marks.delete(p); touched.delete(p); });
    dec.counts.checked -= gone.length;
    render(); loadFolder(folder);
    const u = q('#cUndo'); u.innerHTML = `<span>✓ ${esc(msg)}</span>${canUndo ? '<button class="lnk" id="cUndoBtn">Undo</button><button class="lnk" id="cOpenRej">Open Rejected folder</button>' : ''}`; u.classList.add('on');
    if (canUndo) {
      q('#cUndoBtn').onclick = async () => { const n = await C.restore(lastMove); lastMove = null; u.classList.remove('on'); toast(`${n} photo${n === 1 ? '' : 's'} put back`); await loadFolder(folder); if (ov) { close(); open(); } };
      q('#cOpenRej').onclick = () => C.openRejected(folder);
    }
  }

  /* ---------- big preview ---------- */
  function view(i) {
    if (i < 0 || !viewList.length) return;
    viewIdx = (i + viewList.length) % viewList.length;
    const p = viewList[viewIdx], d = dec.list.find(x => x.path === p); if (!d) return;
    let v = q('#cView');
    if (!v) { v = document.createElement('div'); v.id = 'cView'; ov.append(v); }
    const it = items.get(p) || {}, faces = (it.faces || []).filter(f => f.box[2] > .06);
    const sibs = d.group != null ? dec.groups[d.group] || [] : [];
    v.innerHTML = `<div class="vtop"><b>${esc(d.name)}</b><span>${d.why.map(esc).join(' · ') || 'Looks good'}</span><span class="sp"></span><span class="muted">${viewIdx + 1} / ${viewList.length}</span><button class="impx" id="vX">×</button></div>
      <div class="vimg"><button class="vnav l" id="vP">‹</button><div class="vpic"><img src="${fileUrl(p)}">${faces.map(f => `<i class="fbox ${d.flags.includes('eyes') && (f.earL + f.earR) / 2 < .24 ? 'shut' : ''}" style="left:${f.box[0] * 100}%;top:${f.box[1] * 100}%;width:${f.box[2] * 100}%;height:${f.box[3] * 100}%"></i>`).join('')}</div><button class="vnav r" id="vN">›</button></div>
      ${sibs.length > 1 ? `<div class="vstrip">${sibs.map(s => `<img src="${thumb(s)}" class="${s === p ? 'on' : ''} ${marks.has(s) ? 'x' : ''}" data-p="${esc(s)}">`).join('')}</div>` : ''}
      <div class="vact"><span class="muted">← → to move · X to tick / untick · Esc to close</span><span class="sp"></span><button class="primary" id="vT">${marks.has(p) ? 'Keep this photo' : 'Tick to remove'}</button></div>`;
    v.classList.toggle('x', marks.has(p));
    q('#vX').onclick = () => { v.remove(); viewIdx = -1; };
    q('#vP').onclick = () => view(viewIdx - 1); q('#vN').onclick = () => view(viewIdx + 1);
    q('#vT').onclick = () => { toggle(p); view(viewIdx); };
    v.querySelectorAll('.vstrip img').forEach(im => im.onclick = () => { const k = viewList.indexOf(im.dataset.p); if (k >= 0) view(k); });
  }
  function keys(e) {
    if (!ov) return;
    if (!/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !document.querySelector('.mask')) e.stopPropagation();   // the editor's own shortcuts (Delete!) stay off while reviewing
    const v = q('#cView');
    if (e.key === 'Escape') { e.stopPropagation(); if (v) { v.remove(); viewIdx = -1; } else close(); return; }
    if (!v) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); view(viewIdx + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); view(viewIdx - 1); }
    if (e.key.toLowerCase() === 'x' || e.key === ' ') { e.preventDefault(); toggle(viewList[viewIdx]); view(viewIdx); }
  }
  window.CullUI = { open };
})();

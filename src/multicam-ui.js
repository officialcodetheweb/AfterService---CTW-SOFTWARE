/* =====================================================================
   Multi-camera — two or three phones filmed the same service.
   1. pick the recordings → they are lined up by their sound
   2. play them side by side and click (or press 1 / 2 / 3) to switch angles — or let it switch for you
   3. "Put on the timeline": the picture cuts between cameras, the sound stays on one phone
   ===================================================================== */
(function () {
  const A = window.api; if (!A || !A.mc || !window.VideoEditor) return;
  const VE = window.VideoEditor, MC = A.mc, q = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const COL = ['#ff8a1f', '#2f9fe0', '#2fae6b'];
  const ICON = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="10" height="8" rx="1.5"/><path d="M12 10l3-2v6l-3-2"/><rect x="15" y="3" width="7" height="6" rx="1.2" opacity=".7"/><rect x="15" y="15" width="7" height="6" rx="1.2" opacity=".7"/></svg>';
  const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = (t % 60).toFixed(1).padStart(4, '0'); return m + ':' + s; };

  const tb = q('#toBeat') || q('#toCap');
  if (tb) tb.insertAdjacentHTML('afterend', `<button id="toCam" class="tool" title="Line up 2–3 phone recordings by their sound, then switch angles">${ICON}<span>Multi-cam</span></button>`);
  if (q('#toCam')) q('#toCam').onclick = () => open();

  let M = null;
  function open() {
    if (q('#mcOv')) return;
    M = { picks: [], cams: null, cuts: [], t: 0, playing: false, sound: 0 };
    const ov = document.createElement('div'); ov.id = 'mcOv'; document.body.append(ov);
    ov.innerHTML = `<div class="sbar2"><div class="ctitle">${ICON.replace('width="26" height="26"', 'width="22" height="22"')}<div><b>Multi-camera</b><small>Line up phone recordings by their sound, then switch angles</small></div></div><span class="sp"></span><button class="primary" id="mcPut" disabled>Put on the timeline</button><button class="impx" id="mcX">×</button></div><div class="mcbody" id="mcBody"></div>`;
    const keys = e => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || q('.mask')) return;
      if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); return; }
      if (!M.cams) return;
      if (e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); toggle(); }
      const n = +e.key; if (n >= 1 && n <= M.cams.length) { e.preventDefault(); e.stopImmediatePropagation(); cutTo(n - 1); }
    };
    const close = () => { stop(); ov.remove(); document.removeEventListener('keydown', keys, true); M = null; };
    document.addEventListener('keydown', keys, true);
    q('#mcX').onclick = close; q('#mcPut').onclick = put;
    // start with the videos already in the editor
    const vids = [...new Set(VE.state.clips.map(c => c.path))];
    M.picks = vids.slice(0, 3);
    pickStep();
  }

  /* ---------- 1 · choose the recordings ---------- */
  function pickStep() {
    const known = [...new Set([...VE.state.clips.map(c => c.path), ...M.picks])];
    q('#mcBody').innerHTML = `<div class="mcpick"><h3>Which recordings were filmed at the same time?</h3>
      <p class="muted">Pick 2 or 3 — for example the phone on a stand, one at the front, one from the side. They don’t need to start together; their sound lines them up.</p>
      <div class="mclist">${known.map(p => `<label class="mcv ${M.picks.includes(p) ? 'on' : ''}"><input type="checkbox" data-p="${esc(p)}" ${M.picks.includes(p) ? 'checked' : ''}><b>${esc(p.split(/[\\/]/).pop())}</b></label>`).join('') || '<p class="muted">No videos yet.</p>'}</div>
      <div class="acts"><button class="ghost" id="mcAdd">Add recordings…</button><span class="sp"></span><button class="primary" id="mcGo" ${M.picks.length >= 2 ? '' : 'disabled'}>Line them up (${M.picks.length})</button></div></div>`;
    q('#mcBody').querySelectorAll('[data-p]').forEach(x => x.onchange = () => {
      const p = x.dataset.p; if (x.checked) { if (M.picks.length >= 3) { x.checked = false; return toast('Up to 3 cameras'); } M.picks.push(p); } else M.picks = M.picks.filter(y => y !== p); pickStep();
    });
    q('#mcAdd').onclick = async () => { const ps = await A.vid.pickVideos(); for (const p of ps || []) if (!M.picks.includes(p) && M.picks.length < 3) M.picks.push(p); pickStep(); };
    q('#mcGo').onclick = lineUp;
  }

  /* ---------- 2 · line up by sound ---------- */
  async function lineUp() {
    const n = M.picks.length;
    q('#mcBody').innerHTML = `<div class="mcpick center"><div class="ring" id="mcRing"></div><h3 id="mcT">Listening to the recordings…</h3><p class="muted" id="mcS">Comparing their sound to find the same moments</p></div>`;
    const off = MC.onProgress(p => { const s = q('#mcS'); if (!s) return; if (p.step === 'listen') s.textContent = `Listening to recording ${p.i + 1} of ${p.n}…`; if (p.step === 'match') s.textContent = `Matching recording ${p.i + 1} with recording 1…`; });
    const r = await MC.sync(M.picks); if (typeof off === 'function') off();
    if (!M) return;
    if (r.error) { q('#mcBody').innerHTML = `<div class="mcpick"><h3>Could not line them up</h3><p>${esc(r.error)}</p><div class="acts"><button class="ghost" id="mcBack">Back</button></div></div>`; q('#mcBack').onclick = pickStep; return; }
    if (r.end - r.start < 2) { q('#mcBody').innerHTML = `<div class="mcpick"><h3>These recordings don’t overlap</h3><p>No moment was found that all of them recorded. Were they filmed at the same time?</p><div class="acts"><button class="ghost" id="mcBack">Back</button></div></div>`; q('#mcBack').onclick = pickStep; return; }
    M.sync = r; M.D = r.end - r.start; M.T0 = r.start;
    // load each camera so it can be shown (uses the editor's smooth-playback copies)
    q('#mcT').textContent = 'Getting the cameras ready…';
    M.cams = [];
    for (let i = 0; i < r.cams.length; i++) {
      const c = r.cams[i], m = await VE.loadMedia(c.path, 'video');
      M.cams.push({ ...c, name: m.name, src: m.src || c.path, color: COL[i] });
    }
    // the sound: the recording that is loudest and clearest is usually the one closest to the pulpit — start with camera 1
    M.sound = 0; M.cuts = [{ t: 0, cam: 0 }]; M.t = 0;
    switcher();
  }

  /* ---------- 3 · switch angles ---------- */
  function switcher() {
    const weak = M.cams.filter(c => c.conf < 1.4);
    q('#mcBody').innerHTML = `<div class="mcsw">
      <div class="mcprog"><canvas id="mcPgm"></canvas><div class="mclabel" id="mcLab"></div></div>
      <div class="mcangles">${M.cams.map((c, i) => `<button class="mca" data-i="${i}" style="--c:${c.color}"><video muted playsinline preload="auto" src="${VE.mediaUrl(c.src)}"></video><span><b>${i + 1}</b> ${esc(c.name)}</span><em>${c.off === 0 ? 'reference' : (c.off > 0 ? 'started ' : 'started ') + Math.abs(c.off).toFixed(2) + ' s ' + (c.off > 0 ? 'earlier' : 'later')}</em></button>`).join('')}</div>
      <div class="mcbar"><button class="mcplay" id="mcPlay"></button><span id="mcTime">0:00.0</span><div class="mccuts" id="mcCuts"></div><span class="muted small">${fmt(M.D)}</span></div>
      <div class="mctools">
        <span>Sound from</span><div class="seg2" id="mcSnd">${M.cams.map((c, i) => `<button data-s="${i}" class="${i === M.sound ? 'on' : ''}">Camera ${i + 1}</button>`).join('')}</div>
        <span class="sp"></span><button class="ghost" id="mcAuto">✨ Switch for me</button><button class="ghost" id="mcClear">Clear switches</button>
      </div>
      <p class="muted small">Play, then click an angle (or press <b>1</b>, <b>2</b>, <b>3</b>) to switch to it at that moment. Click the bar to jump. Right-click a switch on the bar to remove it.${weak.length ? `<br><b style="color:#ffb35c">Camera ${weak.map(c => M.cams.indexOf(c) + 1).join(' & ')} may not be lined up exactly — check that mouths match the sound.</b>` : ''}</p></div>`;
    M.vids = [...q('#mcBody').querySelectorAll('.mca video')];
    q('#mcBody').querySelectorAll('.mca').forEach(b => b.onclick = () => cutTo(+b.dataset.i));
    q('#mcPlay').onclick = toggle;
    q('#mcSnd').querySelectorAll('button').forEach(b => b.onclick = () => { M.sound = +b.dataset.s; q('#mcSnd').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); syncVids(true); });
    q('#mcAuto').onclick = autoSwitch;
    q('#mcClear').onclick = () => { M.cuts = [{ t: 0, cam: M.cuts[0].cam }]; drawCuts(); paint(); };
    const bar = q('#mcCuts');
    bar.onclick = e => { const r = bar.getBoundingClientRect(); M.t = clamp((e.clientX - r.left) / r.width * M.D, 0, M.D); syncVids(true); paint(); };
    bar.oncontextmenu = e => { e.preventDefault(); const r = bar.getBoundingClientRect(), t = (e.clientX - r.left) / r.width * M.D; const k = M.cuts.findIndex((c, i) => i > 0 && Math.abs(c.t - t) < M.D * .01); if (k > 0) { M.cuts.splice(k, 1); drawCuts(); paint(); } };
    M.vids.forEach(v => v.addEventListener('loadeddata', () => { syncVids(true); paint(); }, { once: true }));
    q('#mcPut').disabled = false;
    drawCuts(); paint();
  }
  const fileT = (i, t) => M.T0 + M.cams[i].off + t;
  const camAt = t => { let c = M.cuts[0].cam; for (const x of M.cuts) if (x.t <= t + 1e-6) c = x.cam; return c; };
  function syncVids(force) {
    M.vids.forEach((v, i) => {
      const want = fileT(i, M.t);
      if (force || Math.abs(v.currentTime - want) > .25) { try { v.currentTime = want; } catch {} }
      v.muted = i !== M.sound;
      if (M.playing && v.paused) v.play().catch(() => {}); if (!M.playing && !v.paused) v.pause();
    });
  }
  function cutTo(i) {
    // a switch replaces any switch within half a second (so a quick correction does not leave a flash)
    M.cuts = M.cuts.filter(c => c.t === 0 || Math.abs(c.t - M.t) > .5);
    if (M.t < .3) M.cuts[0].cam = i; else M.cuts.push({ t: M.t, cam: i });
    M.cuts.sort((a, b) => a.t - b.t);
    // drop switches that change nothing
    M.cuts = M.cuts.filter((c, k) => k === 0 || c.cam !== M.cuts[k - 1].cam);
    drawCuts(); paint();
  }
  function toggle() { M.playing ? stop() : play(); }
  function play() {
    if (M.t >= M.D - .05) M.t = 0;
    M.playing = true; q('#mcPlay').classList.add('on'); syncVids(true);
    const loop = () => {
      if (!M || !M.playing) return;
      const sv = M.vids[M.sound]; M.t = sv && !sv.paused ? sv.currentTime - M.T0 - M.cams[M.sound].off : M.t + 1 / 60;
      if (M.t >= M.D) { M.t = M.D; stop(); }
      syncVids(false); paint(); M.raf = requestAnimationFrame(loop);
    };
    M.raf = requestAnimationFrame(loop);
  }
  function stop() { if (!M) return; M.playing = false; cancelAnimationFrame(M.raf); (M.vids || []).forEach(v => { try { v.pause(); } catch {} }); const b = q('#mcPlay'); if (b) b.classList.remove('on'); }
  function paint() {
    const cv = q('#mcPgm'); if (!cv) return;
    const box = cv.parentElement.getBoundingClientRect(), i = camAt(M.t), v = M.vids[i];
    const vw = (v && v.videoWidth) || 16, vh = (v && v.videoHeight) || 9, sc = Math.min(box.width / vw, box.height / vh);
    cv.width = Math.max(2, Math.round(vw * Math.min(1, 960 / vw))); cv.height = Math.round(cv.width * vh / vw);
    cv.style.width = vw * sc + 'px'; cv.style.height = vh * sc + 'px';
    const c = cv.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
    if (v && v.readyState >= 2) c.drawImage(v, 0, 0, cv.width, cv.height);
    q('#mcLab').innerHTML = `<i style="background:${M.cams[i].color}"></i>Camera ${i + 1}`;
    q('#mcTime').textContent = fmt(M.t);
    document.querySelectorAll('.mca').forEach((b, k) => b.classList.toggle('live', k === i));
    const ph = q('#mcPh'); if (ph) ph.style.left = (M.t / M.D * 100) + '%';
  }
  function drawCuts() {
    const bar = q('#mcCuts'); if (!bar) return;
    bar.innerHTML = M.cuts.map((c, k) => { const e = k + 1 < M.cuts.length ? M.cuts[k + 1].t : M.D; return `<i style="left:${c.t / M.D * 100}%;width:${(e - c.t) / M.D * 100}%;background:${M.cams[c.cam].color}" title="Camera ${c.cam + 1} · ${fmt(c.t)}"></i>`; }).join('') + '<b id="mcPh"></b>';
  }

  /* ---------- automatic switching ---------- */
  async function autoSwitch() {
    stop();
    const btn = q('#mcAuto'); btn.disabled = true; btn.textContent = 'Watching the cameras… 0%';
    const acts = []; let k = 0;
    const off = MC.onProgress(p => { if (p.step === 'look' && btn) btn.textContent = `Watching the cameras… ${Math.round((k + p.p) / M.cams.length * 100)}%`; });
    for (k = 0; k < M.cams.length; k++) {
      const r = await MC.activity(M.cams[k].path, fileT(k, 0), fileT(k, M.D), 'cam' + k);
      acts.push(Array.isArray(r) ? r.map(s => ({ t: s.t - M.T0 - M.cams[k].off, face: s.face, mar: s.mar })) : []);
    }
    if (typeof off === 'function') off();
    if (!M) return;
    M.cuts = planCuts(acts, M.D); drawCuts(); paint();
    btn.disabled = false; btn.textContent = '✨ Switch for me';
    toast(`${M.cuts.length - 1} switches made — play it, and click an angle to change any of them`);
  }
  // close-ups of whoever is talking, a wide shot now and then, no shot shorter than 4 s (wide 6 s) or longer than 14 s
  function planCuts(acts, D) {
    const n = acts.length, score = (k, t) => {
      const w = acts[k].filter(s => Math.abs(s.t - t) <= 2); if (!w.length) return 0;
      const face = w.reduce((a, s) => a + s.face, 0) / w.length, m = w.reduce((a, s) => a + s.mar, 0) / w.length;
      const sd = Math.sqrt(w.reduce((a, s) => a + (s.mar - m) ** 2, 0) / w.length);
      return face * (1 + sd * 12);
    };
    const avgFace = acts.map(a => a.length ? a.reduce((x, s) => x + s.face, 0) / a.length : 0);
    const wide = avgFace.indexOf(Math.min(...avgFace));
    const best = (t, not) => { let b = -1, bv = -1; for (let k = 0; k < n; k++) { if (k === not) continue; const v = score(k, t); if (v > bv) { bv = v; b = k; } } return b < 0 ? (not + 1) % n : b; };
    let cur = best(1, -1); const cuts = [{ t: 0, cam: cur }]; let start = 0, lastWide = cur === wide ? 0 : -20;
    if (avgFace.every(f => !f)) { for (let t = 8; t < D - 3; t += 8) cuts.push({ t, cam: (cuts.length) % n }); return cuts; }
    for (let t = 1; t < D - 3; t += 1) {
      const len = t - start; if (len < (cur === wide ? 6 : 4)) continue;     // wide shots stay a little longer
      let next = cur;
      if (t - lastWide > 30 && cur !== wide && len >= 4) next = wide;
      else { const b = best(t, -1); if (b !== cur && score(b, t) > score(cur, t) * 1.3 + .005) next = b; else if (len >= 14) next = best(t, cur); }
      if (next !== cur) { cuts.push({ t, cam: next }); cur = next; start = t; if (next === wide) lastWide = t; }
    }
    return cuts;
  }

  /* ---------- put it on the timeline ---------- */
  async function put() {
    stop();
    const st = VE.state;
    if (st.clips.length && !(await confirmBox('Replace the timeline?', 'The videos on the timeline will be replaced by the multi-camera edit. Text, captions and other layers stay.', 'Replace', false))) return;
    const btn = q('#mcPut'); btn.disabled = true; btn.textContent = 'Building…';
    const snd = await MC.extractAudio(M.cams[M.sound].path);
    if (snd.error) { toast(snd.error); btn.disabled = false; btn.textContent = 'Put on the timeline'; return; }
    st.clips.length = 0;
    for (let k = 0; k < M.cuts.length; k++) {
      const c = M.cuts[k], e = k + 1 < M.cuts.length ? M.cuts[k + 1].t : M.D, cam = M.cams[c.cam];
      await VE.addClip(cam.path, fileT(c.cam, c.t), fileT(c.cam, e), { muted: true, cam: c.cam + 1 });
    }
    await VE.addMusic(snd.path);
    if (st.music) Object.assign(st.music, { in: fileT(M.sound, 0), out: fileT(M.sound, M.D), start: 0, vol: 1, fadeIn: 0, fadeOut: 0, name: `Sound · Camera ${M.sound + 1}`, multicam: true });
    VE.refresh(); if (VE.fitZoom) VE.fitZoom(); VE.refresh(); VE.setTime(0);
    const ov = q('#mcOv'); if (ov) q('#mcX').click();
    toast(`Multi-camera edit ready — ${M ? '' : ''}${st.clips.length} shots, sound from one phone`);
  }
  window.MultiCam = { open, planCuts, _m: () => M, _pick: a => { M.picks = a; pickStep(); } };
})();

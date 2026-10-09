/* =====================================================================
   Auto captions + Sermon clip finder (Video side)
   Speech is turned into text on this computer (Whisper) — no internet after the one-time model download.
   ===================================================================== */
(function () {
  const A = window.api; if (!A || !A.speech) return;
  const SP = A.speech, q = s => document.querySelector(s), VE = () => window.VideoEditor;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mmss = t => { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t % 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const mediaUrl = p => 'asmedia://media/' + encodeURIComponent(p);
  const LANGS = [['en', 'English'], ['auto', 'Detect automatically'], ['fr', 'French'], ['es', 'Spanish'], ['pt', 'Portuguese'], ['de', 'German'], ['nl', 'Dutch'], ['it', 'Italian'], ['sw', 'Swahili'], ['yo', 'Yoruba'], ['ha', 'Hausa'], ['ln', 'Lingala'], ['sn', 'Shona'], ['af', 'Afrikaans'], ['am', 'Amharic'], ['ar', 'Arabic'], ['zh', 'Chinese'], ['ko', 'Korean'], ['ru', 'Russian']];
  const langName = c => (LANGS.find(l => l[0] === c) || [, c])[1];
  const STYLES = [['pop', 'Pop', 'GOD IS <i>GOOD</i>'], ['karaoke', 'Karaoke', '<i>God is</i> good'], ['box', 'Box', 'God <i>is</i> good'], ['classic', 'Subtitles', 'God is good'], ['minimal', 'Minimal', 'God is good']];
  const CC = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M10.5 10.2a2.4 2.4 0 1 0 0 3.6M17 10.2a2.4 2.4 0 1 0 0 3.6"/></svg>';
  const SCISS = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.9L19 9.7l-4.6 2.6L15.6 18 12 14.8 8.4 18l1.2-5.7L5 9.7l5.2-1.8z"/></svg>';

  /* ---------- buttons on the Video side ---------- */
  const vimp = q('.vimp');
  if (vimp) { vimp.insertAdjacentHTML('afterend', `<button class="btn imp finder" id="vFind">${SCISS} Find best clips in a sermon</button>`); q('#vFind').onclick = () => ClipFinder.open(); }

  function shell(cls) {
    const m = document.createElement('div'); m.className = 'mask'; m.innerHTML = `<div class="modal ${cls}"></div>`; document.body.append(m);
    return { m, b: m.querySelector('.modal'), close: () => m.remove() };
  }

  /* ---------- speech model (one-time) — downloads by itself with a small bar in the corner ---------- */
  let dlRun = null;
  const Model = {
    async ensure(id) {
      const st = await SP.status();
      if (!st.engine) { toast('The speech engine is missing — reinstall After Service'); return false; }
      if (st.current && !id) return true;
      if (!dlRun) dlRun = download(id || 'base', st).finally(() => { dlRun = null; });
      return dlRun;
    }
  };
  function bar() {
    let b = q('#spPill');
    if (!b) { b = document.createElement('div'); b.id = 'spPill'; document.body.append(b); }
    return b;
  }
  function download(id, st) {
    const m = st.models.find(x => x.id === id) || { label: '', mb: 142 };
    return new Promise(res => {
      const b = bar(); b.className = 'on'; b.dataset.tk = '';
      const paint = (pct, txt, err) => {
        b.innerHTML = `<div class="spi">${CC}</div><div class="spt"><b>${err ? 'Speech model not downloaded' : pct >= 100 ? 'Speech model ready' : 'Getting the speech model · one time'}</b>
          <span>${esc(txt)}</span><div class="spb"><i style="width:${Math.max(2, pct)}%"></i></div></div>
          ${err ? '<button class="lnk" id="spRetry">Retry</button><button class="lnk" id="spFile">Use a file…</button>' : pct >= 100 ? '' : '<button class="spx" id="spStop" title="Cancel">×</button>'}`;
        const st = q('#spStop'); if (st) st.onclick = () => SP.cancelDownload();
        const rt = q('#spRetry'); if (rt) rt.onclick = () => { b.className = ''; Model.ensure(id).then(res); };
        const fl = q('#spFile'); if (fl) fl.onclick = async () => { const r = await SP.import(); if (r && r.error) return toast(r.error); if (r) { paint(100, 'Loaded from your file'); setTimeout(() => b.className = '', 2200); res(true); } };
      };
      paint(0, `${m.label} · ${m.mb} MB — you can keep working`);
      const off = SP.onDownload(p => { const pc = p.got / p.total * 100; paint(pc, `${(p.got / 1048576).toFixed(0)} of ${(p.total / 1048576).toFixed(0)} MB · ${m.label} model`); });
      SP.download(id).then(r => {
        off();
        if (r && r.error) {
          if (r.error === 'cancelled') { b.className = ''; return res(false); }
          paint(0, r.error.length > 90 ? r.error.slice(0, 88) + '…' : r.error, true); b.classList.add('err');
          return res(false);
        }
        paint(100, 'Works without internet from now on'); const tk = b.dataset.tk = String(Date.now()); setTimeout(() => { if (b.dataset.tk === tk) b.className = ''; }, 2600); res(true);
      });
    });
  }

  /* ---------- listen to clips → words go into the shared transcript (captions + Edit by text use it) ---------- */
  async function listen(srcs, opts, onStep) {
    const ve = VE(); let lang = opts.lang, n = 0;
    const todo = srcs.filter(c => c.hasAudio && !c.muted && (opts.force || !ve.hasTranscript(c.path, c.in, c.out)));
    for (let i = 0; i < todo.length; i++) {
      const c = todo[i]; onStep(i, todo.length);
      const r = await SP.transcribe({ path: c.path, in: c.in, dur: c.out - c.in, fileDur: c.srcDur, lang: opts.lang, translate: opts.translate, mode: opts.mode || 'accurate' });
      if (r.error) throw new Error(r.error);
      lang = r.lang || lang;
      ve.addTranscript(c.path, r.segments.flatMap(sg => sg.words), c.in, c.out); n++;
    }
    return { lang, words: ve.mapWords().length, listened: n };
  }
  // whole video files (for Edit by text and the clip finder) — long files use the fast mode
  async function transcribeFiles(paths, ui) {
    const ve = VE(), st = await SP.status(), lang = st.lang;
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i], src = ve.captionSources().find(c => c.path === p), dur = src ? src.srcDur : 0;
      if (ui) ui(i, paths.length, p);
      const r = await SP.transcribe({ path: p, in: 0, dur, fileDur: dur, lang, mode: dur > 600 ? 'fast' : 'accurate' });
      if (r.error) throw new Error(r.error);
      ve.addTranscript(p, r.segments.flatMap(sg => sg.words), 0, Infinity);
    }
  }
  function listeningBox(d, title) {
    d.b.innerHTML = `<div class="cprog small"><div class="cring"></div><h3>${title}</h3><p id="lpTxt">Getting the sound ready</p><div class="ibar"><i id="lpBar"></i></div><p class="muted" id="lpHint"></p><button class="ghost" id="lpStop">Stop</button></div>`;
    const t0 = Date.now(); let step = 0, steps = 1;
    const off = SP.onProgress(p => { const b = q('#lpBar'); if (!b) return; const pct = p.phase === 'listen' ? p.pct : 2, overall = (step + pct / 100) / steps; b.style.width = overall * 100 + '%'; q('#lpTxt').textContent = (steps > 1 ? `Video ${step + 1} of ${steps} · ` : '') + (p.phase === 'listen' ? `writing down the words ${p.pct}%` : 'getting the sound ready'); const el = (Date.now() - t0) / 1000; if (overall > .05) q('#lpHint').textContent = `About ${mmss(Math.max(1, el / overall - el))} left`; });
    return { off, step: (i, n) => { step = i; steps = n; }, stop: fn => d.b.querySelector('#lpStop').onclick = fn };
  }

  /* ---------- Captions dialog ---------- */
  const CaptionsUI = {
    async open(existing) {
      const ve = VE(); if (!ve) return;
      const srcs = ve.captionSources();
      if (!srcs.length) return toast('Add a video to the timeline first');
      if (!srcs.some(c => c.hasAudio && !c.muted)) return toast('These clips have no sound to listen to');
      const st0 = await SP.status();
      if (!st0.engine) return toast('The speech engine is missing — reinstall After Service');
      if (!st0.current) Model.ensure();           // starts the one-time download in the corner while you choose
      const st = st0, d = shell('capm');
      let style = existing ? existing.style : 'pop', lang = existing ? (existing.lang && existing.lang !== 'auto' ? existing.lang : st.lang) : st.lang, translate = false;
      const total = srcs.reduce((a, c) => a + (c.out - c.in), 0);
      const form = () => {
        d.b.innerHTML = `<button class="impx">×</button><div class="caph">${CC}<div><h3>${existing ? 'Listen again' : 'Auto captions'}</h3><p>Listens to your ${srcs.length > 1 ? srcs.length + ' clips' : 'clip'} (${mmss(total)}) and puts the words on screen, word by word. Works offline.</p></div></div>
          <div class="capf">
            <label class="fl"><span>Language spoken</span><select id="cLang">${LANGS.map(([k, v]) => `<option value="${k}"${k === lang ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
            <label class="ck2"><input type="checkbox" id="cTr" ${translate ? 'checked' : ''}><span>Translate into English <small>for preaching in another language</small></span></label>
          </div>
          ${existing ? '' : `<div class="capstyles">${STYLES.map(([k, l, demo]) => `<button data-st="${k}" class="${k === style ? 'on' : ''}"><b class="cs-${k}">${demo}</b><span>${l}</span></button>`).join('')}</div>`}
          <div class="capmodel">Speech model: <b>${esc((st.models.find(m => m.id === (st.current || 'base')) || {}).label || '')}</b>${st.current ? ' <button class="lnk" id="cMod">change</button>' : ' — downloading (see the bar at the bottom)'}</div>
          <div class="acts"><button class="ghost" id="cX">Cancel</button><button class="primary" id="cGo">${existing ? 'Listen again' : 'Create captions'}</button></div>`;
        d.b.querySelector('.impx').onclick = d.b.querySelector('#cX').onclick = d.close;
        d.b.querySelector('#cLang').onchange = e => { lang = e.target.value; SP.setLang(lang); };
        d.b.querySelector('#cTr').onchange = e => translate = e.target.checked;
        d.b.querySelectorAll('[data-st]').forEach(x => x.onclick = () => { style = x.dataset.st; d.b.querySelectorAll('[data-st]').forEach(y => y.classList.toggle('on', y === x)); });
        const cm = d.b.querySelector('#cMod'); if (cm) cm.onclick = () => modelPicker(st, () => { d.close(); CaptionsUI.open(existing); });
        d.b.querySelector('#cGo').onclick = run;
      };
      const run = async () => {
        if (!(await SP.status()).current) {
          d.b.innerHTML = `<div class="cprog small"><div class="cring"></div><h3>Getting the speech model…</h3><p>One time only — follow it in the small bar at the bottom. Captions start as soon as it is ready.</p></div>`;
          if (!await Model.ensure()) return d.close();
        }
        const lb = listeningBox(d, 'Listening…'); let stop = false; lb.stop(() => { stop = true; SP.cancel(); });
        const off = lb.off;
        try {
          const r = await listen(srcs, { lang, translate, force: !!existing || translate }, lb.step);
          off();
          if (!r.words) { d.b.innerHTML = `<h3>No speech found</h3><p>Whisper did not hear any words in these clips. Check the language, or that the clip sound is not muted.</p><div class="acts"><button class="primary" id="cOk">OK</button></div>`; d.b.querySelector('#cOk').onclick = d.close; return; }
          VE().addCaptions(null, { style, lang: translate ? 'en' : r.lang, langName: translate ? 'Translated to English' : langName(r.lang), replace: existing && existing.id });
          d.close(); toast(`${r.words} words captioned — they follow your cuts automatically`);
        } catch (e) {
          off(); if (stop || /cancel/.test(e.message)) { d.close(); return toast('Captions stopped'); }
          if (e.message === 'NO_MODEL') { d.close(); return CaptionsUI.open(existing); }
          d.b.innerHTML = `<h3>Captions could not be made</h3><p>${esc(e.message)}</p><div class="acts"><button class="primary" id="cOk">OK</button></div>`; d.b.querySelector('#cOk').onclick = d.close;
        }
      };
      form();
    }
  };
  CaptionsUI.transcribe = async paths => {
    if (!await Model.ensure()) return;
    const d = shell('capm'), lb = listeningBox(d, 'Getting the words…'); let stop = false; lb.stop(() => { stop = true; SP.cancel(); });
    try { await transcribeFiles(paths, (i, n) => lb.step(i, n)); lb.off(); d.close(); toast('Done — select words and press Delete to cut them'); }
    catch (e) { lb.off(); d.close(); if (!stop && !/cancel/.test(e.message)) toast(e.message); }
  };
  function modelPicker(st, done) {
    const d = shell('spm');
    d.b.innerHTML = `<button class="impx">×</button><h3>Speech model</h3><p>Bigger models hear better but take longer. You can switch any time.</p>
      <div class="spmods">${st.models.map(m => `<button class="spm ${m.id === st.current ? 'cur' : ''}" data-id="${m.id}"><b>${m.label}</b><span>${m.note}</span><em>${m.installed ? (m.id === st.current ? 'In use' : 'Use this') : 'Download ' + m.mb + ' MB'}</em></button>`).join('')}</div>
      <div class="spdl" id="spDl" style="display:none"><div class="ibar"><i id="spBar"></i></div><span id="spTxt"></span></div>
      <div class="acts"><button class="ghost" id="spX">Close</button></div>`;
    d.b.querySelector('.impx').onclick = d.b.querySelector('#spX').onclick = () => { d.close(); done(); };
    d.b.querySelectorAll('.spm').forEach(x => x.onclick = async () => {
      const m = st.models.find(y => y.id === x.dataset.id);
      if (m.installed) { await SP.setModel(m.id); d.close(); return done(); }
      d.close(); const ok = await Model.ensure(m.id); if (ok) await SP.setModel(m.id); done();
    });
  }

  /* ---------- Sermon clip finder ---------- */
  const ClipFinder = {
    async open(file) {
      const ve = VE(); if (!ve) return;
      const known = [...new Set(ve.captionSources().map(c => c.path))];
      const st = await SP.status();
      const d = shell('cfm');
      let target = 'r', count = 8, lang = st.lang;
      const pick = () => {
        d.b.innerHTML = `<button class="impx">×</button><div class="caph">${SCISS}<div><h3>Find the best clips</h3><p>Listens to the whole sermon and picks the strongest moments for Reels, Shorts, TikTok and WhatsApp Status — each one starts and ends on a full sentence.</p></div></div>
          <div class="cfsrc">${known.map(p => `<button class="cfv" data-p="${esc(p)}">${esc(p.split(/[\\/]/).pop())}</button>`).join('')}<button class="cfv add" id="cfOther">Choose a video…</button></div>
          <div class="capf three">
            <label class="fl"><span>Clip length</span><select id="cfLen">${[['r', '30 – 60 seconds (Reels, Shorts)'], [15, 'About 15 seconds'], [30, 'About 30 seconds'], [60, 'About 1 minute'], [90, 'About 1½ minutes']].map(([v, l]) => `<option value="${v}"${String(v) === String(target) ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="fl"><span>How many</span><select id="cfN">${[5, 8, 12].map(v => `<option${v === count ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
            <label class="fl"><span>Language spoken</span><select id="cfLang">${LANGS.map(([k, v]) => `<option value="${k}"${k === lang ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
          </div>
          <p class="muted small">A 45-minute sermon takes a few minutes the first time. After that it is instant — the words are remembered.</p>`;
        d.b.querySelector('.impx').onclick = d.close;
        d.b.querySelector('#cfLen').onchange = e => target = e.target.value === 'r' ? 'r' : +e.target.value;
        d.b.querySelector('#cfN').onchange = e => count = +e.target.value;
        d.b.querySelector('#cfLang').onchange = e => { lang = e.target.value; SP.setLang(lang); };
        d.b.querySelectorAll('.cfv[data-p]').forEach(x => x.onclick = () => go(x.dataset.p));
        d.b.querySelector('#cfOther').onclick = async () => { const p = await window.api.vid.pickVideos(); if (p && p[0]) go(p[0]); };
      };
      const go = async p => {
        if (!(await SP.status()).current) {
          d.b.innerHTML = `<div class="cprog small"><div class="cring"></div><h3>Getting the speech model…</h3><p>One time only — follow it in the small bar at the bottom. The sermon starts as soon as it is ready.</p></div>`;
          if (!await Model.ensure()) return d.close();
        }
        file = p;
        d.b.innerHTML = `<div class="cprog small"><div class="cring"></div><h3>Listening to the sermon…</h3><p id="lpTxt">Getting the sound ready</p><div class="ibar"><i id="lpBar"></i></div><p class="muted" id="lpHint">${esc(p.split(/[\\/]/).pop())}</p><button class="ghost" id="lpStop">Stop</button></div>`;
        let stop = false; d.b.querySelector('#lpStop').onclick = () => { stop = true; SP.cancel(); };
        const t0 = Date.now();
        const off = SP.onProgress(pr => { const b = q('#lpBar'); if (!b) return; const pct = pr.phase === 'listen' ? pr.pct : 1; b.style.width = pct + '%'; q('#lpTxt').textContent = pr.phase === 'listen' ? `Writing down every word… ${pr.pct}%` : 'Getting the sound ready'; const el = (Date.now() - t0) / 1000; if (pct > 4) q('#lpHint').textContent = `About ${mmss(el / pct * 100 - el)} left`; });
        const r = await A.clips.find(p, target === 'r' ? { target: 45, min: 30, max: 60, count, lang } : { target, count, lang }); off();
        if (r.error) {
          if (stop || /cancel/.test(r.error)) return d.close();
          if (r.error === 'NO_MODEL') { d.close(); return ClipFinder.open(p); }
          d.b.innerHTML = `<h3>Could not find clips</h3><p>${esc(r.error)}</p><div class="acts"><button class="primary" id="cOk">OK</button></div>`; d.b.querySelector('#cOk').onclick = d.close; return;
        }
        results(p, r);
      };
      const results = (p, r) => {
        d.b.classList.add('wide2');
        const S = r.allSentences || [];
        const sel = new Set(r.clips.length ? [0] : []); let cur = 0, vertical = true, withCaps = true;
        const nudge = (c, side, dir) => {
          if (side === 's') { const starts = S.map(x => x.s); const i = starts.findIndex(x => x >= c.start + .2); const k = dir < 0 ? Math.max(0, (i < 0 ? starts.length : i) - 2) : Math.min(starts.length - 1, i < 0 ? starts.length - 1 : i); c.start = Math.max(0, starts[k] - .15); }
          else { const ends = S.map(x => x.e); const i = ends.findIndex(x => x >= c.end - .4); const k = dir < 0 ? Math.max(0, (i < 0 ? ends.length : i) - 1) : Math.min(ends.length - 1, (i < 0 ? ends.length - 1 : i) + 1); c.end = ends[k] + .35; }
          if (c.end - c.start < 3) c.end = c.start + 3; c.dur = +(c.end - c.start).toFixed(1);
        };
        const draw = () => {
          const c = r.clips[cur];
          d.b.innerHTML = `<button class="impx">×</button>
            <div class="cfhead"><h3>${r.clips.length} clip${r.clips.length === 1 ? '' : 's'} found</h3><span class="muted">${esc(p.split(/[\\/]/).pop())} · ${mmss(r.dur || 0)} · ${r.words} words heard</span></div>
            <div class="cfgrid">
              <div class="cflist">${r.clips.length ? r.clips.map((x, i) => `<div class="cfc ${i === cur ? 'on' : ''}" data-i="${i}">
                  <label class="cfck"><input type="checkbox" data-ck="${i}" ${sel.has(i) ? 'checked' : ''}></label>
                  <div class="cfb"><div class="cft"><b>“${esc(x.title)}”</b><span class="cfs" title="How strong this moment is">${x.score}</span></div>
                  <div class="cfm">${mmss(x.start)} – ${mmss(x.end)} · ${Math.round(x.dur)} s</div>
                  <div class="tgs">${x.why.map(w => `<i class="tg ${/Scripture/.test(w) ? 'eyes' : /responded/.test(w) ? 'similar' : 'blurry'}">${esc(w)}</i>`).join('')}</div></div></div>`).join('') : '<div class="cempty"><b>No strong moments found</b>Try a longer clip length or check the language.</div>'}</div>
              <div class="cfprev">${c ? `
                <div class="cfvid ${vertical ? 'vert' : ''}"><video id="cfV" src="${mediaUrl(p)}#t=${c.start}" preload="auto" playsinline></video></div>
                <div class="cfctl"><button class="primary sm" id="cfPlay">▶ Play this clip</button>
                  <span class="sp"></span><span class="muted">Start</span><button class="ghost sm" data-n="s-1" title="One sentence earlier">‹</button><button class="ghost sm" data-n="s1" title="One sentence later">›</button>
                  <span class="muted">End</span><button class="ghost sm" data-n="e-1" title="One sentence earlier">‹</button><button class="ghost sm" data-n="e1" title="One sentence later">›</button></div>
                <div class="cftext">${esc(c.text)}</div>` : ''}</div>
            </div>
            <div class="cffoot">
              <label class="ck2"><input type="checkbox" id="cfVert" ${vertical ? 'checked' : ''}><span>Vertical 9:16 <small>Reels, Shorts, TikTok, Status — keeps the preacher in frame</small></span></label>
              <label class="ck2"><input type="checkbox" id="cfCaps" ${withCaps ? 'checked' : ''}><span>Add captions <small>instantly — the words are already known</small></span></label>
              <span class="sp"></span><button class="ghost" id="cfBack">Search again</button>
              <button class="ghost" id="cfAdd" ${sel.size ? '' : 'disabled'}>Add to the timeline</button>
              <button class="primary" id="cfMake" ${sel.size ? '' : 'disabled'} title="Each clip becomes its own finished video in Exports">Make ${sel.size || ''} video${sel.size === 1 ? '' : 's'}</button>
            </div>`;
          d.b.querySelector('.impx').onclick = () => { const v = q('#cfV'); if (v) v.pause(); d.close(); };
          d.b.querySelectorAll('.cfc').forEach(x => x.onclick = e => { if (e.target.closest('.cfck')) return; cur = +x.dataset.i; draw(); });
          d.b.querySelectorAll('[data-ck]').forEach(x => x.onchange = () => { x.checked ? sel.add(+x.dataset.ck) : sel.delete(+x.dataset.ck); draw(); });
          d.b.querySelector('#cfVert').onchange = e => { vertical = e.target.checked; draw(); };
          d.b.querySelector('#cfCaps').onchange = e => withCaps = e.target.checked;
          d.b.querySelector('#cfBack').onclick = () => { d.b.classList.remove('wide2'); pick(); };
          d.b.querySelector('#cfAdd').onclick = () => add([...sel].sort((a, b) => a - b).map(i => r.clips[i]));
          d.b.querySelector('#cfMake').onclick = () => make([...sel].sort((a, b) => a - b).map(i => r.clips[i]));
          const v = q('#cfV');
          if (v && c) {
            const play = q('#cfPlay');
            play.onclick = () => { if (!v.paused) { v.pause(); return; } if (v.currentTime < c.start || v.currentTime >= c.end - .1) v.currentTime = c.start; v.play(); };
            v.onplay = () => play.textContent = '❚❚ Pause'; v.onpause = () => play.textContent = '▶ Play this clip';
            v.ontimeupdate = () => { if (v.currentTime >= c.end) { v.pause(); v.currentTime = c.start; } };
            d.b.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { const [sd, dir] = [b.dataset.n[0], +b.dataset.n.slice(1)]; nudge(c, sd, dir); draw(); const vv = q('#cfV'); if (vv) vv.currentTime = sd === 's' ? c.start : Math.max(c.start, c.end - 4); });
          }
        };
        // each chosen moment → its own finished video (vertical, preacher in frame, captions) in Exports › Sermon clips
        const make = async list => {
          const v = q('#cfV'); if (v) v.pause();
          d.b.innerHTML = `<div class="cprog small"><div class="cring"></div><h3>Preparing ${list.length} clip${list.length === 1 ? '' : 's'}…</h3><p id="adTxt"></p></div>`;
          const ve = VE();
          try { await transcribeFiles([p]); } catch {}
          const items = [];
          for (let i = 0; i < list.length; i++) {
            const c = list[i]; q('#adTxt').textContent = vertical ? `Finding the preacher · clip ${i + 1} of ${list.length}` : '';
            items.push({ path: p, start: c.start, end: c.end, focus: vertical ? await A.clips.focus(p, c.start, c.end) : null, name: c.title.replace(/[“”"]/g, '').replace(/[.…]+$/, '') });
          }
          d.close();
          const day = new Date(), folder = `Sermon clips ${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
          await ve.exportBatch(items, { vertical, captions: withCaps, style: 'pop', quality: 1080, folder });
        };
        const add = async list => {
          const v = q('#cfV'); if (v) v.pause();
          d.b.innerHTML = `<div class="cprog small"><div class="cring"></div><h3>Adding clips…</h3><p id="adTxt"></p></div>`;
          const ve = VE();
          if (vertical) ve.setFormat('9:16', 'fill');
          for (let i = 0; i < list.length; i++) {
            const c = list[i]; q('#adTxt').textContent = `Clip ${i + 1} of ${list.length}` + (vertical ? ' · finding the preacher' : '');
            const focus = vertical ? await A.clips.focus(p, c.start, c.end) : null;
            await ve.addClip(p, c.start, c.end, focus != null ? { focus } : {});
          }
          try { await transcribeFiles([p]); } catch {}          // already known from the search — instant
          if (withCaps) {
            const old = ve.state.layers.find(l => l.type === 'captions');
            ve.addCaptions(null, { style: 'pop', lang: r.lang, langName: langName(r.lang), replace: old && old.id });
          }
          d.close(); document.querySelector('.tab[data-t="vid"]').click();
          toast(`${list.length} clip${list.length === 1 ? '' : 's'} added${vertical ? ' in 9:16' : ''}${withCaps ? ' with captions' : ''} — press Export when ready`);
        };
        draw();
      };
      if (file) go(file); else pick();
    }
  };
  window.CaptionsUI = CaptionsUI; window.ClipFinder = ClipFinder; window.SpeechModel = Model;
})();

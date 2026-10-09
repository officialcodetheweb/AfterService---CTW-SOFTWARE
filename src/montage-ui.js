/* =====================================================================
   Beat montage — drop photos and a song, the cuts land on the beat.
   The song is analysed on this computer (tempo + every beat), each photo gets a
   slow, face-aware move, and every cut sits exactly on a beat.
   ===================================================================== */
(function () {
  const A = window.api; if (!A || !A.montage) return;
  const M = A.montage, q = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mediaUrl = p => 'asmedia://media/' + encodeURIComponent(p);
  const IMG_RE = /\.(jpe?g|png|webp|bmp)$/i, AUD_RE = /\.(mp3|wav|m4a|aac|ogg|flac|wma|opus)$/i;
  const FPS = 30;
  const SHAPES = { '16:9': { label: 'Landscape', sub: 'YouTube · TV', ar: 16 / 9 }, '9:16': { label: 'Vertical', sub: 'Reels · Shorts · Status', ar: 9 / 16 }, '1:1': { label: 'Square', sub: 'Feed', ar: 1 } };
  const ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="11" height="14" rx="2"/><path d="M18 8v8M21 10v4M15.5 6v12"/></svg>';
  const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); };
  const sizeOf = (shape, q) => { const ar = SHAPES[shape].ar, ev = n => Math.round(n / 2) * 2; return ar >= 1 ? [ev(q * ar), q] : [q, ev(q / ar)]; };

  // entry points: picture side (stage bar) and video editor (Add tools)
  const pb = q('#designBtn'); if (pb) pb.insertAdjacentHTML('afterend', `<button id="beatBtn" class="ghost acc" title="Photos + a song → a video cut on the beat"><span class="lg">Beat montage</span><span class="sm">Montage</span></button>`);
  const tb = q('#toCap'); if (tb) tb.insertAdjacentHTML('afterend', `<button id="toBeat" class="tool" title="Photos + a song → a video cut on the beat">${ICON.replace('width="17" height="17"', 'width="26" height="26"')}<span>Beat montage</span></button>`);
  if (q('#beatBtn')) q('#beatBtn').onclick = () => open(picturePaths());
  if (q('#toBeat')) q('#toBeat').onclick = () => open(typeof S !== 'undefined' && S.files && S.files.length ? picturePaths() : []);
  function picturePaths() {
    if (typeof S === 'undefined' || !S.files) return [];
    if (S.sel && S.sel.size > 1) return S.files.map(f => f.path).filter(p => S.sel.has(p));
    return S.files.map(f => f.path).filter(p => !S.filter || S.filter.paths.has(p));
  }

  let B = null;   // the montage being made
  async function open(paths = []) {
    if (q('#montOv')) return;
    B = { photos: [], song: null, beats: null, shape: B ? B.shape : '16:9', every: 'auto', length: 'once', start: null, motion: true, pulse: true, style: B ? B.style : 'mix', look: B ? B.look : 'clean', quality: 1080, info: {}, bmp: new Map(), t: 0, playing: false };
    const ov = document.createElement('div'); ov.id = 'montOv'; document.body.append(ov);
    ov.innerHTML = `<div class="sbar2"><div class="ctitle">${ICON.replace('width="17" height="17"', 'width="22" height="22"')}<div><b>Beat montage</b><small>Drop photos and a song — every cut lands on the beat</small></div></div><span class="sp"></span>
        <button class="primary" id="bMake" disabled>Make video</button><button class="impx" id="bX">×</button></div>
      <div class="mbody">
        <aside class="mside" id="bSide"></aside>
        <section class="mstage"><div class="mprev" id="bPrev"><canvas id="bCv"></canvas><div class="mempty" id="bEmpty"></div><button class="mplay" id="bPlay" title="Play the preview (Space)"></button></div>
          <div class="mstrip"><div class="mstripHead"><b id="bSum">Add photos and a song</b><span class="sp"></span><span class="muted small" id="bTime"></span></div><canvas id="bStrip" height="74"></canvas><p class="muted small">Orange lines are the cuts. Click the strip to choose where in the song the video starts.</p></div>
        </section>
      </div>
      <div class="mdrop" id="bDrop"><b>Drop photos and a song</b></div>`;
    B.audio = new Audio(); B.audio.preload = 'auto';
    const close = () => { stop(); try { B.audio.src = ''; } catch {} ov.remove(); document.removeEventListener('keydown', keys, true); B.closed = true; };
    const keys = e => { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || q('.mask')) return; if (e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); toggle(); } if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
    document.addEventListener('keydown', keys, true);
    q('#bX').onclick = close; q('#bMake').onclick = make; q('#bPlay').onclick = toggle;
    // drag & drop photos and songs from Explorer
    let dragN = 0;
    ov.ondragenter = e => { e.preventDefault(); dragN++; ov.classList.add('drag'); };
    ov.ondragleave = () => { if (--dragN <= 0) { dragN = 0; ov.classList.remove('drag'); } };
    ov.ondragover = e => e.preventDefault();
    ov.ondrop = async e => {
      e.preventDefault(); dragN = 0; ov.classList.remove('drag');
      const ps = [...e.dataTransfer.files].map(f => A.sounds.pathFor(f)).filter(Boolean);
      const imgs = ps.filter(p => IMG_RE.test(p)), song = ps.find(p => AUD_RE.test(p));
      if (imgs.length) await setPhotos(imgs, true);
      if (song) await setSong(song);
      if (!imgs.length && !song) toast('Drop photos (JPG, PNG) or a song (MP3, WAV, M4A…)');
    };
    q('#bStrip').onclick = e => {
      if (!B.beats) return; const r = e.target.getBoundingClientRect(), t = (e.clientX - r.left) / r.width * B.beats.dur;
      const i = nearestBeat(t); B.start = B.beats.beats[i]; B.t = 0; replan(); if (B.playing) { stop(); play(); }
    };
    new ResizeObserver(() => { sizePreview(); drawStrip(); }).observe(q('#bPrev'));
    try { B.library = await A.sounds.list(); } catch { B.library = []; }
    side(); sizePreview(); drawStrip();
    if (paths.length) await setPhotos(paths);
    // a song from the library is picked for you (the most recent one) — change it any time
    if (!B.song && B.library.length) await setSong(B.library.slice().sort((a, b) => b.mtime - a.mtime)[0].path);
  }

  /* ---------- photos & song ---------- */
  async function setPhotos(paths, add) {
    paths = paths.filter(p => IMG_RE.test(p));
    B.photos = add ? [...B.photos, ...paths.filter(p => !B.photos.includes(p))] : paths.slice();
    if (B.photos.length > 400) { B.photos = B.photos.slice(0, 400); toast('Using the first 400 photos'); }
    side(); replan();
    try { const r = await A.vision.faces(B.photos.slice(0, 400)); if (!r.error) Object.assign(B.info, r); } catch {}
    replan();
  }
  async function setSong(p) {
    stop(); B.song = p; B.beats = null; B.start = null; side(); replan();
    const r = await M.beats(p); if (B.closed || B.song !== p) return;
    if (r.error) { toast('Song: ' + r.error); B.song = null; side(); replan(); return; }
    B.beats = r; B.audio.src = mediaUrl(p);
    // start on the first strong beat
    B.start = r.beats[Math.min(r.beats.length - 1, phaseOf(0, everyN()))] || 0;
    side(); replan();
  }
  const nearestBeat = t => { const b = B.beats.beats; let lo = 0, hi = b.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m] < t) lo = m; else hi = m; } return Math.abs(b[lo] - t) < Math.abs(b[hi] - t) ? lo : hi; };
  // how many beats per photo: about 1.2 s per photo unless you choose
  const everyN = () => { if (!B.beats) return 2; if (B.every !== 'auto') return +B.every; const p = 60 / B.beats.bpm; return p >= .85 ? 1 : p >= .4 ? 2 : 4; };
  // which beat in each group of N is the "1" (the one with the strongest kick)
  function phaseOf(from, N) {
    const L = B.beats.low; let best = 0, bs = -1;
    for (let p = 0; p < N; p++) { let s = 0; for (let i = from + p; i < Math.min(L.length, from + p + 64 * N); i += N) s += L[i]; if (s > bs) { bs = s; best = p; } }
    return from + best;
  }

  /* ---------- the plan: where every cut goes ---------- */
  function replan() {
    B.segs = []; B.dur = 0;
    const ok = B.photos.length && B.beats && B.beats.beats.length > 4;
    q('#bMake').disabled = !ok;
    if (ok) {
      const bt = B.beats.beats, N = everyN(), i0 = nearestBeat(B.start ?? bt[0]), songIn = bt[i0], songEnd = Math.min(B.beats.dur, songIn + 300);
      const want = B.length === 'once' ? Infinity : B.length === 'song' ? songEnd - songIn : +B.length;
      const maxSegs = B.length === 'once' ? B.photos.length : Infinity;
      const auto = B.every === 'auto';
      let i = i0;
      while (B.segs.length < maxSegs) {
        // in "auto", the loud parts (chorus) cut twice as fast — when that still leaves ≥ 0.5 s per photo
        const fast = auto && N >= 2 && (B.beats.loud[i] || 0) > .82 && (60 / B.beats.bpm) * N / 2 >= .5;
        const step = fast ? N / 2 : N, j = i + step;
        const s = bt[i] - songIn; let e = j < bt.length ? bt[j] - songIn : Math.min(songEnd - songIn, s + step * 60 / B.beats.bpm);
        if (s >= want - .3 || s >= songEnd - songIn - .3) break;
        e = Math.min(e, want, songEnd - songIn);
        if (e - s < .25) break;
        B.segs.push({ s, e, k: B.segs.length }); i = j;
        if (j >= bt.length) break;
      }
      // the last photo holds a little longer and the music fades (ends on a beat when it can)
      const last = B.segs[B.segs.length - 1];
      if (last && B.length === 'once') last.e = Math.min(songEnd - songIn, last.e + (60 / B.beats.bpm) * N);
      B.songIn = songIn; B.dur = last ? last.e : 0;
      B.songIn = songIn; B.segs.forEach((g, k) => { g.photo = B.photos[k % B.photos.length]; g.move = k % 4; g.tr = k ? styleFor(k) : null; });
    }
    const sum = q('#bSum');
    if (sum) sum.innerHTML = !B.photos.length ? 'Add photos to start' : !B.song ? 'Now choose a song' : !B.beats ? '<span class="spin sm"></span> Finding the beat…' : `${B.segs.length} cuts · ${fmt(B.dur)} · <b>${Math.round(B.beats.bpm)} BPM</b>${B.length === 'once' ? '' : B.segs.length > B.photos.length ? ` · photos repeat` : B.segs.length < B.photos.length ? ` · uses ${B.segs.length} of ${B.photos.length} photos` : ''}`;
    if (B.t > B.dur) B.t = 0;
    drawStrip(); preload(); paint();
  }

  /* ---------- drawing a frame ---------- */
  async function bmp(p) {
    if (!B.bmp.has(p)) B.bmp.set(p, (async () => {
      const big = await loadBmp(p), m = 2200 / Math.max(big.width, big.height);
      const b = m < 1 ? await createImageBitmap(big, { resizeWidth: Math.round(big.width * m), resizeHeight: Math.round(big.height * m), resizeQuality: 'high' }) : big;
      // a soft blurred copy for photos that don't match the video's shape
      const bl = document.createElement('canvas'), k = 160 / Math.max(b.width, b.height); bl.width = Math.max(1, Math.round(b.width * k)); bl.height = Math.max(1, Math.round(b.height * k));
      const x = bl.getContext('2d'); x.filter = 'blur(6px) brightness(.55) saturate(1.2)'; x.drawImage(b, -4, -4, bl.width + 8, bl.height + 8);
      return { b, blur: bl };
    })().catch(() => null));
    return B.bmp.get(p);
  }
  function preload() { if (!B.segs) return; const need = [...new Set(B.segs.slice(0, 60).map(g => g.photo))]; need.forEach(p => bmp(p).then(() => { if (!B.playing) paint(); })); }
  const segAt = t => { const S = B.segs; let lo = 0, hi = S.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m].s <= t) lo = m; else hi = m - 1; } return S[lo]; };
  const ease = u => u < .5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
  function focusOf(p) {
    const f = (B.info[p] || {}).faces || []; if (!f.length) return { x: .5, y: .42 };
    const x0 = Math.min(...f.map(a => a.box[0])), x1 = Math.max(...f.map(a => a.box[0] + a.box[2])), y0 = Math.min(...f.map(a => a.box[1])), y1 = Math.max(...f.map(a => a.box[1] + a.box[3]));
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }
  /* ---------- styles ---------- */
  // how one photo hands over to the next, on the beat
  const STYLES = {
    mix: { name: 'Mix', sub: 'A bit of everything' },
    cut: { name: 'Hard cut', sub: 'Clean cuts, slow moves' },
    flash: { name: 'Flash', sub: 'White flash on the beat' },
    push: { name: 'Slide', sub: 'Next photo pushes in' },
    whip: { name: 'Whip pan', sub: 'Fast swipe with blur' },
    zoom: { name: 'Zoom through', sub: 'Punch into the next one' },
    spin: { name: 'Spin', sub: 'Twist into the next' },
    glitch: { name: 'Glitch', sub: 'Colour split, shaky' },
    panels: { name: 'Panels', sub: 'Strips slide in' },
    cards: { name: 'Photo cards', sub: 'Prints drop on a pile' }
  };
  const MIX = ['push', 'whip', 'zoom', 'flash', 'spin', 'glitch', 'panels', 'push', 'whip', 'zoom'];
  const LOOKS = { clean: { name: 'Clean', f: '' }, warm: { name: 'Warm', f: 'sepia(.22) saturate(1.2) contrast(1.05)' }, vivid: { name: 'Vivid', f: 'saturate(1.35) contrast(1.08)' }, film: { name: 'Film', f: 'sepia(.16) contrast(1.12) saturate(.88) brightness(.98)' }, bw: { name: 'Black & white', f: 'grayscale(1) contrast(1.18)' } };
  // transition window around each cut: [before the beat, after the beat] in seconds
  const winOf = (st, P) => { const T = clamp(P * .6, .2, .42);
    return st === 'flash' ? [.07, .28] : st === 'push' ? [T, 0] : st === 'whip' ? [T * .55, T * .4] : st === 'zoom' ? [T * .6, T * .45] : st === 'spin' ? [T * .6, T * .45] : st === 'glitch' ? [.05, .26] : st === 'panels' ? [T * 1.1, 0] : st === 'cards' ? [T, 0] : [0, 0]; };
  function styleFor(j) {
    if (B.style !== 'mix') return B.style;
    // loud parts get the punchy ones
    const loud = (B.beats && B.beats.loud[nearestBeat(B.songIn + (B.segs[j] || {}).s || 0)]) || 0;
    const pool = loud > .8 ? ['whip', 'zoom', 'glitch', 'flash', 'spin'] : ['push', 'panels', 'zoom', 'whip', 'flash', 'push'];
    return pool[(j * 7 + 3) % pool.length];
  }

  // each photo is resized once for the output size and look (drawing a big photo every frame is slow)
  function sized(it, p, W, H) {
    const fs0 = (B.info[p] || {}).faces || [], key = W + 'x' + H + (B.info[p] ? 'f' : '') + B.look; it.sz = it.sz || {}; if (it.sz[key]) return it.sz[key];
    const b = it.b, arP = b.width / b.height, arV = W / H, fl = (LOOKS[B.look] || LOOKS.clean).f || 'none';
    let mismatch = Math.max(arP / arV, arV / arP) > 1.45;
    // a different shape is still cropped (not shrunk) when the faces fit comfortably in the crop
    if (mismatch && fs0.length) {
      const vis = arV < arP ? arV / arP : arP / arV, ax = arV < arP ? 0 : 1;
      const lo = Math.min(...fs0.map(f => f.box[ax])), hi = Math.max(...fs0.map(f => f.box[ax] + f.box[ax + 2]));
      if ((hi - lo) * 1.5 + .04 <= vis) mismatch = false;
    }
    const out = { mismatch };
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
    const bl = it.blur, cs = Math.max(W / bl.width, H / bl.height) * 1.08, bg = mk(W, H), y = bg.getContext('2d'); y.imageSmoothingQuality = 'high'; y.filter = fl;
    y.drawImage(bl, (W - bl.width * cs) / 2, (H - bl.height * cs) / 2, bl.width * cs, bl.height * cs); out.bg = bg;
    if (mismatch) {
      // whole photo with a soft shadow baked in, on a blurred copy of itself
      const fs = Math.min(W / b.width, H / b.height) * .94 * 1.1, w = b.width * fs, h = b.height * fs, m = Math.round(W * .06);
      const card = mk(w + m * 2, h + m * 2), x = card.getContext('2d'); x.imageSmoothingQuality = 'high'; x.filter = fl;
      x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = m * .6; x.shadowOffsetY = m * .12; x.drawImage(b, m, m, w, h);
      Object.assign(out, { card, m, k0: 1.1 });
    } else {
      const sc = Math.max(W / b.width, H / b.height) * 1.17, img = mk(b.width * sc, b.height * sc), x = img.getContext('2d');
      x.imageSmoothingQuality = 'high'; x.filter = fl; x.drawImage(b, 0, 0, img.width, img.height);
      Object.assign(out, { img, k0: 1.17 });
    }
    // a printed photo (white border) for the "Photo cards" style
    out.print = () => { if (out._pr) return out._pr;
      const s0 = Math.min(W * .66 / b.width, H * .66 / b.height), w = b.width * s0, h = b.height * s0, bd = Math.max(w, h) * .035, m = bd * 3;
      const pc = mk(w + bd * 2 + m * 2, h + bd * 2 + bd * 2.6 + m * 2), x = pc.getContext('2d');
      x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = m * .8; x.shadowOffsetY = m * .25; x.fillStyle = '#fbf8f2'; x.fillRect(m, m, w + bd * 2, h + bd * 4.6);
      x.shadowColor = 'transparent'; x.imageSmoothingQuality = 'high'; x.filter = fl; x.drawImage(b, m + bd, m + bd, w, h);
      return out._pr = pc; };
    const keys = Object.keys(it.sz); if (keys.length > 2) delete it.sz[keys[0]];
    return it.sz[key] = out;
  }
  const bufs = {};
  const buf = (n, W, H) => { n += W + 'x' + H; let b = bufs[n]; if (!b) { b = bufs[n] = document.createElement('canvas'); } if (b.width !== W || b.height !== H) { b.width = W; b.height = H; } const x = b.getContext('2d', { willReadFrequently: true }); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'; return [b, x]; };
  // beat pulse: a small bump on every beat (not only on cuts)
  function pulseAt(t) {
    if (!B.pulse || !B.beats) return 1;
    const bt = B.beats.beats, at = B.songIn + t; let lo = 0, hi = bt.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bt[m] <= at) lo = m; else hi = m - 1; }
    const d = at - bt[lo]; return d < 0 ? 1 : 1 + .022 * (.6 + .4 * (B.beats.loud[lo] || 0)) * Math.exp(-d / .09);
  }
  // one photo, with its slow movement, moved/turned/scaled by o (and motion-blurred when o.n > 1)
  function drawPhoto(c, W, H, g, t, ready, o = {}) {
    const it = ready.get(g.photo); if (!it) return false;
    const P = sized(it, g.photo, W, H), u = clamp((t - g.s) / Math.max(.05, g.e - g.s), 0, 1), e = ease(u);
    let z = 1.04, kx = 0, ky = 0;
    if (B.motion) { if (g.move === 0) z = 1.02 + .1 * e; else if (g.move === 1) z = 1.12 - .1 * e; else if (g.move === 2) { z = 1.1; kx = -.5 + e; } else { z = 1.1; ky = .5 - e; } }
    z *= o.pz || 1;
    const n = Math.max(1, o.n || 1), alpha = o.alpha ?? 1;
    const [L, lx] = n > 1 || alpha < 1 ? buf('L' + (o.layer || 0), W, H) : [null, c];
    if (L) lx.clearRect(0, 0, W, H);
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0 : i / (n - 1) - .5;
      lx.save(); lx.globalAlpha = n === 1 ? 1 : 1 / (i + 1);
      lx.translate(W / 2 + ((o.dx || 0) + f * (o.bdx || 0)) * W, H / 2 + ((o.dy || 0) + f * (o.bdy || 0)) * H);
      lx.rotate((o.rot || 0) + f * (o.brot || 0)); const sc = (o.s || 1) * (1 + f * (o.bs || 0)); lx.scale(sc, sc); lx.translate(-W / 2, -H / 2);
      lx.imageSmoothingQuality = 'medium';
      if (P.mismatch) {
        lx.drawImage(P.bg, -W * .02, -H * .02, W * 1.04, H * 1.04);
        const k = (B.motion ? (z - .04) : (o.pz || 1)) / P.k0, w = P.card.width * k, h = P.card.height * k;
        lx.drawImage(P.card, (W - w) / 2 + kx * W * .02, (H - h) / 2 + ky * H * .02 + P.m * k * .06, w, h);
      } else {
        const im = P.img, k = z / P.k0, iw = im.width * k, ih = im.height * k, fc = focusOf(g.photo);
        let ox = W / 2 - fc.x * iw + kx * (iw - W) * .6, oy = H * .45 - fc.y * ih + ky * (ih - H) * .6;
        ox = clamp(ox, W - iw, 0); oy = clamp(oy, H - ih, 0);
        lx.drawImage(im, ox, oy, iw, ih);
      }
      lx.restore();
    }
    if (L) { c.save(); c.globalAlpha = alpha; c.drawImage(L, 0, 0); c.restore(); }
    return true;
  }
  const easeIO = p => p < .5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
  const rnd = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  // "Photo cards": prints land on a pile over a blurred background
  function drawCards(c, W, H, k, t, ready, p) {
    const g = B.segs[k], it = ready.get(g.photo); if (!it) return;
    const P = sized(it, g.photo, W, H), pr = P.print(), prev = B.segs[k - 1], itp = prev && ready.get(prev.photo);
    // background: the current photo, blurred (cross-fades from the previous one while the card falls)
    if (itp && p < 1) { c.drawImage(sized(itp, prev.photo, W, H).bg, 0, 0); c.globalAlpha = easeIO(p); c.drawImage(P.bg, 0, 0); c.globalAlpha = 1; } else c.drawImage(P.bg, 0, 0);
    const card = (pc, ang, x, y, s) => { c.save(); c.translate(x, y); c.rotate(ang); c.scale(s, s); c.drawImage(pc, -pc.width / 2, -pc.height / 2); c.restore(); };
    // the two previous prints stay underneath
    for (let j = Math.max(0, k - 2); j < k; j++) { const gj = B.segs[j], ij = ready.get(gj.photo); if (!ij) continue; card(sized(ij, gj.photo, W, H).print(), (rnd(j) - .5) * .22, W / 2 + (rnd(j + 9) - .5) * W * .12, H / 2 + (rnd(j + 3) - .5) * H * .08, .96); }
    const e = easeIO(clamp(p, 0, 1)), ang = (rnd(k) - .5) * .22, side = k % 2 ? 1 : -1, pu = pulseAt(t);
    card(pr, ang + (1 - e) * side * .5, W / 2 + (rnd(k + 9) - .5) * W * .12 + (1 - e) * side * W * .7, H / 2 + (rnd(k + 3) - .5) * H * .08 - (1 - e) * H * .25, (1 + (1 - e) * .25) * pu);
  }
  function glitchOver(c, W, H, amt, seed) {
    if (amt < .02) return;
    const [A, ax] = buf('G0', W, H); ax.drawImage(c.canvas, 0, 0);
    const [R, rx] = buf('G1', W, H); rx.drawImage(A, 0, 0); rx.globalCompositeOperation = 'multiply'; rx.fillStyle = '#f00'; rx.fillRect(0, 0, W, H);
    const [C, cx] = buf('G2', W, H); cx.drawImage(A, 0, 0); cx.globalCompositeOperation = 'multiply'; cx.fillStyle = '#0ff'; cx.fillRect(0, 0, W, H);
    const d = W * .018 * amt;
    c.save(); c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.drawImage(C, -d, 0); c.globalCompositeOperation = 'lighter'; c.drawImage(R, d, d * .3); c.restore();
    // a few torn slices
    const n = 3 + Math.round(5 * amt);
    for (let i = 0; i < n; i++) { const y = rnd(seed + i) * H, h = H * (.02 + .07 * rnd(seed + i + 50)), sh = (rnd(seed + i + 99) - .5) * W * .12 * amt; c.drawImage(A, 0, y, W, h, sh, y, W, h); }
  }
  let grain = null;
  function filmOver(c, W, H, t) {
    if (!grain) { grain = document.createElement('canvas'); grain.width = grain.height = 256; const x = grain.getContext('2d'), id = x.createImageData(256, 256); for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } x.putImageData(id, 0, 0); }
    c.save(); c.globalAlpha = .06; c.globalCompositeOperation = 'overlay'; const ox = Math.floor(rnd(Math.floor(t * 24)) * 256), oy = Math.floor(rnd(Math.floor(t * 24) + 7) * 256), s = Math.max(1, W / 900);
    c.translate(-ox, -oy); c.scale(s, s); c.fillStyle = c.createPattern(grain, 'repeat'); c.fillRect(0, 0, (W + 512) / s, (H + 512) / s); c.restore();
    const v = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.hypot(W, H) * .6); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)'); c.fillStyle = v; c.fillRect(0, 0, W, H);
  }
  function drawAt(c, W, H, t, ready) {
    c.save(); c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    if (!B.segs || !B.segs.length) { c.restore(); return; }
    const S = B.segs, g = segAt(t), P = 60 / ((B.beats && B.beats.bpm) || 120), vert = H > W * 1.05, pu = pulseAt(t);
    // is a hand-over happening right now? (around the start of this photo or the next)
    let tr = null;
    for (const j of [g.k, g.k + 1]) {
      if (j < 1 || j >= S.length) continue;
      const st = S[j].tr || 'cut', [a, b] = winOf(st, P), A = Math.min(a, (S[j - 1].e - S[j - 1].s) * .45), Bb = Math.min(b, (S[j].e - S[j].s) * .45);
      if (A + Bb > 0 && t >= S[j].s - A && t < S[j].s + Bb) { tr = { j, st, p: (t - (S[j].s - A)) / (A + Bb), pc: A / (A + Bb) }; break; }
    }
    if (B.style === 'cards') drawCards(c, W, H, tr ? tr.j : g.k, t, ready, tr ? tr.p : 1);
    else if (!tr) drawPhoto(c, W, H, g, t, ready, { pz: pu });
    else {
      const A = S[tr.j - 1], Bs = S[tr.j], p = tr.p, pc = tr.pc, dir = tr.j % 2 ? 1 : -1;
      const hx = vert ? 0 : 1, hy = vert ? 1 : 0;   // slide sideways on wide videos, up/down on tall ones
      switch (tr.st) {
        case 'flash': { drawPhoto(c, W, H, p < pc ? A : Bs, t, ready, { pz: pu });
          const w = p < pc ? p / pc : 1 - (p - pc) / (1 - pc); c.fillStyle = `rgba(255,255,255,${(.92 * w * w).toFixed(3)})`; c.fillRect(0, 0, W, H); break; }
        case 'push': { const e = easeIO(p), n = p > .15 && p < .85 ? 5 : 1, bl = .05 * Math.sin(p * Math.PI);
          drawPhoto(c, W, H, A, t, ready, { dx: -dir * e * hx, dy: -dir * e * hy, n, bdx: bl * hx, bdy: bl * hy, layer: 0 });
          drawPhoto(c, W, H, Bs, t, ready, { dx: dir * (1 - e) * hx, dy: dir * (1 - e) * hy, n, bdx: bl * hx, bdy: bl * hy, layer: 1 }); break; }
        case 'whip': { // both photos fly past together, fastest (and most blurred) right on the beat
          const k0 = 1 / (1 + Math.exp(7)), sg = x => (1 / (1 + Math.exp(-14 * (x - pc))) - k0) / (1 - 2 * k0), e = clamp(sg(p), 0, 1), sp = Math.exp(-(((p - pc) * 5.5) ** 2)), bl = .02 + .45 * sp;
          drawPhoto(c, W, H, A, t, ready, { dx: -dir * e * hx, dy: -dir * e * hy, n: 9, bdx: bl * hx, bdy: bl * hy, layer: 0 });
          drawPhoto(c, W, H, Bs, t, ready, { dx: dir * (1 - e) * hx, dy: dir * (1 - e) * hy, n: 9, bdx: bl * hx, bdy: bl * hy, layer: 1 }); break; }
        case 'zoom': { const out = p < pc, q2 = out ? p / pc : (p - pc) / (1 - pc);
          if (out) drawPhoto(c, W, H, A, t, ready, { s: 1 + 1.4 * q2 * q2, n: 7, bs: .25 * q2 });
          else drawPhoto(c, W, H, Bs, t, ready, { s: .7 + .3 * easeIO(q2), n: 7, bs: .2 * (1 - q2), pz: pu });
          const fl = out ? q2 : 1 - q2; c.fillStyle = `rgba(255,255,255,${(.35 * fl * fl).toFixed(3)})`; c.fillRect(0, 0, W, H); break; }
        case 'spin': { const out = p < pc, q2 = out ? p / pc : (p - pc) / (1 - pc), an = dir * (out ? q2 * q2 : -((1 - q2) ** 2)) * .8;
          drawPhoto(c, W, H, out ? A : Bs, t, ready, { rot: an, s: out ? 1 + .5 * q2 * q2 : 1 + .5 * (1 - q2) ** 2, n: 7, brot: .18 * Math.abs(an) / .8 * dir }); break; }
        case 'glitch': { drawPhoto(c, W, H, p < pc ? A : Bs, t, ready, { pz: pu, dx: (rnd(Math.floor(t * 60)) - .5) * .02 * (1 - p) });
          glitchOver(c, W, H, p < pc ? p / pc : 1 - (p - pc) / (1 - pc) * .9, tr.j * 13 + Math.floor(t * 30)); break; }
        case 'panels': { drawPhoto(c, W, H, A, t, ready, {});
          const [L, lx] = buf('P0', W, H); lx.clearRect(0, 0, W, H); drawPhoto(lx, W, H, Bs, t, ready, {});
          const n = 3;
          for (let i = 0; i < n; i++) {
            const st = i * .14, e = easeIO(clamp((p - st) / (1 - .28), 0, 1)), d = (i % 2 ? 1 : -1) * dir;
            if (vert) { const y = H * i / n, h = H / n + 1; c.drawImage(L, 0, y, W, h, d * (1 - e) * W, y, W, h); }
            else { const x = W * i / n, w = W / n + 1; c.drawImage(L, x, 0, w, H, x, d * (1 - e) * H, w, H); }
          }
          break; }
        default: drawPhoto(c, W, H, Bs.s <= t ? Bs : A, t, ready, { pz: pu });
      }
    }
    if (B.look === 'film') filmOver(c, W, H, t);
    c.restore();
  }


  // the animation picker shows each style moving, with your own photos
  function styleIcons() {
    cancelAnimationFrame(B.iconRaf);
    let last = 0;
    const loop = now => {
      const cvs = [...document.querySelectorAll('#bSide [data-anim]')];
      if (B.closed || !cvs.length) return;
      B.iconRaf = requestAnimationFrame(loop);
      if (now - last < 45 || B.making) return; last = now;
      const ph = B.photos.slice(0, 2); if (!ph.length) return;
      const r0 = ready.get(ph[0]), r1 = ready.get(ph[1] || ph[0]);
      if (!r0 || !r1) { ph.forEach(p => { if (!ready.has(p)) bmp(p).then(it => it && ready.set(p, it)); }); return; }
      const save = { segs: B.segs, style: B.style, motion: B.motion, pulse: B.pulse };
      const T = 1.6, t = (now / 1000) % T, cut = .8, round = Math.floor(now / 1000 / T);
      B.motion = false; B.pulse = false;
      try {
        for (const cv of cvs) {
          const st = cv.dataset.anim, s2 = st === 'mix' ? MIX[round % MIX.length] : st, a = round % 2 ? ph[1] || ph[0] : ph[0], b = round % 2 ? ph[0] : ph[1] || ph[0];
          B.style = st; B.segs = [{ s: -2, e: cut, k: 0, photo: a, move: 0 }, { s: cut, e: 3, k: 1, photo: b, move: 1, tr: s2 }];
          drawAt(cv.getContext('2d'), cv.width, cv.height, t, ready);
        }
      } finally { Object.assign(B, save); }
    };
    B.iconRaf = requestAnimationFrame(loop);
  }
  // after picking a style, play the moment around the next cut so you can see it
  function previewCut() {
    if (!B.segs || B.segs.length < 2) return;
    const k = Math.min(B.segs.length - 1, Math.max(1, segAt(B.t).k + 1));
    stop(); B.t = Math.max(0, B.segs[k].s - .7); play();
  }

  /* ---------- preview (plays the song, frames follow the music) ---------- */
  const ready = new Map();
  function paint() {
    const cv = q('#bCv'); if (!cv) return;
    const c = cv.getContext('2d'), W = cv.width, H = cv.height;
    const empty = q('#bEmpty');
    if (!B.segs || !B.segs.length) {
      c.fillStyle = '#0b0908'; c.fillRect(0, 0, W, H);
      empty.innerHTML = !B.photos.length ? `<b>Drop photos here</b><span>or use “Add photos” on the left</span>` : !B.song ? `<b>Now a song</b><span>Pick one from your Sounds, or drop an MP3 here</span>` : `<div class="spin"></div><span>Finding the beat…</span>`;
      empty.style.display = ''; q('#bPlay').style.display = 'none'; return;
    }
    empty.style.display = 'none'; q('#bPlay').style.display = '';
    const g = segAt(B.t);
    for (const p of [g.photo, (B.segs[g.k + 1] || g).photo]) if (!ready.has(p)) bmp(p).then(it => { if (it) { ready.set(p, it); if (!B.playing) paint(); } });
    drawAt(c, W, H, B.t, ready);
    q('#bTime').textContent = `${fmt(B.t)} / ${fmt(B.dur)}`;
    drawStrip(true);
  }
  function sizePreview() {
    const box = q('#bPrev'), cv = q('#bCv'); if (!box || !cv) return;
    const [W, H] = sizeOf(B.shape, 1080), r = box.getBoundingClientRect(), sc = Math.min((r.width - 24) / W, (r.height - 24) / H);
    const pw = Math.round(W * Math.min(1, 720 / Math.max(W, H))), ph = Math.round(H * pw / W);
    cv.width = pw; cv.height = ph; cv.style.width = Math.max(40, W * sc) + 'px'; cv.style.height = Math.max(40, H * sc) + 'px';
    paint();
  }
  function play() {
    if (!B.segs || !B.segs.length) return;
    if (B.t >= B.dur - .05) B.t = 0;
    B.playing = true; q('#bPlay').classList.add('on');
    B.audio.currentTime = B.songIn + B.t; B.audio.volume = 1; B.audio.play().catch(() => {});
    const t0 = performance.now() - B.t * 1000;
    const loop = () => {
      if (!B.playing) return;
      // follow the music clock when it runs, otherwise the wall clock
      B.t = !B.audio.paused && B.audio.currentTime > 0 ? B.audio.currentTime - B.songIn : (performance.now() - t0) / 1000;
      const fade = B.dur - B.t; B.audio.volume = clamp(fade / 2, 0, 1);
      if (B.t >= B.dur) { B.t = B.dur; stop(); paint(); return; }
      paint(); B.raf = requestAnimationFrame(loop);
    };
    B.raf = requestAnimationFrame(loop);
  }
  function stop() { if (!B) return; B.playing = false; cancelAnimationFrame(B.raf); try { B.audio.pause(); } catch {} const b = q('#bPlay'); if (b) b.classList.remove('on'); }
  function toggle() { B.playing ? stop() : play(); }

  function drawStrip(light) {
    const cv = q('#bStrip'); if (!cv) return;
    const w = cv.clientWidth || 600, h = 74; if (cv.width !== w * 2) { cv.width = w * 2; cv.height = h * 2; }
    const c = cv.getContext('2d'); c.setTransform(2, 0, 0, 2, 0, 0); c.clearRect(0, 0, w, h);
    c.fillStyle = '#120e0b'; c.fillRect(0, 0, w, h);
    if (!B.beats) { c.fillStyle = '#5a4a3c'; c.font = '12px "Segoe UI"'; c.fillText(B.song ? 'Listening to the song…' : 'No song yet', 12, h / 2 + 4); return; }
    const D = B.beats.dur, X = t => t / D * w, bt = B.beats.beats;
    // chosen part of the song
    if (B.segs.length) { c.fillStyle = '#ff8a1f1c'; c.fillRect(X(B.songIn), 0, X(B.songIn + B.dur) - X(B.songIn), h); }
    // one bar per beat (taller = louder)
    for (let i = 0; i < bt.length; i++) { const x = X(bt[i]), hh = 6 + (h - 18) * (B.beats.loud[i] || 0); const inside = B.segs.length && bt[i] >= B.songIn - .01 && bt[i] <= B.songIn + B.dur; c.fillStyle = inside ? '#c9a27a' : '#4a3d31'; c.fillRect(x, (h - hh) / 2, Math.max(1, w / bt.length * .55), hh); }
    // cuts
    c.fillStyle = '#ff8a1f'; for (const g of B.segs) c.fillRect(X(B.songIn + g.s) - .75, 2, 1.5, h - 4);
    // playhead
    if (B.segs.length) { c.fillStyle = '#fff'; c.fillRect(X(B.songIn + B.t) - 1, 0, 2, h); }
  }

  /* ---------- side panel ---------- */
  function side() {
    const sd = q('#bSide'); if (!sd) return;
    const lib = (B.library || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const songName = B.song ? B.song.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : '';
    sd.innerHTML = `<h4>Photos <em>${B.photos.length}</em></h4>
      <div class="mthumbs" id="bThumbs">${B.photos.slice(0, 24).map(p => `<img src="${fileUrl(p)}" loading="lazy" title="${esc(p.split(/[\\/]/).pop())}">`).join('')}${B.photos.length > 24 ? `<span>+${B.photos.length - 24}</span>` : ''}</div>
      <div class="mrow2"><button class="ghost" id="bAdd">Add photos…</button>${typeof S !== 'undefined' && S.files && S.files.length ? `<button class="ghost" id="bFolder" title="Use the photos of the open picture folder">Picture folder</button>` : ''}${B.photos.length ? `<button class="ghost" id="bClear">Clear</button>` : ''}</div>
      <h4>Song</h4>
      <select id="bSong"><option value="">${lib.length ? 'Choose from your Sounds…' : 'No sounds in your library yet'}</option>${lib.map(s => `<option value="${esc(s.path)}" ${s.path === B.song ? 'selected' : ''}>${esc((s.folder ? s.folder + ' / ' : '') + s.name)}</option>`).join('')}${B.song && !lib.some(s => s.path === B.song) ? `<option value="${esc(B.song)}" selected>${esc(songName)}</option>` : ''}</select>
      <div class="mrow2"><button class="ghost" id="bPickSong">Choose a song file…</button></div>
      ${B.beats ? `<p class="muted small">♪ ${esc(songName)} · ${Math.round(B.beats.bpm)} BPM · ${B.beats.beats.length} beats</p>` : ''}
      <h4>Shape</h4><div class="mshape">${Object.entries(SHAPES).map(([k, s]) => `<button data-sh="${k}" class="${k === B.shape ? 'on' : ''}"><i class="r${k.replace(':', '')}"></i><b>${s.label}</b><small>${s.sub}</small></button>`).join('')}</div>
      <h4>Cut on</h4><div class="seg2 m4">${[['auto', 'Auto'], ['1', 'Every beat'], ['2', '2 beats'], ['4', '4 beats']].map(([k, l]) => `<button data-ev="${k}" class="${k === B.every ? 'on' : ''}">${l}</button>`).join('')}</div>
      <p class="muted small">${B.every === 'auto' ? 'Auto: about one photo per second, faster in the loud parts.' : ''}</p>
      <h4>Length</h4><div class="seg2 m4">${[['once', 'Each photo once'], ['30', '30 s'], ['60', '1 min'], ['song', 'Whole song']].map(([k, l]) => `<button data-len="${k}" class="${k === B.length ? 'on' : ''}">${l}</button>`).join('')}</div>
      <h4>Animation</h4><div class="mstyles">${Object.entries(STYLES).map(([k, v]) => `<button data-st="${k}" class="${k === B.style ? 'on' : ''}"><canvas width="176" height="100" data-anim="${k}"></canvas><b>${v.name}</b><small>${v.sub}</small></button>`).join('')}</div>
      <h4>Colour</h4><div class="seg2 m4">${Object.entries(LOOKS).map(([k, v]) => `<button data-lk="${k}" class="${k === B.look ? 'on' : ''}">${v.name}</button>`).join('')}</div>
      <label class="chk2"><input type="checkbox" id="bMotion" ${B.motion ? 'checked' : ''}> Slow movement on every photo</label>
      <label class="chk2"><input type="checkbox" id="bPulse" ${B.pulse ? 'checked' : ''}> Pulse on every beat</label>
      <h4>Quality</h4><div class="seg2">${[[720, '720p · faster'], [1080, '1080p HD']].map(([k, l]) => `<button data-q="${k}" class="${k === B.quality ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    q('#bAdd').onclick = async () => { const ps = await M.pickPhotos(); if (ps.length) setPhotos(ps, true); };
    const bf = q('#bFolder'); if (bf) bf.onclick = () => setPhotos(picturePaths());
    const bc = q('#bClear'); if (bc) bc.onclick = () => { stop(); setPhotos([]); };
    q('#bSong').onchange = e => { if (e.target.value) setSong(e.target.value); };
    q('#bPickSong').onclick = async () => { const p = await A.vid.pickAudio(); if (p) setSong(p); };
    sd.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { B.shape = b.dataset.sh; side(); sizePreview(); });
    sd.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => { B.every = b.dataset.ev; if (B.beats) B.start = B.beats.beats[phaseOf(nearestBeat(B.start || 0), everyN())]; side(); replan(); });
    sd.querySelectorAll('[data-len]').forEach(b => b.onclick = () => { B.length = b.dataset.len; side(); replan(); });
    sd.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { B.quality = +b.dataset.q; side(); });
    q('#bMotion').onchange = e => { B.motion = e.target.checked; paint(); };
    q('#bPulse').onchange = e => { B.pulse = e.target.checked; paint(); };
    sd.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { B.style = b.dataset.st; sd.querySelectorAll('[data-st]').forEach(x => x.classList.toggle('on', x === b)); replan(); previewCut(); });
    sd.querySelectorAll('[data-lk]').forEach(b => b.onclick = () => { B.look = b.dataset.lk; sd.querySelectorAll('[data-lk]').forEach(x => x.classList.toggle('on', x === b)); paint(); });
    styleIcons();
  }

  /* ---------- making the video ---------- */
  async function make() {
    if (!B.segs.length) return; stop(); B.making = true;
    const [W, H] = sizeOf(B.shape, B.quality), frames = Math.round(B.dur * FPS);
    const songName = B.song.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    const m = modal(`<div class="prog"><div class="ring" id="ring"></div><h3 id="pt">Making your montage…</h3><p id="ps">Getting the photos ready…</p><div class="pbar"><i id="pb"></i></div><div class="muted" id="pc">0%</div><div class="acts" style="margin-top:14px" id="pa"><button class="ghost" id="cn">Cancel</button></div></div>`);
    let cancelled = false, job = null; m.querySelector('#cn').onclick = () => { cancelled = true; };
    try {
      // every photo used, at full quality
      const all = new Map(); const uniq = [...new Set(B.segs.map(g => g.photo))];
      for (let i = 0; i < uniq.length; i++) { const it = await bmp(uniq[i]); if (it) all.set(uniq[i], it); if (cancelled) throw { cancelled: true }; q('#ps').textContent = `Getting the photos ready… ${i + 1} / ${uniq.length}`; }
      job = await M.start({ W, H, fps: FPS, song: B.song, songIn: B.songIn, dur: B.dur, name: `Beat montage — ${songName} (${SHAPES[B.shape].label})` });
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d', { willReadFrequently: true });
      q('#ps').textContent = `Putting ${B.segs.length} photos on the beat…`;
      // raw frames go straight to the video writer; a couple in flight so drawing and writing overlap
      const inflight = []; const send = async () => { if (!(await inflight.shift())) throw new Error('The video writer stopped'); };
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        if (cancelled) throw { cancelled: true };
        drawAt(c, W, H, i / FPS, all);
        inflight.push(M.frame(job.id, c.getImageData(0, 0, W, H).data));
        if (inflight.length >= 3) await send();
        if (i % 6 === 0) { const p = i / frames, el = (performance.now() - t0) / 1000, left = i > 30 ? el / i * (frames - i) : 0; q('#pb').style.width = p * 100 + '%'; q('#pc').textContent = Math.round(p * 100) + '%' + (left > 3 ? ` · about ${left > 90 ? Math.ceil(left / 60) + ' min' : Math.ceil(left) + ' s'} left` : ''); }
      }
      while (inflight.length) await send();
      q('#ps').textContent = 'Adding the song…';
      const r = await M.end(job.id); job = null; B.making = false;
      if (r.error) throw new Error(r.error);
      q('#pb').style.width = '100%'; q('#pc').textContent = '100%';
      q('#ring').className = 'ring done'; q('#ring').textContent = '✓'; q('#pt').textContent = 'Your montage is ready!';
      q('#ps').innerHTML = `${esc(r.file.split(/[\\/]/).pop())}<br><span class="muted">Exports › Beat montages</span>`;
      q('#pa').innerHTML = '<button class="ghost" id="cl">Close</button><button class="ghost" id="sf">Show in folder</button><button class="ghost" id="ph">Send to phones</button><button class="ghost" id="ed">Open in video editor</button><button class="primary" id="pl">Play video</button>';
      q('#cl').onclick = () => m.remove(); q('#sf').onclick = () => { bridge.reveal(r.file); m.remove(); }; q('#pl').onclick = () => { bridge.open(r.file); m.remove(); };
      q('#ph').onclick = () => { m.remove(); if (window.ShareUI) ShareUI.sharePaths([r.file]); };
      q('#ed').onclick = () => { m.remove(); q('#bX').click(); const t = document.querySelector('.tab[data-t="vid"]'); if (t) t.click(); if (window.VideoEditor) { if (!VideoEditor.state.clips.length) VideoEditor.setFormat(B.shape); VideoEditor.addVideos([r.file]); } };
    } catch (e) {
      B.making = false;
      if (job) { try { await M.cancel(job.id); } catch {} }
      if (e && e.cancelled) { m.remove(); return toast('Montage cancelled'); }
      q('#ring').className = 'ring done err'; q('#ring').textContent = '!'; q('#pt').textContent = 'The montage could not be made'; q('#ps').textContent = (e && e.message) || String(e);
      q('#pa').innerHTML = '<button class="ghost" id="cl">Close</button>'; q('#cl').onclick = () => m.remove();
    }
  }

  window.Montage = { open, _b: () => B, _draw: async (c, W, H, t) => { for (const g of B.segs.slice(0, 8)) if (!ready.has(g.photo)) { const it = await bmp(g.photo); if (it) ready.set(g.photo, it); } drawAt(c, W, H, t, ready); } };
})();

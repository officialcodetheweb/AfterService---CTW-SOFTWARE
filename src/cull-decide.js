/* =====================================================================
   Auto-cull decisions — pure logic, no Electron (easy to test)
   Input: measured photos. Output: which ones to suggest removing and why.
   Nothing is removed here; the user reviews every suggestion.
   ===================================================================== */
const LEVELS = {
  // blur thresholds are on the contrast-adjusted sharpness (sharpN): blurred photos measure ≈0.3–0.8, sharp ones ≥1.5
  gentle: { blurLo: .7, blurHi: 1.2, blurRel: .14, eye: .17, hash: 10, look: 16, gap: 20 },
  normal: { blurLo: .9, blurHi: 1.6, blurRel: .2, eye: .21, hash: 12, look: 20, gap: 30 },
  strict: { blurLo: 1.1, blurHi: 2.2, blurRel: .28, eye: .23, hash: 15, look: 26, gap: 45 }
};
const hamming = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } } return d; };
const lookDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

function mainFaces(r) {
  // faces big enough to matter: at least ~6% of the picture width, confident, roughly facing the camera
  return (r.faces || []).filter(f => f.score >= .55 && f.box[2] >= .06 && Math.abs(f.yaw) < .7);
}
function eyesClosed(f, L) {
  if (f.pitch > .42) return false;                       // looking down (reading, praying) — lids look closed, don't judge
  // both eyes must look shut — one low eye is usually a turned head, a wink or hair in the way
  const e = (f.earL + f.earR) / 2, hi = Math.max(f.earL, f.earR);
  return e < L.eye && hi < L.eye * 1.2;
}

function decide(items, opts = {}) {
  const L = LEVELS[opts.level] || LEVELS.normal, keep = Math.max(1, opts.keepPerGroup || 1);
  const ok = items.filter(x => x.r && !x.r.error);
  const S = r => r.sharpN != null ? r.sharpN : r.sharp / 20;
  const med = median(ok.map(x => S(x.r)));
  const blurT = Math.max(L.blurLo, Math.min(L.blurHi, med * L.blurRel));
  const out = new Map();
  for (const x of ok) {
    const r = x.r, faces = mainFaces(r), flags = [], why = [];
    let blur = 0;
    if (S(r) < blurT) { blur = S(r) < blurT * .65 ? 2 : 1; flags.push('blurry'); why.push(blur === 2 ? 'Very blurry' : 'Blurry'); }
    else if (faces.length) {
      // focus missed: picture has sharp parts but the main face is soft
      const big = faces.reduce((a, f) => f.box[2] > a.box[2] ? f : a);
      if (big.box[2] > .12 && big.sharpN != null && big.sharpN < .22 && S(r) > blurT * 1.6) { blur = 1; flags.push('blurry'); why.push('Face out of focus'); }
    }
    const closed = faces.filter(f => eyesClosed(f, L)).length;
    if (closed) { flags.push('eyes'); why.push(faces.length > 1 ? `${closed} of ${faces.length} with eyes closed` : 'Eyes closed'); }
    const dark = r.lum < 38 && r.pDark > .55, bright = r.pClip > .45 || (r.lum > 235 && r.pClip > .2);
    if (dark) { flags.push('dark'); why.push('Too dark'); }
    if (bright) { flags.push('bright'); why.push('Washed out'); }
    const q = Math.log(1 + 10 * S(r)) + (faces.length ? .6 * Math.log(1 + 10 * median(faces.map(f => f.sharpN != null ? f.sharpN : f.sharp / 30))) : 0) - 1.6 * closed - (dark ? 1 : 0) - (bright ? 1 : 0) + .15 * faces.length
      + (faces.length ? 6 * median(faces.map(f => Math.min(.34, (f.earL + f.earR) / 2))) : 0);   // in a burst, prefer the shot where eyes are more open
    out.set(x.path, { path: x.path, name: x.name, flags, why, blur, closed, faces: faces.length, q: +q.toFixed(3), group: null, best: false, dupOf: null, suggest: 'keep' });
  }

  // exact duplicates (same picture saved twice): same fingerprint, same size, same look AND same sharpness
  // (a blurred copy has the same fingerprint, so sharpness must match too). The better copy is kept.
  const byHash = new Map();
  for (const x of [...ok].sort((a, b) => out.get(b.path).q - out.get(a.path).q)) {
    const k = x.r.hash + '|' + x.r.w + 'x' + x.r.h, list = byHash.get(k) || [];
    const sameFaces = (a, b) => (a.faces || []).length === (b.faces || []).length && (a.faces || []).every((f, i) => Math.abs((f.earL + f.earR) - (b.faces[i].earL + b.faces[i].earR)) < .04);
    const prev = list.find(p => (p.size && p.size === x.size) || (lookDiff(p.r.look, x.r.look) < 1.5 && Math.abs(S(p.r) - S(x.r)) <= .04 * Math.max(S(p.r), S(x.r)) && sameFaces(p.r, x.r)));
    if (prev) { const d = out.get(x.path); d.dupOf = prev.path; d.flags.push('dup'); d.why.push('Duplicate of ' + prev.name); }
    else { list.push(x); byHash.set(k, list); }
  }

  // bursts / near-identical shots: taken close together and look the same
  const seq = ok.filter(x => !out.get(x.path).dupOf).sort((a, b) => (a.time - b.time) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  let groups = [], cur = [];
  const similar = (a, b) => {
    const dt = Math.abs(a.time - b.time) / 1000;
    if (a.timeExif && b.timeExif && dt > L.gap) return false;
    if (!(a.timeExif && b.timeExif) && dt > L.gap * 4) return false;
    return hamming(a.r.hash, b.r.hash) <= L.hash && lookDiff(a.r.look, b.r.look) <= L.look;
  };
  for (const x of seq) {
    if (cur.length && (similar(cur[cur.length - 1], x) || similar(cur[0], x))) cur.push(x);
    else { if (cur.length > 1) groups.push(cur); cur = [x]; }
  }
  if (cur.length > 1) groups.push(cur);
  groups.forEach((g, gi) => {
    const ranked = [...g].sort((a, b) => out.get(b.path).q - out.get(a.path).q);
    ranked.forEach((x, i) => {
      const d = out.get(x.path); d.group = gi; d.rank = i + 1; d.groupSize = g.length;
      if (i < keep) d.best = true;
      else { d.flags.push('similar'); d.why.push(`Similar shot — #${i + 1} of ${g.length}`); }
    });
  });

  // suggestion: remove = pre-ticked, check = shown but not ticked
  for (const d of out.values()) {
    if (d.dupOf || d.flags.includes('similar') || d.blur === 2 || (d.blur === 1 && !d.best)) d.suggest = 'remove';
    else if (d.blur === 1 && d.best && d.groupSize > 1) d.suggest = 'check';
    else if (d.blur === 1) d.suggest = 'remove';
    else if (d.flags.length) d.suggest = 'check';          // eyes closed alone (may be praying), too dark / bright
  }
  const list = [...out.values()];
  const n = f => list.filter(d => d.flags.includes(f)).length;
  return {
    list, groups: groups.map(g => g.map(x => x.path)), blurThreshold: +blurT.toFixed(1), median: +med.toFixed(1),
    counts: { total: items.length, checked: ok.length, failed: items.length - ok.length, blurry: n('blurry'), eyes: n('eyes'), similar: n('similar'), groups: groups.length, dup: n('dup'), dark: n('dark'), bright: n('bright'), remove: list.filter(d => d.suggest === 'remove').length, check: list.filter(d => d.suggest === 'check').length }
  };
}
module.exports = { decide, LEVELS, hamming, lookDiff };

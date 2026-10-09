/* =====================================================================
   Sermon clip finder — pure logic (no Electron), easy to test.
   Input: a transcript with word timings + loudness every 0.5 s.
   Output: the best self-contained moments for Reels / Shorts / Status, with reasons.
   Every clip starts at the beginning of a sentence and ends at the end of one.
   ===================================================================== */
const STRONG = /\b(god|jesus|christ|lord|holy spirit|faith|grace|mercy|love|hope|fear|worry|worship|pray|prayer|believe|trust|purpose|destiny|bless(ed|ing)?|miracle|heal(ing|ed)?|peace|joy|strength|strong|forgive(ness)?|victory|breakthrough|truth|freedom|free|power|promise|salvation|saved|heaven|cross|blood|kingdom|calling|favou?r|overcome|never|always|today|now|everything|nothing|anything)\b/gi;
const IMPERATIVE = /^(stop|start|choose|tell|let|don'?t|do not|remember|listen|look|stand|lift|turn|call|give|go|believe|trust|forgive|pray|say|never|always|know|hold on|keep|refuse|decide|watch|imagine)\b/i;
const RESPONSE = /\b(amen|hallelujah|halleluyah|praise the lord|praise god|can (somebody|i get an?) |somebody say|turn to your neighbou?r|say it with me|repeat after me|glory to god)\b|\[(applause|cheering|laughter|laughs?)\]|\((applause|cheering|laughter|laughs?)\)/i;
const ANNOUNCE = /\b(announcement|notice ?board|rehearsal|meeting|next week|this week'?s|thursday|wednesday|friday|saturday|monday|tuesday|at (six|seven|eight|five|\d)|parking|offering envelope|bank details|account number|ushers?|church office|registration|programme|program|bulletin|hallway)\b/gi;
const FILLER = /^(um+|uh+|erm|hmm+|ah+)$/i;
const CONTINUE = /^(and|but|so|because|or|then|which|that|also|plus)\b/i;
const BOOKS = 'Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation';
const NUM = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)(?:[- ](one|two|three|four|five|six|seven|eight|nine))?';
const SCRIPTURE = new RegExp(`\\b(?:(?:first|second|third|1|2|3)\\s+)?(${BOOKS})\\b[,\\s]*(?:chapter\\s+)?${NUM}(?:[:,\\s]+(?:verses?\\s+)?${NUM})?`, 'i');

function sentences(segments) {
  const words = segments.flatMap(s => s.words).filter(w => w.w && !/^\[.*\]$|^\(.*\)$/.test(w.w) || RESPONSE.test(w.w));
  const out = []; let cur = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i], nx = words[i + 1];
    cur.push(w);
    const end = /[.?!]["”']?$/.test(w.w) || !nx || nx.s - w.e > 1.1;
    if (end && cur.length) { out.push({ s: cur[0].s, e: cur[cur.length - 1].e, words: cur, text: cur.map(x => x.w).join(' ').replace(/\s+([,.?!])/g, '$1') }); cur = []; }
  }
  return out;
}
const dbAt = (rms, a, b) => { const i0 = Math.max(0, Math.floor(a * 2)), i1 = Math.min(rms.length, Math.ceil(b * 2)); if (i1 <= i0) return null; let s = 0; for (let i = i0; i < i1; i++) s += rms[i]; return s / (i1 - i0); };
const median = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

function scoreSentence(S, rms, base) {
  const t = S.text, n = S.words.length, why = [];
  let sc = 0;
  const strong = (t.match(STRONG) || []).length; sc += Math.min(3, strong) * .8;
  if (IMPERATIVE.test(t)) { sc += 1.2; why.push('Call to action'); }
  const you = (t.match(/\b(you|your|you're|yourself)\b/gi) || []).length; sc += Math.min(3, you) * .35;
  if (/\?$/.test(t)) sc += .5;
  if (n >= 4 && n <= 14 && strong) { sc += .9; why.push('Strong statement'); }
  if (/\bnot\b.*\b(but|is)\b|\bis not\b|\bisn'?t\b.*\./i.test(t) && strong) { sc += .7; why.push('Memorable contrast'); }
  const sm = t.match(SCRIPTURE); if (sm) { sc += 1.4; S.scripture = sm[0].replace(/\s+/g, ' '); why.push('Scripture: ' + S.scripture); }
  if (RESPONSE.test(t)) { sc += 1.3; S.response = true; why.push('Church responded'); }
  const ann = (t.match(ANNOUNCE) || []).length; if (ann) { sc -= 1.8 * ann; S.announce = true; }
  const fill = S.words.filter(w => FILLER.test(w.w.replace(/[^a-z]/gi, ''))).length; sc -= fill * .6;
  const lowConf = S.words.filter(w => w.p < .35).length / Math.max(1, n); if (lowConf > .3) sc -= 1;
  const db = dbAt(rms, S.s, S.e);
  if (db != null && base != null) { const lift = db - base; if (lift > 2.5) { sc += Math.min(2, lift / 3); why.push('Said with emphasis'); } if (lift < -8) sc -= .6; }
  S.score = sc; S.why = why; S.db = db; return S;
}

/* opts: { target: seconds (15/30/60/90), count, minGap } */
function findClips(transcript, rms = [], opts = {}) {
  const target = opts.target || 30, count = opts.count || 8;
  const lo = opts.min || target * .7, hi = opts.max || target * 1.35;   // e.g. Reels: 30–60 s
  const S = sentences(transcript.segments || []);
  if (!S.length) return { clips: [], sentences: 0 };
  const base = median(S.map(x => dbAt(rms, x.s, x.e)));
  S.forEach(x => scoreSentence(x, rms, rms.length ? base : null));
  // repetition = emphasis ("let me say it again")
  for (let i = 0; i < S.length; i++) for (let j = Math.max(0, i - 4); j < i; j++) {
    const a = S[i].text.toLowerCase().replace(/[^a-z ]/g, ''), b = S[j].text.toLowerCase().replace(/[^a-z ]/g, '');
    if (a.length > 18 && (a === b || (a.length > 30 && (a.includes(b.slice(0, 30)) || b.includes(a.slice(0, 30)))))) { S[i].score += 1.4; S[j].score += 1.2; if (!S[i].why.includes('Repeated for emphasis')) S[i].why.push('Repeated for emphasis'); }
  }
  const cands = [];
  for (let i = 0; i < S.length; i++) {
    let dur = 0, sum = 0, gaps = 0, ann = 0;
    for (let j = i; j < S.length; j++) {
      if (j > i) { const gap = S[j].s - S[j - 1].e; if (gap > 2.2) gaps += gap; }
      dur = S[j].e - S[i].s; sum += S[j].score; if (S[j].announce) ann++;
      if (dur > hi) break;
      if (dur < lo) continue;
      const n = j - i + 1, first = S[i], last = S[j];
      let sc = sum / Math.sqrt(n) + Math.max(0, first.score) * .5 + Math.max(0, last.score) * .35;
      if (CONTINUE.test(first.text)) sc -= 1.2;                     // starts in the middle of a thought
      if (/\?$/.test(first.text)) sc += .5;                         // a question is a good hook
      if (!/[.?!]["”']?$/.test(last.text)) sc -= .6;                 // cut mid-sentence
      if (last.response || /amen\.?$/i.test(last.text)) sc += .4;
      sc -= ann * 2 + gaps * .5;
      sc -= Math.abs(dur - target) / target * .8;                    // close to the length asked for
      cands.push({ i, j, s: Math.max(0, first.s - .15), e: last.e + .35, score: sc });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= count) break;
    if (picked.some(p => Math.min(p.e, c.e) - Math.max(p.s, c.s) > .15 * Math.min(p.e - p.s, c.e - c.s))) continue;
    if (c.score <= 0 && picked.length >= 2) break;
    picked.push(c);
  }
  const top = picked.length ? picked[0].score : 1, bot = Math.min(0, ...picked.map(p => p.score));
  const clips = picked.map(c => {
    const ss = S.slice(c.i, c.j + 1), best = [...ss].sort((a, b) => b.score - a.score)[0];
    const why = [...new Set(ss.flatMap(x => x.why))].slice(0, 4);
    let title = best.text.replace(/^(and|but|so|now|well),?\s+/i, ''); title = title.charAt(0).toUpperCase() + title.slice(1); if (title.length > 70) title = title.slice(0, 67).replace(/\s+\S*$/, '') + '…';
    return { start: +c.s.toFixed(2), end: +c.e.toFixed(2), dur: +(c.e - c.s).toFixed(1), score: Math.round(40 + 60 * (c.score - bot) / Math.max(.01, top - bot)), title, text: ss.map(x => x.text).join(' '), why, scripture: ss.map(x => x.scripture).find(Boolean) || null, sentences: ss.map(x => ({ s: x.s, e: x.e })) };
  });
  return { clips, sentences: S.length, allSentences: S.map(x => ({ s: x.s, e: x.e })) };
}
module.exports = { findClips, sentences, SCRIPTURE };

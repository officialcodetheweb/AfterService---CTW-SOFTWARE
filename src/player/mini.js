const $ = s => document.querySelector(s);
const PLAY = '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" width="13" height="13"><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/></svg>';
let st = { playing: false }, levels = new Array(14).fill(0), shown = new Array(14).fill(0), lastLv = 0;
['pv', 'nx', 'ex', 'cl'].forEach((id, i) => $('#' + id).onclick = () => mini.cmd(['prev', 'next', 'expand', 'close'][i]));
$('#pp').onclick = () => mini.cmd('toggle');
$('.tx').ondblclick = () => mini.cmd('expand');
mini.onState(s => {
  st = s; $('#pp').innerHTML = s.playing ? PAUSE : PLAY;
  $('#lbl').textContent = s.playing ? 'NOW PLAYING' : 'PAUSED';
  const txt = (s.title || '—') + (s.artist ? '  ·  ' + s.artist : ''), b = $('#t');
  if (b.dataset.txt !== txt) {
    b.dataset.txt = txt; b.textContent = txt; const mq = $('#mq'); mq.classList.remove('run');
    requestAnimationFrame(() => { if (b.scrollWidth - 40 > mq.clientWidth) { b.textContent = txt + '          ' + txt; mq.style.setProperty('--d', Math.max(8, txt.length * .35) + 's'); mq.classList.add('run'); } });
  }
});
mini.onLevels(l => { const n = levels.length; for (let i = 0; i < n; i++) levels[i] = l[Math.floor(i * l.length / n)] / 255; lastLv = performance.now(); });
const cv = $('#w'), x = cv.getContext('2d');
(function draw(now) {
  requestAnimationFrame(draw);
  const W = cv.width, H = cv.height, n = levels.length, bw = W / n, live = st.playing && now - lastLv < 400;
  x.clearRect(0, 0, W, H);
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#ffe08a'); g.addColorStop(.5, '#ff8a1f'); g.addColorStop(1, '#ffe08a');
  x.fillStyle = g;
  for (let i = 0; i < n; i++) {
    const target = live ? levels[i] : st.playing ? .25 + .2 * Math.sin(now / 260 + i * .7) : .06;
    shown[i] += (target - shown[i]) * (target > shown[i] ? .55 : .18);
    const h = Math.max(4, shown[i] * (H - 6)), bx = i * bw + bw * .2, w = bw * .6;
    x.beginPath(); x.roundRect(bx, (H - h) / 2, w, h, w / 2); x.fill();
  }
})(0);

const $ = s => document.querySelector(s), C = window.conv;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const human = n => n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B';
const LABEL = { image: 'Pictures', video: 'Videos', audio: 'Music & audio' };
let OUT = {}, items = [], seq = 0, outDir = null, running = false;
const target = { image: 'jpg', video: 'mp4', audio: 'mp3' };
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }

async function add(paths) {
  const known = new Set(items.map(i => i.path));
  const info = (await C.info(paths.filter(p => !known.has(p)))).map(x => ({ ...x, id: ++seq, fmt: null, state: 'ready', progress: 0 }));
  if (!info.length) { if (paths.length) toast('Those files are already in the list or are not supported'); return; }
  items.push(...info); render();
  for (const it of info) C.thumb(it.path).then(t => { it.thumb = t; const el = document.querySelector(`[data-id="${it.id}"] .th`); if (el && t) { el.style.backgroundImage = `url("${t}")`; el.textContent = ''; } });
}
const fmtOf = it => it.fmt || (OUT[it.kind].includes(target[it.kind]) ? target[it.kind] : OUT[it.kind][0]);
function render() {
  document.body.classList.toggle('has', items.length > 0);
  $('#lcount').textContent = `${items.length} file${items.length === 1 ? '' : 's'}`;
  $('#rows').innerHTML = items.map(it => {
    const st = it.state === 'working' ? `Converting… ${Math.round(it.progress * 100)}%<div class="bar"><i style="width:${it.progress * 100}%"></i></div>` : it.state === 'queued' ? 'Waiting…' : it.state === 'done' ? `✓ ${human(it.outSize || 0)} · Show` : it.state === 'failed' ? '✕ Failed' : it.state === 'cancelled' ? 'Cancelled' : human(it.size);
    const opts = OUT[it.kind].map(f => `<option value="${f}"${f === fmtOf(it) ? ' selected' : ''}>${f.toUpperCase()}</option>`).join('');
    return `<div class="it" data-id="${it.id}"><div class="th" style="${it.thumb ? `background-image:url('${it.thumb}')` : ''}">${it.thumb ? '' : it.ext.toUpperCase()}</div>
      <div class="nm"><b title="${esc(it.path)}">${esc(it.name)}</b><small>${it.state === 'failed' ? esc(it.error) : it.state === 'done' ? esc(it.out) : LABEL[it.kind]}</small></div>
      <div class="to"><span class="fr">${it.ext.toUpperCase()}</span>→<select ${running ? 'disabled' : ''}>${opts}</select></div>
      <div class="st ${it.state === 'done' ? 'ok' : it.state === 'failed' ? 'err' : ''}">${st}</div><button class="x" title="Remove">×</button></div>`;
  }).join('');
  $('#rows').querySelectorAll('.it').forEach(r => {
    const it = items.find(x => x.id === +r.dataset.id);
    r.querySelector('select').onchange = e => { it.fmt = e.target.value; it.state = 'ready'; renderSecs(); };
    r.querySelector('.x').onclick = () => { if (it.state === 'working' || it.state === 'queued') C.cancel([it.id]); items = items.filter(x => x !== it); render(); };
    r.querySelector('.st').onclick = () => { if (it.state === 'done') C.reveal(it.out); };
  });
  renderSecs();
}
function renderSecs() {
  const kinds = ['image', 'video', 'audio'].filter(k => items.some(i => i.kind === k));
  $('#secs').innerHTML = kinds.map(k => `<div class="sec" data-k="${k}"><h4>Convert ${LABEL[k].toLowerCase()} to</h4><div class="cap"><b>${items.filter(i => i.kind === k).length}</b> ${LABEL[k].toLowerCase()} in the list</div>
    <div class="chips">${OUT[k].map(f => `<button data-f="${f}" class="${target[k] === f ? 'on' : ''}">${f.toUpperCase()}</button>`).join('')}</div></div>`).join('');
  $('#secs').querySelectorAll('.sec').forEach(s => s.querySelectorAll('button').forEach(b => b.onclick = () => {
    const k = s.dataset.k; target[k] = b.dataset.f; items.forEach(i => { if (i.kind === k) { i.fmt = null; if (i.state !== 'working') i.state = 'ready'; } }); render();
  }));
  const pdf = items.some(i => i.kind === 'image' && fmtOf(i) === 'pdf');
  $('#pdfOneRow').classList.toggle('on', pdf && items.filter(i => i.kind === 'image' && fmtOf(i) === 'pdf').length > 1);
  const todo = items.filter(i => i.state !== 'done').length;
  $('#go').disabled = running || !todo; $('#go').textContent = running ? 'Converting…' : todo ? `Convert ${todo} file${todo === 1 ? '' : 's'}` : 'Convert';
}

async function go() {
  const todo = items.filter(i => i.state !== 'done'); if (!todo.length) return;
  const q = +$('#q').value, opts = it => ({ quality: q, outDir, maxSide: it.kind === 'image' ? +$('#imgSize').value : 0, height: it.kind === 'video' ? +$('#vidSize').value : 0 });
  running = true; $('#sum').textContent = '';
  let jobs = todo;
  if ($('#pdfOne').checked && $('#pdfOneRow').classList.contains('on')) {
    const pics = todo.filter(i => i.kind === 'image' && fmtOf(i) === 'pdf'); jobs = todo.filter(i => !pics.includes(i));
    pics.forEach(i => { i.state = 'working'; i.progress = .5; }); render();
    const r = await C.pdfAll(pics.map(i => i.path), outDir);
    pics.forEach(i => { if (r.error) { i.state = 'failed'; i.error = r.error; } else { i.state = 'done'; i.out = r.out; i.outSize = 0; } });
    if (!jobs.length) return finish();
  }
  jobs.forEach(i => { i.state = 'queued'; i.progress = 0; }); render();
  await C.start(jobs.map(i => ({ id: i.id, path: i.path, fmt: fmtOf(i), opts: opts(i) })));
}
function finish() {
  running = false; render();
  const ok = items.filter(i => i.state === 'done'), bad = items.filter(i => i.state === 'failed');
  $('#sum').innerHTML = `<b style="color:#9fe0a8">${ok.length} converted</b>${bad.length ? ` · <span style="color:#ff9a7a">${bad.length} failed</span>` : ''}` + (ok.length ? `<br><button class="gbtn" id="openOut">Open folder</button>` : '');
  const b = $('#openOut'); if (b) b.onclick = () => C.reveal(ok[ok.length - 1].out);
}
C.onState(s => { const it = items.find(i => i.id === s.id); if (!it) return; it.state = s.state; it.progress = s.progress || 0; const r = document.querySelector(`[data-id="${s.id}"] .st`); if (r) { r.className = 'st'; r.innerHTML = `Converting… ${Math.round(it.progress * 100)}%<div class="bar"><i style="width:${it.progress * 100}%"></i></div>`; } });
C.onDone(d => {
  const it = items.find(i => i.id === d.id); if (!it) return;
  if (d.out) { it.state = 'done'; it.out = d.out; it.outSize = d.size; } else if (d.cancelled) it.state = 'cancelled'; else { it.state = 'failed'; it.error = d.error; }
  if (!items.some(i => i.state === 'working' || i.state === 'queued')) finish(); else render();
});
C.onAdd(add);

/* presets */
const PRESETS = {
  iphone: () => { target.image = 'jpg'; $('#q').value = 92; $('#imgSize').value = 0; },
  whatsapp: () => { target.video = 'mp4'; $('#q').value = 70; $('#vidSize').value = 720; },
  audio: () => { target.video = 'mp3'; target.audio = 'mp3'; $('#q').value = 85; },
  icon: () => { target.image = 'ico'; },
  web: () => { target.image = 'webp'; $('#q').value = 80; $('#imgSize').value = 1280; },
  pdf: () => { target.image = 'pdf'; $('#pdfOne').checked = true; }
};
document.querySelectorAll('#presets button').forEach(b => b.onclick = () => {
  PRESETS[b.dataset.p](); $('#qv').textContent = $('#q').value; items.forEach(i => { i.fmt = null; if (i.state !== 'working') i.state = 'ready'; });
  document.querySelectorAll('#presets button').forEach(x => x.classList.toggle('on', x === b)); render(); toast(b.textContent + ' — ready');
});
$('#q').oninput = () => $('#qv').textContent = $('#q').value;
document.querySelectorAll('input[name=dest]').forEach(r => r.onchange = async () => {
  if (r.value === 'pick' && r.checked) { const d = await C.outDir(); if (d) { outDir = d; $('#destTxt').textContent = d; } else { document.querySelector('input[value=same]').checked = true; outDir = null; } }
  if (r.value === 'same' && r.checked) outDir = null;
});
$('#go').onclick = go;
$('#bFiles').onclick = $('#dFiles').onclick = async () => add(await C.addFiles());
$('#bFolder').onclick = $('#dFolder').onclick = async () => add(await C.addFolder());
$('#bEditor').onclick = () => C.editor();
$('#bClear').onclick = () => { if (running) C.cancel(items.map(i => i.id)); items = []; render(); };
$('#bClearDone').onclick = () => { items = items.filter(i => i.state !== 'done'); render(); };
document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
document.addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('dragging'); add([...e.dataTransfer.files].map(f => C.pathFor(f)).filter(Boolean)); });
(async () => { const i = await C.init(); OUT = i.OUT; render(); if (i.files.length) add(i.files); })();

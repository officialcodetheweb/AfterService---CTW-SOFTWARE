const $ = s => document.querySelector(s);
let me = '';
const msg = (t, ok) => { const m = $('#msg'); m.textContent = t; m.className = 'msg ' + (ok ? 'ok' : 'err'); };
lic.onState(s => {
  me = s.me || ''; $('#hw').textContent = me; $('#me').textContent = me;
  document.body.classList.toggle('theft', s.kind === 'theft');
  if (s.kind === 'theft') { $('#bd').textContent = s.bound || 'unknown (installation fingerprint missing)'; if (!s.bound) $('#ttxt').textContent = 'This copy of After Service was not installed with the official setup on this computer. It cannot run here — nothing can be opened or edited.'; return; }
  const st = $('#st'), T = { missing: ['ACTIVATION REQUIRED', 'Activate After Service'], expired: ['LICENCE EXPIRED', 'Your licence has expired'], device: ['WRONG COMPUTER', 'This licence is for another computer'], invalid: ['INVALID LICENCE', 'The saved licence is not valid'], clock: ['CLOCK PROBLEM', 'Check your date and time'], revoked: ['LICENCE CANCELLED', 'This licence was cancelled'] }[s.kind] || ['ACTIVATION REQUIRED', 'Activate After Service'];
  st.textContent = T[0]; st.classList.toggle('bad', s.kind !== 'missing'); $('#ttl').textContent = T[1];
  const P = {
    expired: `The licence${s.name ? ' for ' + s.name : ''} ended on ${s.exp}. Contact CTW Software — when they extend it online, After Service opens again by itself (keep it connected to the internet), or paste a new licence key below.`,
    revoked: 'CTW Software cancelled this licence. If you think this is a mistake, contact CTW Software — when they restore it, After Service opens again by itself.',
    device: `The saved licence was issued for Device ID ${s.licHw}. This computer's Device ID is shown below — ask CTW Software for a licence for it.`,
    invalid: (s.msg || 'The saved licence could not be verified.') + ' Paste a valid licence key below.',
    clock: `Your computer's clock is set earlier than the last time After Service ran (${s.last}). Set the correct date and time, then press Activate.`
  }[s.kind];
  if (P) $('#txt').textContent = P;
});
$('#cp').onclick = () => { lic.copy(me); $('#cp').textContent = 'Copied ✓'; setTimeout(() => $('#cp').textContent = 'Copy', 1500); };
$('#cp2').onclick = () => { lic.copy(me); $('#cp2').textContent = 'Copied ✓'; };
$('#ld').onclick = async () => { const k = await lic.file(); if (k) { $('#key').value = k; $('#go').click(); } };
$('#qt').onclick = $('#qt2').onclick = () => lic.quit();
$('#go').onclick = async () => {
  const k = $('#key').value.trim(); if (!k) return msg('Paste your licence key first.');
  $('#go').disabled = true; const r = await lic.activate(k); $('#go').disabled = false;
  msg(r.msg, r.ok); if (r.ok) $('#go').textContent = 'Starting…';
};
$('#key').addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) $('#go').click(); });

/* Typing fallback: some Windows PCs deliver key presses but never the typed characters (same fix as the editor). */
(function () {
  let handled = false;
  ['input', 'beforeinput', 'paste'].forEach(t => document.addEventListener(t, () => { handled = true; }, true));
  document.addEventListener('keydown', e => {
    const el = document.activeElement; if (!el || el.tagName !== 'TEXTAREA' || e.isComposing || e.altKey) return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key; let act = null;
    if (!ctrl && k.length === 1) act = () => document.execCommand('insertText', false, k);
    else if (!ctrl && k === 'Backspace') act = () => document.execCommand('delete');
    else if (ctrl && k.toLowerCase() === 'v') act = async () => { const t = await lic.paste(); if (t) document.execCommand('insertText', false, t); };
    if (!act) return; handled = false; setTimeout(() => { if (!handled && document.activeElement === el) act(); }, 30);
  }, true);
})();

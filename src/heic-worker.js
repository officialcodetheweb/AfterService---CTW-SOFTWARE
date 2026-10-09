// Runs in an Electron utility process so HEIC decoding (CPU heavy) never freezes the app.
const { heicTo } = require('./heic-core');
process.parentPort.on('message', async e => {
  const { id, input, output, opts } = e.data;
  try { process.parentPort.postMessage({ id, ok: true, result: await heicTo(input, output, opts) }); }
  catch (err) { process.parentPort.postMessage({ id, ok: false, error: String(err && err.message || err) }); }
});

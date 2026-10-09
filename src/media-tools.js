/* =====================================================================
   After Service — media conversion engine (main process)
   Used by the Converter app, phone/camera import and the Player tag editor.
   - HEIC/HEIF photos: heic-convert in background utility processes (keeps EXIF, fixes rotation)
   - every other image / video / audio format: the bundled ffmpeg
   ===================================================================== */
const { utilityProcess, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const { extractHeifExif, injectExif, resetOrientation, exifDate } = require('./heic-core');

const EXT = {
  image: ['heic', 'heif', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'ico', 'avif', 'jfif'],
  video: ['mp4', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'webm', 'mts', 'm2ts', '3gp', 'flv', 'mpg', 'mpeg', 'ts'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'opus', 'aiff', 'aif', 'amr']
};
const OUT = {
  image: ['jpg', 'png', 'webp', 'bmp', 'gif', 'tiff', 'ico', 'avif', 'pdf'],
  video: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'gif', 'mp3', 'wav', 'm4a', 'flac', 'ogg'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma']
};
const kindOf = f => { const e = path.extname(f).slice(1).toLowerCase(); return Object.keys(EXT).find(k => EXT[k].includes(e)) || null; };
const isHeic = f => /\.(heic|heif)$/i.test(f);

module.exports = function initMediaTools({ ff, probe, CACHE }) {
  /* ---------------- HEIC worker pool ---------------- */
  const workerFile = path.join(__dirname, 'heic-worker.js');
  const size = Math.max(1, Math.min(4, os.cpus().length - 1));
  const pool = [], queue = [], pending = new Map(); let seq = 0;
  function spawn() {
    const w = utilityProcess.fork(workerFile, [], { serviceName: 'After Service HEIC converter', stdio: 'ignore' });
    w.busy = true; w.on('spawn', () => { w.busy = false; pump(); });   // messages sent before 'spawn' are lost
    w.on('message', m => { const p = pending.get(m.id); pending.delete(m.id); w.busy = false; if (p) m.ok ? p.res(m.result) : p.rej(new Error(m.error)); pump(); });
    w.on('exit', () => { const i = pool.indexOf(w); if (i >= 0) pool.splice(i, 1); for (const [id, p] of pending) if (p.w === w) { pending.delete(id); p.rej(new Error('HEIC converter stopped')); } pump(); });
    pool.push(w); return w;
  }
  function pump() {
    while (queue.length) {
      let w = pool.find(x => !x.busy); if (!w && pool.length < size) { spawn(); return; } if (!w) return;
      const job = queue.shift(); w.busy = true; pending.set(job.id, { ...job, w }); w.postMessage({ id: job.id, input: job.input, output: job.output, opts: job.opts });
    }
  }
  const heic = (input, output, opts = {}) => new Promise((res, rej) => { queue.push({ id: ++seq, input, output, opts, res, rej }); pump(); });
  function stopWorkers() { for (const w of pool.splice(0)) try { w.kill(); } catch {} }

  /* ---------------- helpers ---------------- */
  function uniqueOut(dir, base, ext) { let p = path.join(dir, `${base}.${ext}`), k = 2; while (fs.existsSync(p)) p = path.join(dir, `${base} (${k++}).${ext}`); return p; }
  const tmpFile = ext => { fs.mkdirSync(CACHE, { recursive: true }); return path.join(CACHE, 'conv_' + crypto.randomBytes(6).toString('hex') + '.' + ext); };
  function jpegExif(buf) {
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
    for (let p = 2; p + 4 < buf.length && buf[p] === 0xFF;) {
      const m = buf[p + 1], len = buf.readUInt16BE(p + 2);
      if (m === 0xE1 && buf.toString('latin1', p + 4, p + 10) === 'Exif\0\0') return Buffer.from(buf.subarray(p + 10, p + 2 + len));
      if (m === 0xDA) break; p += 2 + len;
    }
    return null;
  }
  async function runFF(args, dur, onProgress, keep) {
    const r = await ff(['-hide_banner', '-y', ...args.slice(0, -1), '-progress', 'pipe:1', '-nostats', args[args.length - 1]], {
      onOut: d => { const m = String(d).match(/out_time_us=(\d+)/); if (m && dur && onProgress) onProgress(Math.min(1, +m[1] / 1e6 / dur)); }, keep
    });
    if (r.code !== 0) { const e = (r.err.split('\n').filter(l => l.trim()).slice(-2).join(' ') || 'conversion failed'); throw new Error(e.length > 300 ? e.slice(-300) : e); }
  }
  const resizeFilter = max => max > 0 ? `scale=w='min(iw,${max})':h='min(ih,${max})':force_original_aspect_ratio=decrease` : null;

  /* ---------------- images ---------------- */
  async function packIco(src, out) {
    const meta = await probe(src), maxSide = Math.max(meta.w || 256, meta.h || 256);
    const sizes = [16, 24, 32, 48, 64, 128, 256].filter(s => s <= Math.max(16, maxSide));
    const imgs = [];
    for (const s of sizes) {
      const r = await ff(['-hide_banner', '-loglevel', 'error', '-i', src, '-frames:v', '1', '-vf', `scale=${s}:${s}:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=${s}:${s}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`, '-f', 'image2pipe', '-c:v', 'png', 'pipe:1']);
      if (r.out.length) imgs.push([s, r.out]);
    }
    if (!imgs.length) throw new Error('Could not read this picture');
    const head = Buffer.alloc(6 + 16 * imgs.length); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4); let off = head.length;
    imgs.forEach(([s, b], i) => { const o = 6 + 16 * i; head[o] = s >= 256 ? 0 : s; head[o + 1] = s >= 256 ? 0 : s; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(b.length, o + 8); head.writeUInt32LE(off, o + 12); off += b.length; });
    await fs.promises.writeFile(out, Buffer.concat([head, ...imgs.map(x => x[1])]));
  }
  async function imagesToPdf(srcs, out) {
    // Each picture on its own A4 page (portrait or landscape to suit), rendered by Chromium's PDF printer.
    const pages = [];
    for (const s of srcs) { const r = await ff(['-hide_banner', '-loglevel', 'error', '-i', s, '-frames:v', '1', '-vf', resizeFilter(2400), '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1']); if (!r.out.length) throw new Error('Could not read ' + path.basename(s)); const m = await probe(s); pages.push({ uri: 'data:image/jpeg;base64,' + r.out.toString('base64'), land: (m.w || 1) > (m.h || 1) }); }
    const landscape = pages.filter(p => p.land).length > pages.length / 2;
    const html = `<!doctype html><html><head><style>@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:0}html,body{margin:0}
      .pg{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;page-break-after:always;overflow:hidden}.pg:last-child{page-break-after:auto}
      img{max-width:96%;max-height:96%;object-fit:contain}</style></head><body>${pages.map(p => `<div class="pg"><img src="${p.uri}"></div>`).join('')}</body></html>`;
    const tmp = tmpFile('html'); await fs.promises.writeFile(tmp, html);
    const w = new BrowserWindow({ show: false, width: 800, height: 1100, webPreferences: { offscreen: true, javascript: false } });
    try { await w.loadFile(tmp); const pdf = await w.webContents.printToPDF({ landscape, printBackground: true, pageSize: 'A4', margins: { marginType: 'none' }, preferCSSPageSize: true }); await fs.promises.writeFile(out, pdf); }
    finally { w.destroy(); fs.promises.unlink(tmp).catch(() => {}); }
  }
  async function convertImage(input, output, fmt, opts = {}) {
    const q = clampQ(opts.quality), maxSide = +opts.maxSide || 0;
    const buf = await fs.promises.readFile(input);
    let src = input, tiff = null, tmp = null, date = null;
    try {
      if (isHeic(input)) {
        tiff = extractHeifExif(buf);
        if ((fmt === 'jpg' || fmt === 'png') && !maxSide) { await heic(input, output, { format: fmt === 'jpg' ? 'JPEG' : 'PNG', quality: q / 100 }); return output; }
        tmp = tmpFile('png'); await heic(input, tmp, { format: 'PNG' }); src = tmp;
      } else if (/\.(jpe?g|jfif)$/i.test(input)) tiff = jpegExif(buf);
      date = (tiff && exifDate(tiff)) || (await fs.promises.stat(input)).mtime;
      if (fmt === 'ico') await packIco(src, output);
      else if (fmt === 'pdf') await imagesToPdf([src], output);
      else {
        const vf = [resizeFilter(maxSide)].filter(Boolean);
        let a;
        if (fmt === 'jpg') a = ['-i', src, '-f', 'lavfi', '-i', 'color=c=white', '-filter_complex', `[0:v]${vf.length ? vf.join(',') + ',' : ''}format=rgba[img];[1][img]scale2ref[bg][fg];[bg][fg]overlay=shortest=1:format=auto,format=yuvj444p`, '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', String(Math.round(2 + (100 - q) / 100 * 22)), output];
        else {
          const v = vf.slice(); let c;
          if (fmt === 'png') c = ['-c:v', 'png'];
          else if (fmt === 'webp') c = ['-c:v', 'libwebp', '-quality', String(q), ...(q >= 100 ? ['-lossless', '1'] : [])];
          else if (fmt === 'bmp') c = ['-c:v', 'bmp'];
          else if (fmt === 'tiff') c = ['-c:v', 'tiff', '-compression_algo', 'lzw'];
          else if (fmt === 'gif') { v.push('split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse'); c = []; }
          else if (fmt === 'avif') { v.push('scale=trunc(iw/2)*2:trunc(ih/2)*2', 'format=yuv420p'); c = ['-c:v', 'libaom-av1', '-still-picture', '1', '-crf', String(Math.round(63 - q * 0.45)), '-cpu-used', '6']; }
          else throw new Error('Unsupported picture format: ' + fmt);
          a = ['-i', src, ...(v.length ? ['-vf', v.join(',')] : []), '-frames:v', '1', ...c, ...(fmt === 'avif' ? ['-f', 'avif'] : ['png', 'bmp', 'tiff'].includes(fmt) ? ['-update', '1'] : []), output];
        }
        await runFF(a);
        if (fmt === 'jpg' && tiff) await fs.promises.writeFile(output, injectExif(await fs.promises.readFile(output), resetOrientation(tiff)));
      }
      try { await fs.promises.utimes(output, date, date); } catch {}
      return output;
    } finally { if (tmp) fs.promises.unlink(tmp).catch(() => {}); }
  }
  const clampQ = q => Math.max(1, Math.min(100, Math.round(+q || 90)));

  /* ---------------- video & audio ---------------- */
  async function convertAV(input, output, fmt, opts = {}, onProgress, keep) {
    const info = await probe(input), q = clampQ(opts.quality), H = +opts.height || 0;
    const crf = Math.round(35 - q * 0.17);                   // 90 → 20, 50 → 26
    const scale = H && info.hasVideo ? [`scale='if(gt(iw,ih),-2,min(${H},iw))':'if(gt(iw,ih),min(${H},ih),-2)'`] : [];
    const audioOnly = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma'].includes(fmt);
    if (!audioOnly && !info.hasVideo) throw new Error('This file has no picture — choose an audio format.');
    if (audioOnly && !info.hasAudio) throw new Error('This file has no sound to convert.');
    const abr = q >= 85 ? '256k' : q >= 60 ? '192k' : '128k';
    const A = {
      mp3: ['-c:a', 'libmp3lame', '-q:a', String(q >= 85 ? 0 : q >= 60 ? 2 : 5)], wav: ['-c:a', 'pcm_s16le'], m4a: ['-c:a', 'aac', '-b:a', abr], aac: ['-c:a', 'aac', '-b:a', abr, '-f', 'adts'],
      flac: ['-c:a', 'flac'], ogg: ['-c:a', 'libvorbis', '-q:a', String(Math.round(q / 12))], opus: ['-c:a', 'libopus', '-b:a', q >= 85 ? '160k' : '128k'], wma: ['-c:a', 'wmav2', '-b:a', abr]
    };
    let a;
    if (audioOnly) a = ['-i', input, '-vn', '-map_metadata', '0', ...A[fmt], output];
    else if (fmt === 'gif') {
      const w = Math.min(+opts.height ? +opts.height : 480, 720);
      a = ['-i', input, '-t', String(Math.min(info.dur || 30, +opts.gifSeconds || 30)), '-filter_complex', `fps=12,scale='min(${w},iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0', output];
    } else {
      const v = {
        mp4: ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', abr, '-movflags', '+faststart'],
        mov: ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', abr, '-movflags', '+faststart'],
        mkv: ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', abr],
        webm: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf + 12), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '128k'],
        avi: ['-c:v', 'mpeg4', '-q:v', String(Math.max(2, Math.round(12 - q / 10))), '-vtag', 'xvid', '-c:a', 'libmp3lame', '-q:a', '2']
      }[fmt];
      if (!v) throw new Error('Unsupported video format: ' + fmt);
      a = ['-i', input, ...(scale.length ? ['-vf', scale.join(',')] : []), '-map', '0:v:0', '-map', '0:a?', '-map_metadata', '0', ...v, output];
    }
    await runFF(a, info.dur, onProgress, keep);
    return output;
  }

  /* ---------------- one entry point ---------------- */
  async function convert(input, fmt, opts = {}, onProgress, keep) {
    const kind = kindOf(input); if (!kind) throw new Error('This file type is not supported');
    fmt = String(fmt).toLowerCase(); fmt = { jpeg: 'jpg', tif: 'tiff', jfif: 'jpg' }[fmt] || fmt;
    const dir = opts.outDir || path.dirname(input), base = path.basename(input, path.extname(input));
    fs.mkdirSync(dir, { recursive: true });
    const output = uniqueOut(dir, base, fmt);
    try {
      if (kind === 'image' && OUT.image.includes(fmt)) await convertImage(input, output, fmt, opts);
      else if (kind === 'image' && path.extname(input).toLowerCase() === '.gif' && ['mp4', 'webm', 'mov'].includes(fmt)) await convertAV(input, output, fmt, opts, onProgress, keep);
      else await convertAV(input, output, fmt, opts, onProgress, keep);
      return output;
    } catch (e) { fs.promises.unlink(output).catch(() => {}); throw e; }
  }
  return { EXT, OUT, kindOf, isHeic, heic, convert, convertImage, imagesToPdf, stopWorkers, uniqueOut };
};
module.exports.EXT = EXT; module.exports.OUT = OUT; module.exports.kindOf = kindOf;

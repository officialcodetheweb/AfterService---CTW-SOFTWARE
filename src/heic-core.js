/* HEIC/HEIF → JPEG/PNG conversion that keeps the photo's EXIF data (date taken, camera, GPS…).
   Decoding uses heic-convert (libheif compiled to WebAssembly — no native modules, works offline).
   libheif already applies the HEIF rotation/mirror, so the copied EXIF Orientation is reset to 1
   (otherwise Windows would rotate the picture a second time). */
const fs = require('fs');

/* ---------- read the Exif item out of a HEIF file (ISO BMFF boxes: meta → iinf/iloc) ---------- */
function boxes(buf, start, end) {
  const out = [];
  for (let p = start; p + 8 <= end;) {
    let size = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), hdr = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    out.push({ type, start: p, body: p + hdr, end: p + size });
    p += size;
  }
  return out;
}
function extractHeifExif(buf) {
  try {
    const meta = boxes(buf, 0, buf.length).find(b => b.type === 'meta'); if (!meta) return null;
    const inner = boxes(buf, meta.body + 4, meta.end);            // meta is a FullBox (4 bytes version/flags)
    const iinf = inner.find(b => b.type === 'iinf'), iloc = inner.find(b => b.type === 'iloc');
    if (!iinf || !iloc) return null;
    // iinf: find item id with item_type 'Exif'
    const iv = buf[iinf.body]; let p = iinf.body + 4; p += iv === 0 ? 2 : 4;
    let exifId = null;
    for (const inf of boxes(buf, p, iinf.end)) {
      if (inf.type !== 'infe') continue;
      const v = buf[inf.body]; if (v < 2) continue;
      const q = inf.body + 4, id = v === 2 ? buf.readUInt16BE(q) : buf.readUInt32BE(q), typeOff = q + (v === 2 ? 2 : 4) + 2;
      if (buf.toString('latin1', typeOff, typeOff + 4) === 'Exif') { exifId = id; break; }
    }
    if (exifId == null) return null;
    // iloc: locate the item's bytes
    const v = buf[iloc.body]; let q = iloc.body + 4;
    const a = buf[q], b = buf[q + 1], offSize = a >> 4, lenSize = a & 15, baseSize = b >> 4, idxSize = v >= 1 ? b & 15 : 0; q += 2;
    const rd = n => { let x = 0; for (let i = 0; i < n; i++) x = x * 256 + buf[q + i]; q += n; return x; };
    const count = v < 2 ? rd(2) : rd(4);
    for (let i = 0; i < count; i++) {
      const id = v < 2 ? rd(2) : rd(4); if (v >= 1) rd(2);
      rd(2); const base = rd(baseSize), ext = rd(2); const parts = [];
      for (let e = 0; e < ext; e++) { if (idxSize) rd(idxSize); const off = rd(offSize), len = rd(lenSize); parts.push(buf.subarray(base + off, base + off + len)); }
      if (id === exifId) {
        const data = Buffer.concat(parts); if (data.length < 10) return null;
        const skip = data.readUInt32BE(0);                       // offset to the TIFF header
        let tiff = data.subarray(4 + skip);
        if (tiff.toString('latin1', 0, 6) === 'Exif\0\0') tiff = tiff.subarray(6);
        const bo = tiff.toString('latin1', 0, 2); return bo === 'II' || bo === 'MM' ? Buffer.from(tiff) : null;
      }
    }
  } catch {}
  return null;
}
/* set EXIF Orientation (tag 0x0112 in IFD0) to 1 = normal */
function resetOrientation(tiff) {
  try {
    const le = tiff.toString('latin1', 0, 2) === 'II', r16 = o => le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o), r32 = o => le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o);
    const ifd = r32(4), n = r16(ifd);
    for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (r16(e) === 0x0112) { le ? tiff.writeUInt16LE(1, e + 8) : tiff.writeUInt16BE(1, e + 8); } }
  } catch {}
  return tiff;
}
/* read DateTimeOriginal (or DateTime) from a TIFF/EXIF block → Date */
function exifDate(tiff) {
  try {
    const le = tiff.toString('latin1', 0, 2) === 'II', r16 = o => le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o), r32 = o => le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o);
    const tag = (ifd, want) => { const n = r16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (r16(e) === want) return e; } return -1; };
    const str = e => { const cnt = r32(e + 4), off = cnt > 4 ? r32(e + 8) : e + 8; return tiff.toString('latin1', off, off + cnt).replace(/\0.*$/, ''); };
    const ifd0 = r32(4); let s = null;
    const ex = tag(ifd0, 0x8769); if (ex >= 0) { const sub = r32(ex + 8), d = tag(sub, 0x9003); if (d >= 0) s = str(d); }
    if (!s) { const d = tag(ifd0, 0x0132); if (d >= 0) s = str(d); }
    const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(s || ''); if (!m) return null;
    const dt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]); return isNaN(dt) ? null : dt;
  } catch { return null; }
}
/* put an APP1 Exif segment right after the JPEG SOI marker */
function injectExif(jpeg, tiff) {
  if (!tiff || tiff.length > 65000 || jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) return jpeg;
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]), seg = Buffer.alloc(4);
  seg[0] = 0xFF; seg[1] = 0xE1; seg.writeUInt16BE(payload.length + 2, 2);
  let p = 2; if (jpeg[2] === 0xFF && jpeg[3] === 0xE0) p = 4 + jpeg.readUInt16BE(4);   // keep JFIF APP0 first
  return Buffer.concat([jpeg.subarray(0, p), seg, payload, jpeg.subarray(p)]);
}

let convert = null;
async function heicTo(input, output, { format = 'JPEG', quality = 0.92 } = {}) {
  convert = convert || require('heic-convert');
  const buf = await fs.promises.readFile(input);
  let out = Buffer.from(await convert({ buffer: buf, format, quality }));
  const tiff = extractHeifExif(buf);
  if (tiff && format === 'JPEG') out = injectExif(out, resetOrientation(tiff));
  await fs.promises.writeFile(output, out);
  // keep the photo's date on the file (Explorer "Date modified" and our own sorting)
  const d = (tiff && exifDate(tiff)) || (await fs.promises.stat(input)).mtime;
  try { await fs.promises.utimes(output, d, d); } catch {}
  return { output, exif: !!tiff, date: d && d.toISOString() };
}
module.exports = { heicTo, extractHeifExif, injectExif, resetOrientation, exifDate };

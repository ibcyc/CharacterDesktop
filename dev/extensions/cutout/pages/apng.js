// Writes an animated PNG (APNG) from frames of the same size, so a cut-out animation keeps its soft edges (GIF has
// only on/off transparency). Written from the PNG and APNG specifications; the compression is the browser's own
// (CompressionStream). Its source also runs in the editor's background worker.
async function cutoutWriteAPNG(frames, width, height, delays) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = bytes => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u16 = n => [(n >>> 8) & 255, n & 255];
  const join = parts => {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  };
  const chunk = (type, data) => {
    const body = join([new TextEncoder().encode(type), data instanceof Uint8Array ? data : Uint8Array.from(data)]);
    return join([Uint8Array.from(u32(body.length - 4)), body, Uint8Array.from(u32(crc(body)))]);
  };
  const deflate = async bytes => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  // Each row filtered with Paeth (type 4), which suits pictures and keeps the file small.
  const filtered = rgba => {
    const stride = width * 4, out = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      const row = y * stride, at = y * (stride + 1) + 1;
      out[at - 1] = 4;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? rgba[row + i - 4] : 0, b = y ? rgba[row - stride + i] : 0, c = i >= 4 && y ? rgba[row - stride + i - 4] : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        out[at + i] = (rgba[row + i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    return out;
  };
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', [...u32(width), ...u32(height), 8, 6, 0, 0, 0]), chunk('acTL', [...u32(frames.length), ...u32(0)])];
  let sequence = 0;
  for (let i = 0; i < frames.length; i++) {
    // Delays in ms. As browsers do for GIF, one under 20 ms plays as 100 ms.
    const delay = Math.min(65535, delays[i] >= 20 ? Math.round(delays[i]) : 100);
    // Every frame is whole: it replaces the one before (dispose none, blend source).
    parts.push(chunk('fcTL', [...u32(sequence++), ...u32(width), ...u32(height), ...u32(0), ...u32(0), ...u16(delay), ...u16(1000), 0, 0]));
    const data = await deflate(filtered(frames[i]));
    parts.push(i ? chunk('fdAT', join([Uint8Array.from(u32(sequence++)), data])) : chunk('IDAT', data));
  }
  parts.push(chunk('IEND', []));
  return join(parts);
}

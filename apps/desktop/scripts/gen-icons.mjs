// Generates placeholder tray/app icons (accent-colored disc) without any
// image dependency: hand-rolled PNG encoder (RGBA, zlib-deflated scanlines).
// Run: node scripts/gen-icons.mjs  → resources/tray.png (16px), resources/icon.png (256px)
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(size, drawPixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = drawPixel(x, y);
      raw.set([r, g, b, a], row + 1 + x * 4);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Anti-aliased disc in the accent color (#8B7CF0). */
function disc(size) {
  const c = (size - 1) / 2;
  const radius = size * 0.42;
  return png(size, (x, y) => {
    const dist = Math.hypot(x - c, y - c);
    const alpha = Math.round(Math.max(0, Math.min(1, radius - dist + 0.5)) * 255);
    return [0x8b, 0x7c, 0xf0, alpha];
  });
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../resources');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'tray.png'), disc(16));
writeFileSync(join(outDir, 'icon.png'), disc(256));
console.log('icons written to', outDir);

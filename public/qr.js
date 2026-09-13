// Minimal QR code generator (byte mode, error correction level M, versions 1-10).
// Enough for a pairing link. Returns a square boolean matrix; true is a dark module.
// Based on ISO/IEC 18004; no dependencies.
'use strict';

const QR = (() => {
  // [total codewords, ec codewords per block, blocks in group 1, data per block g1, blocks g2, data per block g2] for level M.
  const BLOCKS = [
    null,
    [26, 10, 1, 16, 0, 0],
    [44, 16, 1, 28, 0, 0],
    [70, 26, 1, 44, 0, 0],
    [100, 18, 2, 32, 0, 0],
    [134, 24, 2, 43, 0, 0],
    [172, 16, 4, 27, 0, 0],
    [196, 18, 4, 31, 0, 0],
    [242, 22, 2, 38, 2, 39],
    [292, 22, 3, 36, 2, 37],
    [346, 26, 4, 43, 1, 44],
  ];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  // Galois field GF(256) with polynomial 0x11d.
  const EXP = new Array(512);
  const LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  function generator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function ecc(data, degree) {
    const gen = generator(degree);
    const res = data.concat(new Array(degree).fill(0));
    for (let i = 0; i < data.length; i++) {
      const factor = res[i];
      if (!factor) continue;
      for (let j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j], factor);
    }
    return res.slice(data.length);
  }

  function dataCapacity(version) {
    const [, , b1, d1, b2, d2] = BLOCKS[version];
    return b1 * d1 + b2 * d2;
  }

  function encodeData(bytes, version) {
    const bits = [];
    const push = (value, length) => {
      for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
    };
    push(0b0100, 4); // byte mode
    push(bytes.length, version < 10 ? 8 : 16);
    for (const b of bytes) push(b, 8);
    const capacityBits = dataCapacity(version) * 8;
    push(0, Math.min(4, capacityBits - bits.length));
    while (bits.length % 8) bits.push(0);
    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xec; codewords.length < dataCapacity(version); pad = pad === 0xec ? 0x11 : 0xec) codewords.push(pad);
    return codewords;
  }

  function interleave(data, version) {
    const [, ecLen, b1, d1, b2, d2] = BLOCKS[version];
    const blocks = [];
    let offset = 0;
    for (let i = 0; i < b1; i++, offset += d1) blocks.push(data.slice(offset, offset + d1));
    for (let i = 0; i < b2; i++, offset += d2) blocks.push(data.slice(offset, offset + d2));
    const eccBlocks = blocks.map((block) => ecc(block, ecLen));
    const out = [];
    const maxData = Math.max(d1, d2);
    for (let i = 0; i < maxData; i++) for (const block of blocks) if (i < block.length) out.push(block[i]);
    for (let i = 0; i < ecLen; i++) for (const block of eccBlocks) out.push(block[i]);
    return out;
  }

  function bchFormat(mask) {
    // Level M = 00.
    const data = (0b00 << 3) | mask;
    let value = data << 10;
    for (let i = 14; i >= 10; i--) if ((value >> i) & 1) value ^= 0x537 << (i - 10);
    return ((data << 10) | value) ^ 0x5412;
  }

  function bchVersion(version) {
    let value = version << 12;
    for (let i = 17; i >= 12; i--) if ((value >> i) & 1) value ^= 0x1f25 << (i - 12);
    return (version << 12) | value;
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  function build(version, codewords, mask) {
    const size = version * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, dark) => {
      m[r][c] = dark;
      fixed[r][c] = true;
    };
    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = r0 + r;
          const cc = c0 + c;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          const dark = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
          set(rr, cc, dark);
        }
      }
    };
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    const centers = ALIGN[version];
    const last = centers.length - 1;
    for (let i = 0; i <= last; i++) {
      for (let j = 0; j <= last; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        const r = centers[i];
        const c = centers[j];
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
    set(size - 8, 8, true); // dark module
    // Reserve format areas.
    for (let i = 0; i < 9; i++) {
      if (!fixed[8][i]) set(8, i, false);
      if (!fixed[i][8]) set(i, 8, false);
    }
    for (let i = 0; i < 8; i++) {
      set(8, size - 1 - i, false);
      set(size - 1 - i, 8, false);
    }
    if (version >= 7) {
      const bits = bchVersion(version);
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >> i) & 1) === 1;
        const a = Math.floor(i / 3);
        const b = (i % 3) + size - 11;
        set(a, b, dark);
        set(b, a, dark);
      }
    }
    // Place data bits in the zigzag.
    const bits = [];
    for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
    let index = 0;
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let k = 0; k < size; k++) {
        const r = upward ? size - 1 - k : k;
        for (const c of [col, col - 1]) {
          if (fixed[r][c]) continue;
          const bit = index < bits.length ? bits[index++] === 1 : false;
          m[r][c] = MASKS[mask](r, c) ? !bit : bit;
        }
      }
      upward = !upward;
    }
    // Format information, two copies.
    const format = bchFormat(mask);
    const bit = (i) => ((format >> i) & 1) === 1;
    for (let i = 0; i < 6; i++) m[i][8] = bit(i);
    m[7][8] = bit(6);
    m[8][8] = bit(7);
    m[8][7] = bit(8);
    for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) m[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bit(i);
    m[size - 8][8] = true;
    return m;
  }

  function penalty(m) {
    const size = m.length;
    let score = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        let run = 1;
        for (let b = 1; b < size; b++) {
          const cur = pass ? m[b][a] : m[a][b];
          const prev = pass ? m[b - 1][a] : m[a][b - 1];
          if (cur === prev) {
            run++;
            if (run === 5) score += 3;
            else if (run > 5) score++;
          } else run = 1;
        }
      }
    }
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) if (m[r][c] === m[r + 1][c] && m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c + 1]) score += 3;
    let dark = 0;
    for (const row of m) for (const v of row) if (v) dark++;
    score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return score;
  }

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let version = 1;
    while (version <= 10 && dataCapacity(version) < bytes.length + 2 + (version < 10 ? 0 : 1)) version++;
    if (version > 10) throw new Error('Text too long for a QR code');
    const codewords = interleave(encodeData(bytes, version), version);
    let best = null;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const m = build(version, codewords, mask);
      const score = penalty(m);
      if (score < bestScore) {
        best = m;
        bestScore = score;
      }
    }
    return best;
  }

  return { encode, _internals: { ecc, bchFormat, bchVersion, encodeData, interleave, build } };
})();

if (typeof module !== 'undefined') module.exports = QR;

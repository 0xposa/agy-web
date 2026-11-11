// Pure Node.js QR Code generator for terminal (Unicode half-blocks)
const EC_BLOCKS = [7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30];
const NUM_BLOCKS = [1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25];
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function rawBits(ver) {
  let bits = (16 * ver + 128) * ver + 64;
  if (ver < 2) return bits;
  let align = Math.floor(ver / 7) + 2;
  return bits - ((25 * align - 10) * align - 55) - (ver >= 7 ? 36 : 0);
}

function dataBytes(ver) {
  return Math.floor(rawBits(ver) / 8) - EC_BLOCKS[ver - 1] * NUM_BLOCKS[ver - 1];
}

function bch(val, deg, poly) {
  let rem = val;
  for (let i = 0; i < deg; i++) rem = (rem << 1) ^ ((rem >>> (deg - 1)) * poly);
  return (val << deg) | rem;
}

function alignCoords(ver, size) {
  if (ver === 1) return [];
  let count = Math.floor(ver / 7) + 2;
  let step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
  return [6, ...Array.from({ length: count - 1 }, (_, i) => size - 7 - (count - 2 - i) * step)];
}

function drawFormat(maskIdx, size, set) {
  let fmt = bch(8 | maskIdx, 10, 1335) ^ 21522;
  let bit = (i) => ((fmt >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}

function drawFunctionPatterns(ver, size, set) {
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (let [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        let x = cx + dx, y = cy + dy;
        let dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  let coords = alignCoords(ver, size);
  let last = coords.length - 1;
  coords.forEach((cx, ix) =>
    coords.forEach((cy, iy) => {
      if ((ix === 0 && iy === 0) || (ix === 0 && iy === last) || (ix === last && iy === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    })
  );
  drawFormat(0, size, set);
  if (ver < 7) return;
  let verInfo = bch(ver, 12, 7973);
  for (let i = 0; i < 18; i++) {
    let x = size - 11 + (i % 3);
    let y = Math.floor(i / 3);
    let b = ((verInfo >>> i) & 1) === 1;
    set(x, y, b);
    set(y, x, b);
  }
}

function gfMul(a, b) {
  let p = 0;
  for (let i = 7; i >= 0; i--) {
    p = (p << 1) ^ ((p >>> 7) * 285);
    p ^= ((b >>> i) & 1) * a;
  }
  return p;
}

function rsPoly(deg) {
  let poly = Array(deg).fill(0);
  poly[deg - 1] = 1;
  let root = 1;
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < deg; j++) {
      poly[j] = gfMul(poly[j], root);
      if (j + 1 < deg) poly[j] ^= poly[j + 1];
    }
    root = gfMul(root, 2);
  }
  return poly;
}

function rsRemainder(data, poly) {
  return data.reduce((rem, byte) => {
    let factor = byte ^ rem[0];
    return [...rem.slice(1), 0].map((v, i) => v ^ gfMul(poly[i], factor));
  }, poly.map(() => 0));
}

function encodeData(bytes, ver) {
  let cap = dataBytes(ver);
  let bits = [];
  let pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(4, 4);
  pushBits(bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach((b) => pushBits(b, 8));
  pushBits(0, Math.min(4, cap * 8 - bits.length));
  pushBits(0, (8 - (bits.length % 8)) % 8);
  let cw = Array.from({ length: bits.length / 8 }, (_, i) =>
    bits.slice(i * 8, i * 8 + 8).reduce((acc, b) => (acc << 1) | b, 0)
  );
  return [...cw, ...Array.from({ length: cap - cw.length }, (_, i) => (i % 2 === 0 ? 236 : 17))];
}

function addErrorCorrection(data, ver) {
  let numBlocks = NUM_BLOCKS[ver - 1];
  let ecLen = EC_BLOCKS[ver - 1];
  let totalBytes = Math.floor(rawBits(ver) / 8);
  let shortBlocks = numBlocks - (totalBytes % numBlocks);
  let shortDataLen = Math.floor(totalBytes / numBlocks) - ecLen;
  let poly = rsPoly(ecLen);
  let blocks = Array.from({ length: numBlocks }, (_, i) => {
    let offset = i * shortDataLen + Math.max(0, i - shortBlocks);
    return data.slice(offset, offset + shortDataLen + (i < shortBlocks ? 0 : 1));
  });
  let interleave = (arr, maxLen) =>
    Array.from({ length: maxLen }, (_, col) =>
      arr.flatMap((row) => (col < row.length ? [row[col]] : []))
    ).flat();
  return [...interleave(blocks, shortDataLen + 1), ...interleave(blocks.map((b) => rsRemainder(b, poly)), ecLen)];
}

function placeCodewords(grid, reserved, codewords) {
  let size = grid.length;
  let bitIdx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        let x = right - j;
        let y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (reserved[y][x] || bitIdx >= codewords.length * 8) continue;
        grid[y][x] = ((codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1;
        bitIdx++;
      }
    }
  }
}

function linePenalty(line) {
  let len = line.length;
  let runHistory = [0, 0, 0, 0, 0, 0, 0];
  let pushRun = (r) => {
    runHistory.pop();
    runHistory.unshift(runHistory[0] === 0 ? r + len : r);
  };
  let finderPenalty = () => {
    let n = runHistory[1];
    let core = n > 0 && runHistory[2] === n && runHistory[3] === n * 3 && runHistory[4] === n && runHistory[5] === n;
    return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
           (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
  };
  let score = 0, cur = false, run = 0;
  for (let bit of line) {
    if (bit === cur) {
      run++;
      if (run === 5) score += 3;
      else if (run > 5) score++;
      continue;
    }
    pushRun(run);
    if (!cur) score += finderPenalty() * 40;
    cur = bit;
    run = 1;
  }
  if (cur) {
    pushRun(run);
    run = 0;
  }
  pushRun(run + len);
  return score + finderPenalty() * 40;
}

function penalty(grid) {
  let size = grid.length;
  let cols = grid.map((_, x) => grid.map((row) => row[x]));
  let p13 = [...grid, ...cols].reduce((acc, line) => acc + linePenalty(line), 0);
  let p2 = grid
    .slice(1)
    .flatMap((row, y) =>
      row.slice(1).filter((val, x) => val === row[x] && val === grid[y][x] && val === grid[y][x + 1])
    ).length;
  let dark = grid.flat().filter(Boolean).length;
  let total = size * size;
  return p13 + p2 * 3 + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
}

function makeMatrix(text) {
  let bytes = Buffer.from(text, "utf8");
  let ver = Array.from({ length: 40 }, (_, i) => i + 1).find(
    (v) => 4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataBytes(v) * 8
  );
  if (ver === undefined) throw new RangeError(`Text too long for QR code: ${bytes.length} bytes`);
  let size = ver * 4 + 17;
  let grid = Array.from({ length: size }, () => Array(size).fill(false));
  let reserved = Array.from({ length: size }, () => Array(size).fill(false));
  drawFunctionPatterns(ver, size, (x, y, val) => {
    grid[y][x] = val;
    reserved[y][x] = true;
  });
  placeCodewords(grid, reserved, addErrorCorrection(encodeData(bytes, ver), ver));
  let candidates = MASKS.map((fn, idx) => {
    let masked = grid.map((row, y) => row.map((val, x) => val !== (!reserved[y][x] && fn(x, y))));
    drawFormat(idx, size, (x, y, val) => {
      masked[y][x] = val;
    });
    return masked;
  });
  let scores = candidates.map(penalty);
  return candidates[scores.indexOf(Math.min(...scores))];
}

function padMatrix(matrix, border) {
  let size = matrix.length + border * 2;
  let emptyRow = () => Array(size).fill(false);
  let topBottom = Array.from({ length: border }, emptyRow);
  let side = Array(border).fill(false);
  return [...topBottom, ...matrix.map((r) => [...side, ...r, ...side]), ...Array.from({ length: border }, emptyRow)];
}

function renderTerminalQR(text, opts = {}) {
  let padded = padMatrix(makeMatrix(text), opts.border ?? 2);
  return Array.from({ length: Math.ceil(padded.length / 2) }, (_, rowPair) =>
    padded[rowPair * 2]
      .map((topDark, col) => {
        let botDark = padded[rowPair * 2 + 1]?.[col] ?? true;
        if (topDark) return botDark ? " " : "\u2584";
        return botDark ? "\u2580" : "\u2588";
      })
      .join("")
  ).join("\n");
}

module.exports = { renderTerminalQR };

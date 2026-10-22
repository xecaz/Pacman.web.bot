// Pac-Man autoplay bot for pacman.live (shaunew/Pac-Man).
// Runs in the page (MAIN world). Reads the game by hooking canvas drawImage, simulates the ghosts' own
// targeting rules over every route ~29 tiles ahead, and presses arrow keys.
// Console: __pac.newTurboRun(), __pac.newRun(), __pac.attach(), __pac.stop()
(() => {
'use strict';
if (window.__pac) return;

// ---------------------------------------------------------------- maze (from the game source, 28x36)
const MAP_PACMAN =
  "____________________________" + "____________________________" + "____________________________" +
  "||||||||||||||||||||||||||||" + "|............||............|" + "|.||||.|||||.||.|||||.||||.|" +
  "|o||||.|||||.||.|||||.||||o|" + "|.||||.|||||.||.|||||.||||.|" + "|..........................|" +
  "|.||||.||.||||||||.||.||||.|" + "|.||||.||.||||||||.||.||||.|" + "|......||....||....||......|" +
  "||||||.||||| || |||||.||||||" + "_____|.||||| || |||||.|_____" + "_____|.||          ||.|_____" +
  "_____|.|| |||--||| ||.|_____" + "||||||.|| |______| ||.||||||" + "      .   |______|   .      " +
  "||||||.|| |______| ||.||||||" + "_____|.|| |||||||| ||.|_____" + "_____|.||          ||.|_____" +
  "_____|.|| |||||||| ||.|_____" + "||||||.|| |||||||| ||.||||||" + "|............||............|" +
  "|.||||.|||||.||.|||||.||||.|" + "|.||||.|||||.||.|||||.||||.|" + "|o..||.......  .......||..o|" +
  "|||.||.||.||||||||.||.||.|||" + "|||.||.||.||||||||.||.||.|||" + "|......||....||....||......|" +
  "|.||||||||||.||.||||||||||.|" + "|.||||||||||.||.||||||||||.|" + "|..........................|" +
  "||||||||||||||||||||||||||||" + "____________________________" + "____________________________";

const COLS = 28, ROWS = 36, N = COLS * ROWS, INF = 9999;
const DIRS = ['up', 'left', 'down', 'right'];               // the game's tie-break order
const DX = {up: 0, left: -1, down: 0, right: 1}, DY = {up: -1, left: 0, down: 1, right: 0};
const OPP = {up: 'down', down: 'up', left: 'right', right: 'left'};
const KEYS = {up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37], right: ['ArrowRight', 39]};
const wrapX = x => (x + COLS) % COLS;
const idx = (x, y) => y * COLS + wrapX(x);
const tileChar = (x, y) => (y < 0 || y >= ROWS) ? '_' : MAP_PACMAN[wrapX(x) + y * COLS];
const isFloor = (x, y) => { const c = tileChar(x, y); return c === ' ' || c === '.' || c === 'o'; };
const isDotTile = (x, y) => { const c = tileChar(x, y); return c === '.' || c === 'o'; };
const open = (x, y) => y >= 0 && y < ROWS && isFloor(x, y);
const isTunnel = (x, y) => y === 17 && (x <= 5 || x >= 22);
const noUp = (x, y) => (x === 12 || x === 15) && (y === 14 || y === 26);
const exits = (x, y) => DIRS.filter(d => open(x + DX[d], y + DY[d]));
const tileKey = (x, y) => x + ',' + y;
const CORNER = {blinky: {x: 25, y: 0}, pinky: {x: 2, y: 0}, inky: {x: 27, y: 34}, clyde: {x: 0, y: 34}};
const PELLETS = [[1, 6], [26, 6], [1, 26], [26, 26]];

// ---------------------------------------------------------------- canvas calibration
// The game fits its 290x354 screen to the window (scale = min((innerWidth-10)/290, (innerHeight-10)/354)) and
// rebuilds the canvas and sprite atlas on every resize, e.g. when a browser infobar appears or goes away.
// All pixel constants below were measured at scale 1.8225 and are multiplied by K = scale/1.8225.
const REF_SCALE = 1.8225, SCREEN_W = 290, SCREEN_H = 354;
let SCALE = REF_SCALE, K = 1, OFFX = 40.0, OFFY = 39.6, CELL = 40.0847;
function updateGeometry() {
  const c = document.getElementById('canvas');
  if (!c || !c.width) return;
  let s = Math.min((window.innerWidth - 10) / SCREEN_W, (window.innerHeight - 10) / SCREEN_H);
  if (Math.abs(Math.floor(SCREEN_W * s) - c.width) > 1) s = c.width / SCREEN_W;   // mid-resize: trust the canvas
  if (s === SCALE) return;
  SCALE = s; K = s / REF_SCALE;
  OFFX = 40.0 * K; OFFY = 39.6 * K; CELL = 40.0847 * K;
  P.simCache = null;
}
const canvasToTile = (px, py) => ({x: Math.floor((px - OFFX) / SCALE / 8), y: Math.floor((py - OFFY) / SCALE / 8)});
const tileOf = a => { const t = canvasToTile(a.px, a.py); return {x: Math.max(0, Math.min(27, t.x)), y: t.y}; };
const dotCanvas = (tx, ty) => ({x: (14.541 * tx + 66.17) * K, y: (14.489 * ty + 67.98) * K});
const isDotRGB = (D, i) => D[i] > 200 && D[i + 1] > 140 && D[i + 1] < 215 && D[i + 2] > 120 && D[i + 2] < 210;

// ---------------------------------------------------------------- per-level game tables
const SPEEDS = {   // stepSizes, steps per frame
  1:  {pac: 1.0,   ghost: 0.9375, pacF: 1.125,  ghostF: 0.625,  tunnel: 0.5},
  2:  {pac: 1.125, ghost: 1.0625, pacF: 1.1875, ghostF: 0.6875, tunnel: 0.5625},
  5:  {pac: 1.25,  ghost: 1.1875, pacF: 1.25,   ghostF: 0.75,   tunnel: 0.625},
  21: {pac: 1.125, ghost: 1.1875, pacF: 1.125,  ghostF: 0.75,   tunnel: 0.625},
};
const FRIGHT_S = [6, 5, 4, 3, 2, 5, 2, 2, 1, 5, 2, 1, 1, 3, 1, 1, 0, 1, 0];
const ELROY_DOTS = lv => lv === 1 ? 20 : lv === 2 ? 30 : lv <= 5 ? 40 : lv <= 8 ? 50 : lv <= 11 ? 60 : lv <= 14 ? 80 : lv <= 18 ? 100 : 120;
const SCHED = {   // mode switches in frames (60/s), paused while frightened
  1: [[420, 'chase'], [1620, 'scatter'], [2040, 'chase'], [3240, 'scatter'], [3540, 'chase'], [4740, 'scatter'], [5040, 'chase']],
  2: [[420, 'chase'], [1620, 'scatter'], [2040, 'chase'], [3240, 'scatter'], [3540, 'chase'], [3540 + 1033 * 60, 'scatter'], [3541 + 1033 * 60, 'chase']],
  3: [[300, 'chase'], [1500, 'scatter'], [1800, 'chase'], [3000, 'scatter'], [3300, 'chase'], [3300 + 1037 * 60, 'scatter'], [3301 + 1037 * 60, 'chase']],
};

const P = {
  turbo: false, running: false, wanted: false, waitingFocus: false, note: '',
  stats: {levels: 0, deaths: 0},
  eaten: new Set(), absent: new Map(), pelletAbsent: new Map(),
  lastDir: null, lastTile: null, heldCode: null, pressCount: 0, levelPressesExtra: 0, levelLog: [],
  simCache: null, dotsOnScreen: undefined, live: null,
  clock: {frames: 0, last: null, started: false, trusted: false},
  // tunables
  SIM: {HORIZON: 26, GHOST: 1.0, GHOST_TUNNEL: 0.5, PAC: 1.067, PAC_DOT_PAUSE: 0.13, PAC_FRIGHT: 1.2,
        GHOST_FRIGHT: 0.67, FRIGHT_TICKS: 40, HIT_R: 1.0},
  FRAMES_PER_TICK: 8.45, GHOST_MARGIN: 1.04, GHOST_W: 60, ELROY: 20, ADVANCE_FRAC: 0.2,
  bait: false, fruitOn: false,
};
window.__pac = P;

// ---------------------------------------------------------------- reading the screen
let draws = [], recording = false, gameCtx = null;
const proto = CanvasRenderingContext2D.prototype;
const origDrawImage = proto.drawImage;
proto.drawImage = function (...args) {
  if (recording) {
    try {
      if (this.canvas && this.canvas.id === 'canvas') {
        const m = this.getTransform();
        draws.push({args: args.map(a => typeof a === 'number' ? a : 'IMG'), m: [m.a, m.b, m.c, m.d, m.e, m.f]});
      }
    } catch (e) {}
  }
  return origDrawImage.apply(this, args);
};
const ctx = () => {
  if (!gameCtx) { const c = document.getElementById('canvas'); if (c) gameCtx = c.getContext('2d'); }
  return gameCtx;
};
const screen = () => { const c = ctx(); return c.getImageData(0, 0, c.canvas.width, c.canvas.height); };

// Atlas: row 0 fruit, rows 1-4 Blinky/Pinky/Inky/Clyde (col = dir*2+frame), row 5 eyes(0-3)/scared(4-5)/flashing(6-7),
// row 6 Pac-Man. A frame = sprite draws after the last background blit; each actor is drawn 3x.
const NAMES = {1: 'blinky', 2: 'pinky', 3: 'inky', 4: 'clyde'};
P.readFrame = async function (waitMs) {
  updateGeometry();
  draws = []; recording = true;
  await new Promise(r => setTimeout(r, waitMs));
  recording = false;
  const all = draws; draws = [];
  let lastBg = -1;
  all.forEach((d, i) => { if (d.args.length < 9) lastBg = i; });
  if (lastBg < 0) return {pacman: null, ghosts: [], fruit: null};
  const out = {pacman: null, ghosts: [], fruit: null};
  const seen = new Set();
  for (const d of all.slice(lastBg + 1)) {
    if (d.args.length < 9) continue;
    const [, sx, sy, , , dx, dy] = d.args;
    const [a, b, c, dd, e, f] = d.m;
    const px = a * dx + c * dy + e, py = b * dx + dd * dy + f;
    const row = Math.round(sy / CELL), col = Math.round(sx / CELL);
    const key = row + ':' + Math.round(px) + ',' + Math.round(py);
    if (seen.has(key)) continue;
    seen.add(key);
    if (row === 6) out.pacman = {px, py, dir: col === 0 ? null : DIRS[Math.floor((col - 1) / 2)]};
    else if (row >= 1 && row <= 4) out.ghosts.push({name: NAMES[row], px, py, dir: DIRS[Math.floor(col / 2)], state: 'normal'});
    else if (row === 5) out.ghosts.push({name: '?', px, py, dir: null, state: col >= 6 ? 'flashing' : col >= 4 ? 'scared' : 'eyes'});
    else if (row === 0) out.fruit = {px, py};
  }
  return out;
};

// ---------------------------------------------------------------- dots, pellets, lives
P.updateEaten = function (pac) {   // mark the dots on every tile Pac-Man passed since the last read
  const t = canvasToTile(pac.px, pac.py), prev = P.lastTile;
  const mark = (x, y) => { if (isDotTile(x, y)) P.eaten.add(tileKey(x, y)); };
  if (prev && (prev.x !== t.x || prev.y !== t.y)) {
    if (prev.y === t.y && Math.abs(t.x - prev.x) <= 6) { const s = t.x > prev.x ? 1 : -1; for (let x = prev.x; x !== t.x; x += s) mark(x, t.y); }
    else if (prev.x === t.x && Math.abs(t.y - prev.y) <= 6) { const s = t.y > prev.y ? 1 : -1; for (let y = prev.y; y !== t.y; y += s) mark(t.x, y); }
  }
  mark(t.x, t.y);
  P.lastTile = t;
};

// pixel check of every small dot; a dot absent on 3 reads is eaten. Dots next to an actor are not trusted.
P.verifyDots = function (fr) {
  const img = screen(), W = img.width, D = img.data;
  const actors = fr ? [fr.pacman, ...fr.ghosts].filter(Boolean).map(tileOf) : [];
  const rad = Math.max(2, Math.round(3 * K));
  let present = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!isDotTile(x, y) || tileChar(x, y) === 'o') continue;
    const key = tileKey(x, y);
    if (actors.some(t => Math.abs(t.x - x) <= 1 && Math.abs(t.y - y) <= 1)) { if (!P.eaten.has(key)) present++; continue; }
    const c = dotCanvas(x, y);
    let seen = false;
    for (let dy = -rad; dy <= rad && !seen; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (isDotRGB(D, ((Math.round(c.y) + dy) * W + Math.round(c.x) + dx) * 4)) { seen = true; break; }
    }
    if (seen) { present++; P.absent.delete(key); P.eaten.delete(key); continue; }
    const n = (P.absent.get(key) || 0) + 1;
    P.absent.set(key, n);
    if (n >= 3) P.eaten.add(key);
  }
  P.dotsOnScreen = present;
  return present;
};

// power pellets blink, so they need a long absence before they count as eaten
P.verifyPellets = function () {
  const img = screen(), W = img.width, D = img.data;
  const rad = Math.max(3, Math.round(5 * K)), need = Math.max(4, Math.round(12 * K * K));
  for (const [x, y] of PELLETS) {
    const key = tileKey(x, y), c = dotCanvas(x, y), cx = Math.round(c.x), cy = Math.round(c.y);
    let n = 0;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (isDotRGB(D, ((cy + dy) * W + cx + dx) * 4)) n++;
    if (n >= need) { P.eaten.delete(key); P.pelletAbsent.set(key, 0); }
    else { const a = (P.pelletAbsent.get(key) || 0) + 1; P.pelletAbsent.set(key, a); if (a >= 15) P.eaten.add(key); }
  }
};

// spare-life icons: yellow blobs below the maze, left half
P.countLives = function () {
  const c = ctx(), W = c.canvas.width, H = c.canvas.height, y0 = Math.round(555 * K), minBlob = Math.max(10, Math.round(40 * K * K));
  const img = c.getImageData(0, y0, Math.floor(W / 2), H - y0), w = img.width, h = img.height, D = img.data;
  const yellow = i => D[i] > 200 && D[i + 1] > 200 && D[i + 2] < 90;
  const seen = new Uint8Array(w * h);
  let blobs = 0;
  for (let p = 0; p < w * h; p++) {
    if (seen[p] || !yellow(p * 4)) continue;
    let n = 0; const st = [p]; seen[p] = 1;
    while (st.length) {
      const q = st.pop(); n++;
      const qx = q % w, qy = (q / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const r = ny * w + nx;
        if (!seen[r] && yellow(r * 4)) { seen[r] = 1; st.push(r); }
      }
    }
    if (n >= minBlob) blobs++;
  }
  return blobs;
};

// ---------------------------------------------------------------- input
function sendKey(type, key, code) {
  const ev = new KeyboardEvent(type, {key, code: key, keyCode: code, which: code, bubbles: true, cancelable: true});
  Object.defineProperty(ev, 'keyCode', {get: () => code});
  Object.defineProperty(ev, 'which', {get: () => code});
  window.dispatchEvent(ev);
}
P.releaseAll = function () {
  for (const d in KEYS) sendKey('keyup', KEYS[d][0], KEYS[d][1]);
  P.heldCode = null;
};
// the game ignores a keydown while its key is still "held", so release first
P.pulseDirection = function (dir) {
  const [key, code] = KEYS[dir];
  if (P.heldCode !== null && P.heldCode !== code) {
    const od = Object.keys(KEYS).find(d => KEYS[d][1] === P.heldCode);
    sendKey('keyup', KEYS[od][0], P.heldCode);
  }
  sendKey('keyup', key, code);
  sendKey('keydown', key, code);
  P.heldCode = code;
  P.lastDir = dir;
  P.pressCount++;
  ui.press(dir);
};
P.menuKey = async function (key, code) {
  sendKey('keyup', key, code); sendKey('keydown', key, code);
  await new Promise(r => setTimeout(r, 80));
  sendKey('keyup', key, code);
  await new Promise(r => setTimeout(r, 300));
};

// ---------------------------------------------------------------- mode clock and level parameters
P.level = () => P.stats.levels + 1;
P.frightSec = () => FRIGHT_S[Math.min(P.level(), 19) - 1] || 0;
P.resetClock = () => { P.clock = {frames: 0, last: null, started: false, trusted: true}; };
P.tickClock = function (fr) {
  const now = performance.now();
  const t = canvasToTile(fr.pacman.px, fr.pacman.py);
  if (!P.clock.started) { if (t.x !== 13 || t.y !== 26) { P.clock.started = true; P.clock.frames = 8; P.clock.last = now; } return; }
  const frightened = fr.ghosts.some(g => g.state === 'scared' || g.state === 'flashing');
  if (!frightened) P.clock.frames += (now - P.clock.last) * 0.06;
  P.clock.last = now;
};
P.modeInfo = function () {
  const lv = P.level(), sched = SCHED[lv >= 5 ? 3 : lv >= 2 ? 2 : 1];
  let mode = 'scatter', next = null;
  for (const [f, m] of sched) { if (P.clock.frames >= f) mode = m; else { next = {frame: f, mode: m}; break; } }
  return {mode, next, frames: P.clock.frames};
};
// [mode, reverse at tick, mode after]; an untrusted clock (attached mid-game) uses a worst-case set
P.scenarios = function () {
  if (P.clock.trusted === false) return [['chase', -1, null], ['scatter', -1, null], ['chase', 0, 'chase'], ['chase', 7, 'chase']];
  const mi = P.modeInfo();
  if (!mi.next) return [[mi.mode, -1, null]];
  const k = Math.round((mi.next.frame - mi.frames) / P.FRAMES_PER_TICK);
  if (k >= P.SIM.HORIZON + 3) return [[mi.mode, -1, null]];
  return [[mi.mode, Math.max(0, k - 3), mi.next.mode], [mi.mode, Math.max(0, k), mi.next.mode], [mi.mode, k + 3, mi.next.mode]];
};

// Sim units: Pac-Man moves ~1.067 tiles per tick; everything else is scaled to that.
P.applyLevel = function () {
  const lv = P.level(), S = P.SIM;
  const sp = SPEEDS[lv >= 21 ? 21 : lv >= 5 ? 5 : lv >= 2 ? 2 : 1];
  P.GHOST_MARGIN = lv >= 5 ? 1.07 : 1.04;   // model ghosts a bit faster than they are, for distance
  P.ELROY = ELROY_DOTS(lv);
  if (P.turbo) {
    // turbo: Pac-Man always takes 2 steps per frame and never pauses to eat; ghosts are unchanged
    const ref = 1.067 / 2;
    P.FRAMES_PER_TICK = 8.45 / 2;
    S.PAC = 1.067; S.PAC_FRIGHT = 1.067; S.PAC_DOT_PAUSE = 0;
    S.GHOST = sp.ghost * ref * (lv >= 2 ? P.GHOST_MARGIN : 1.05);
    S.GHOST_FRIGHT = sp.ghostF * ref;
    S.GHOST_TUNNEL = sp.tunnel * ref;
  } else {
    const ref = 1.067 / sp.pac;
    P.FRAMES_PER_TICK = 8.45 / sp.pac;
    S.PAC = 1.067;
    S.GHOST = lv === 1 ? 1.0 : Math.min(0.99 * 1.067, sp.ghost * ref * P.GHOST_MARGIN);
    S.PAC_FRIGHT = Math.min(1.2, sp.pacF * ref);
    S.GHOST_FRIGHT = sp.ghostF * ref;
    S.GHOST_TUNNEL = Math.max(0.5, sp.tunnel * ref);
    S.PAC_DOT_PAUSE = 0.13 * sp.pac;
  }
  S.FRIGHT_TICKS = Math.round(P.frightSec() * 60 / P.FRAMES_PER_TICK);
};

// ---------------------------------------------------------------- ghost simulator
function ghostTarget(name, mode, pac, pdir, blinky, me, elroy) {
  if (mode === 'scatter' && !(name === 'blinky' && elroy)) return CORNER[name];
  if (name === 'blinky') return pac;
  if (name === 'pinky') { let x = pac.x + 4 * DX[pdir], y = pac.y + 4 * DY[pdir]; if (pdir === 'up') x -= 4; return {x, y}; }
  if (name === 'inky') {
    let x = pac.x + 2 * DX[pdir], y = pac.y + 2 * DY[pdir]; if (pdir === 'up') x -= 2;
    const b = blinky || pac; return {x: b.x + 2 * (x - b.x), y: b.y + 2 * (y - b.y)};
  }
  if (name === 'clyde') { const dx = pac.x - me.x, dy = pac.y - me.y; return dx * dx + dy * dy >= 64 ? pac : CORNER.clyde; }
  return pac;
}
function ghostChoose(g, target) {
  let opts = DIRS.filter(d => d !== OPP[g.dir] && open(g.x + DX[d], g.y + DY[d]) && !(d === 'up' && noUp(g.x, g.y)));
  if (!opts.length) opts = DIRS.filter(d => open(g.x + DX[d], g.y + DY[d]));
  let best = opts[0], bd = Infinity;
  for (const d of opts) { const nx = g.x + DX[d], ny = g.y + DY[d]; const dd = (nx - target.x) ** 2 + (ny - target.y) ** 2; if (dd < bd) { bd = dd; best = d; } }
  return best;
}

// Follow one Pac-Man route (a direction per junction) for HORIZON ticks. At tick `rev` all ghosts reverse
// and the mode becomes `modeAfter`.
P.simulate = function (start, route, mode, eatenBase, rev, modeAfter) {
  const S = P.SIM;
  const pac = {x: start.pac.x, y: start.pac.y, dir: route[0], prog: 0};
  const gs = start.ghosts.map(g => ({...g, prog: 0}));
  const eatenLocal = new Set();
  let ri = 0, dots = 0, pellets = 0, ghostsEaten = 0, fright = start.frightTicks;
  const elroy = start.dotsLeft <= P.ELROY;
  for (let t = 0; t < S.HORIZON; t++) {
    if (t === rev) { for (const g of gs) if (g.state !== 'eyes' && !(g.inPen > 0)) g.dir = OPP[g.dir]; if (modeAfter) mode = modeAfter; }
    pac.prog += fright > 0 ? S.PAC_FRIGHT : S.PAC;
    const prevPac = {x: pac.x, y: pac.y};
    if (pac.prog >= 1) {
      pac.prog -= 1;
      if (open(pac.x + DX[pac.dir], pac.y + DY[pac.dir])) { pac.x = wrapX(pac.x + DX[pac.dir]); pac.y += DY[pac.dir]; }
      const k = pac.x + ',' + pac.y;
      if (isDotTile(pac.x, pac.y) && !eatenBase.has(k) && !eatenLocal.has(k)) {
        eatenLocal.add(k);
        if (tileChar(pac.x, pac.y) === 'o') { pellets++; fright = S.FRIGHT_TICKS; for (const g of gs) if (g.state !== 'eyes') { g.state = 'scared'; g.dir = OPP[g.dir]; } }
        else { dots++; pac.prog -= S.PAC_DOT_PAUSE; }
      }
      const ex = exits(pac.x, pac.y);
      if (ex.length >= 3 || !ex.includes(pac.dir)) {
        ri++;
        if (ri < route.length && ex.includes(route[ri])) pac.dir = route[ri];
        else if (!ex.includes(pac.dir)) pac.dir = ex.find(d => d !== OPP[pac.dir]) || ex[0];
      }
    }
    if (fright > 0) fright--;
    if (fright === 0) for (const g of gs) if (g.state === 'scared' || g.state === 'flashing') g.state = 'normal';
    const blinky = gs.find(g => g.name === 'blinky');
    for (const g of gs) {
      if (g.state === 'eyes' || g.inPen > 0) { if (g.inPen > 0) { g.inPen--; if (g.inPen === 0) { g.x = 13; g.y = 14; g.dir = 'left'; } } continue; }
      const scared = g.state === 'scared';
      let sp = scared ? S.GHOST_FRIGHT : isTunnel(g.x, g.y) ? S.GHOST_TUNNEL : S.GHOST;
      if (g.name === 'blinky' && elroy && !scared) sp *= start.dotsLeft <= P.ELROY / 2 ? 1.13 : 1.07;
      g.prog += sp;
      g.prev = {x: g.x, y: g.y};
      if (g.prog >= 1) {
        g.prog -= 1;
        if (open(g.x + DX[g.dir], g.y + DY[g.dir])) { g.x = wrapX(g.x + DX[g.dir]); g.y += DY[g.dir]; }
        const tgt = scared ? {x: Math.floor(Math.random() * 28), y: Math.floor(Math.random() * 36)} : ghostTarget(g.name, mode, pac, pac.dir, blinky, g, elroy);
        g.dir = ghostChoose(g, tgt);
      }
      // same tile, swapped tiles, or centres closer than HIT_R (Manhattan, using progress within the tile)
      const gOff = open(g.x + DX[g.dir], g.y + DY[g.dir]) ? g.prog : 0, pOff = open(pac.x + DX[pac.dir], pac.y + DY[pac.dir]) ? pac.prog : 0;
      const gcx = g.x + DX[g.dir] * gOff, gcy = g.y + DY[g.dir] * gOff, pcx = pac.x + DX[pac.dir] * pOff, pcy = pac.y + DY[pac.dir] * pOff;
      let ddx = Math.abs(gcx - pcx); if (ddx > 14) ddx = 28 - ddx;
      const hit = (g.x === pac.x && g.y === pac.y) ||
        (g.prev.x === pac.x && g.prev.y === pac.y && g.x === prevPac.x && g.y === prevPac.y) ||
        (ddx + Math.abs(gcy - pcy) < S.HIT_R);
      if (hit) {
        if (g.state === 'scared') { g.state = 'eyes'; ghostsEaten++; }
        else if (g.state !== 'eyes') return {dead: true, t, dots, pellets, ghostsEaten, pac};
      }
    }
  }
  return {dead: false, t: S.HORIZON, dots, pellets, ghostsEaten, pac, eatenLocal};
};

// ---------------------------------------------------------------- route search and scoring
function routes(x, y, maxTiles) {   // a first direction, then a choice at each junction
  const out = [];
  function walk(x, y, dir, left, route) {
    while (left > 0) {
      if (!open(x + DX[dir], y + DY[dir])) break;
      x = wrapX(x + DX[dir]); y += DY[dir]; left--;
      const ex = exits(x, y);
      if (ex.length >= 3) { for (const d of ex.filter(q => q !== OPP[dir])) walk(x, y, d, left, route.concat([d])); return; }
      if (!ex.includes(dir)) { const t = ex.find(q => q !== OPP[dir]); if (!t) break; dir = t; route = route.concat([t]); }
    }
    out.push(route);
  }
  for (const d of exits(x, y)) walk(x, y, d, maxTiles, [d]);
  return out;
}
function bfs(sources) {
  const D = new Int16Array(N).fill(INF), q = [];
  for (const s of sources) { if (!open(s.x, s.y)) continue; D[idx(s.x, s.y)] = 0; q.push(s); }
  let qi = 0;
  while (qi < q.length) {
    const c = q[qi++], cd = D[idx(c.x, c.y)];
    for (const d of DIRS) {
      const nx = wrapX(c.x + DX[d]), ny = c.y + DY[d];
      if (!open(nx, ny)) continue;
      const k = idx(nx, ny);
      if (D[k] > cd + 1) { D[k] = cd + 1; q.push({x: nx, y: ny}); }
    }
  }
  return D;
}
const FRUIT_DIST = bfs([{x: 13, y: 20}, {x: 14, y: 20}]);

P.dotValue = dl => dl <= 4 ? 300 : 10;      // last dots: finish them, no stand-off with Elroy
P.distW = dl => dl <= 4 ? 8 : 1.5;
P.pelletValue = dl => dl <= 50 ? 80 : P.bait ? 90 : -35;   // save pellets as bait unless ghosts are close
P.fruitTerm = pac => P.fruitOn ? 6 * Math.max(0, 30 - Math.min(FRUIT_DIST[idx(pac.x, pac.y)], 30)) : 0;

// Score every route under every scenario; keep its worst case; pick the best first direction.
// If every route dies in some scenario, choose by the most likely scenario instead.
P.decideCore = function (fr) {
  const pt = tileOf(fr.pacman);
  const dotsArr = []; let dotsLeft = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (isDotTile(x, y) && !P.eaten.has(tileKey(x, y))) { dotsLeft++; dotsArr.push({x, y}); }
  let frightTicks = 0;
  const ghosts = fr.ghosts.map(g => {
    const t = tileOf(g);
    const inPen = !open(t.x, t.y) && g.state !== 'eyes';
    const state = g.state === 'flashing' ? 'normal' : g.state;
    if (state === 'scared') frightTicks = 14;
    return {name: g.name === '?' ? 'blinky' : g.name, x: inPen ? 13 : t.x, y: inPen ? 14 : t.y, dir: g.dir || 'left', state, inPen: inPen ? 4 : 0};
  });
  const start = {pac: pt, ghosts, dotsLeft, frightTicks};
  const R = bfs(dotsArr);
  const rs = routes(pt.x, pt.y, Math.round(P.SIM.HORIZON * 1.1));
  const SC = P.scenarios(), LI = SC.length === 3 ? 1 : 0;
  const byDir = {}, byLikely = {};
  for (const r of rs) {
    let worst = Infinity, info = null, likely = -Infinity;
    for (let si = 0; si < SC.length; si++) {
      const [mode, rev, modeAfter] = SC[si];
      const res = P.simulate({pac: {...start.pac}, ghosts: start.ghosts.map(g => ({...g})), dotsLeft, frightTicks}, r, mode, P.eaten, rev, modeAfter);
      const s = res.dead ? -100000 + res.t * 100
        : res.dots * P.dotValue(dotsLeft) + res.pellets * P.pelletValue(dotsLeft) + res.ghostsEaten * P.GHOST_W
          + P.fruitTerm(res.pac) - P.distW(dotsLeft) * Math.min(R[idx(res.pac.x, res.pac.y)], 60);
      if (si === LI) likely = s;
      if (s < worst) { worst = s; info = res; }
    }
    const d = r[0];
    const keep = (d === P.lastDir ? 10 : 0) - (d === OPP[P.lastDir] ? 30 : 0);   // no dithering
    worst += keep;
    if (!byDir[d] || worst > byDir[d].score) byDir[d] = {score: worst, dead: info.dead};
    if (byLikely[d] === undefined || likely + keep > byLikely[d]) byLikely[d] = likely + keep;
  }
  let best = null;
  for (const d in byDir) if (!best || byDir[d].score > best.score) best = {d, ...byDir[d]};
  if (best && best.dead) {
    let bl = null;
    for (const k in byLikely) if (!bl || byLikely[k] > bl.v) bl = {d: k, v: byLikely[k]};
    if (bl && bl.v > -50000) best = {...best, d: bl.d, dead: false, likelyPick: true};
  }
  if (!best) return {dir: null, mode: 'stuck'};
  return {dir: best.d, mode: best.dead ? 'doomed' : best.likelyPick ? 'likely' : 'sim', score: Math.round(best.score)};
};

// Corrections to what the simulator is told, then the core decision, then a last-step safety veto.
P.decide = function (fr) {
  if (!fr || !fr.pacman || !fr.ghosts) return {dir: null, mode: 'no-pac'};
  const pt = tileOf(fr.pacman);
  // unknown-identity hunters are treated as Blinky (he targets Pac-Man directly)
  let ghosts = fr.ghosts.map(g => ((g.state === 'normal' || g.state === 'flashing') && (!g.name || g.name === '?')) ? {...g, name: 'blinky'} : g);
  const hunters = ghosts.filter(g => g.state === 'normal' || g.state === 'flashing').map(tileOf);
  ghosts = ghosts.map(g => {
    // flashing ghosts can turn back any moment: treat them as dangerous
    if (g.state === 'flashing') g = {...g, state: 'normal'};
    if (g.state !== 'normal') return g;
    // the sim starts ghosts at a tile centre; a ghost well past its centre is put on the next tile
    if (g.dir && DX.hasOwnProperty(g.dir)) {
      const ix = (g.px - OFFX) / SCALE / 8, iy = (g.py - OFFY) / SCALE / 8, tx = Math.floor(ix), ty = Math.floor(iy);
      const off = DX[g.dir] * (ix - tx - 0.44) + DY[g.dir] * (iy - ty - 0.44);
      if (off > P.ADVANCE_FRAC && open(tx + DX[g.dir], ty + DY[g.dir])) g = {...g, px: g.px + DX[g.dir] * 8 * SCALE, py: g.py + DY[g.dir] * 8 * SCALE};
    }
    // a ghost inside the house is assumed to be at the door, about to come out
    const t = canvasToTile(g.px, g.py);
    if (t.x >= 11 && t.x <= 16 && t.y >= 15 && t.y <= 17) g = {...g, px: OFFX + SCALE * (13 * 8 + 4), py: OFFY + SCALE * (14 * 8 + 4), dir: 'up'};
    return g;
  });
  P.GHOST_W = P.frightSec() >= 3 ? 60 : 20;
  // bait: eat a pellet when >= 2 hunters are within 8 tiles and the blue time is long enough to catch them
  const near = ghosts.filter(g => g.state === 'normal').filter(g => { const t = canvasToTile(g.px, g.py); return Math.abs(t.x - pt.x) + Math.abs(t.y - pt.y) <= 8; }).length;
  P.bait = near >= 2 && P.frightSec() >= 3;
  P.fruitOn = false;
  if (fr.fruit) { const ft = canvasToTile(fr.fruit.px, fr.fruit.py); P.fruitOn = ft.y >= 19 && ft.y <= 21 && ft.x >= 12 && ft.x <= 15; }

  const res = P.decideCore({...fr, ghosts});
  if (!res || !res.dir || !hunters.length) return res;
  // veto: never step next to a hunting ghost if another exit is safe
  const D = bfs(hunters);
  const danger = d => D[idx(wrapX(pt.x + DX[d]), pt.y + DY[d])] <= 1;
  if (!open(pt.x + DX[res.dir], pt.y + DY[res.dir]) || !danger(res.dir)) return res;
  const safe = DIRS.filter(d => open(pt.x + DX[d], pt.y + DY[d]) && !danger(d));
  if (!safe.length) return res;
  safe.sort((a, b) => D[idx(wrapX(pt.x + DX[b]), pt.y + DY[b])] - D[idx(wrapX(pt.x + DX[a]), pt.y + DY[a])]);
  return {...res, dir: safe[0], mode: 'veto'};
};

// re-decide at most every few reads on the same tile
P.decideBot = function (fr) {
  P.applyLevel();
  const t = canvasToTile(fr.pacman.px, fr.pacman.py);
  const key = t.x + ',' + t.y + '|' + P.eaten.size;
  if (P.simCache && P.simCache.key === key && P.simCache.n < 4) { P.simCache.n++; return P.simCache.res; }
  const res = P.decide(fr);
  P.simCache = {key, res, n: 0};
  return res;
};

// ---------------------------------------------------------------- level / death bookkeeping
function levelCleared() {
  P.levelLog.push({level: P.level(), keys: P.levelPressesExtra + P.pressCount});
  P.stats.levels++;
  P.levelPressesExtra = 0; P.pressCount = 0;
  P.resetClock(); P.simCache = null;
  P.eaten = new Set(); P.absent = new Map(); P.pelletAbsent = new Map();
  P.lastTile = null; P.lastDir = null; P.releaseAll();
  ui.update();
}
function lifeLost(n) {
  P.stats.deaths += n;
  P.levelPressesExtra += P.pressCount; P.pressCount = 0;
  ui.update();
}

// ---------------------------------------------------------------- main loop
P.start = function () {
  if (P.running) return 'already running';
  P.running = true; P.wanted = true; P.note = '';
  P.live = {ticks: 0, noPac: 0, lives: null, low: 0};
  ui.ensure(); broadcast();
  (async () => {
    const L = P.live;
    try {
      while (P.running) {
        const fr = await P.readFrame(30);
        if (!fr || !fr.pacman) {
          L.noPac++;
          if (L.noPac > 300) { P.running = false; P.wanted = false; P.note = 'Game over (or no game on screen)'; }
          continue;
        }
        const t = tileOf(fr.pacman);
        if (L.noPac > 20 && t.x === 13 && t.y === 26) {   // back at spawn: new life or new level
          P.lastDir = null; P.lastTile = null; P.releaseAll(); P.resetClock();
        }
        if (L.noPac > 0) P.simCache = null;
        L.noPac = 0;
        // death = the spare-life icons drop, confirmed on 3 reads during play
        if (L.ticks % 10 === 0 && fr.ghosts.length && (P.dotsOnScreen || 0) > 0) {
          const lv = P.countLives();
          if (L.lives === null) L.lives = lv;
          else if (lv < L.lives) { if (++L.low >= 3) { lifeLost(L.lives - lv); L.lives = lv; L.low = 0; } }
          else { L.low = 0; if (lv > L.lives) L.lives = lv; }
        }
        if (L.ticks % 6 === 0) { P.verifyDots(fr); P.verifyPellets(); }
        if (!fr.ghosts.length) {
          if (P.verifyDots(fr) === 0) {
            levelCleared();
            await new Promise(r => setTimeout(r, 1500));
            P.verifyDots(null);
          }
          continue;
        }
        L.ticks++;
        P.tickClock(fr);
        P.updateEaten(fr.pacman);
        const r = P.decideBot(fr);
        P.mode = r.mode;
        if (r.dir && r.dir !== P.lastDir) P.pulseDirection(r.dir);
      }
    } catch (e) {
      P.lastError = String(e && e.stack || e);
      P.running = false;   // the watchdog restarts the loop if the game is still on
    }
    broadcast();
  })();
  return 'started';
};
P.stop = function () {
  P.running = false; P.wanted = false; P.waitingFocus = false; P.note = 'Stopped';
  P.releaseAll(); if (ui.els) ui.layout(); broadcast();
  return 'stopped';
};

// restart the loop if it died while a game is on screen (it once stopped mid-game and lost 2 lives)
let watchdogBusy = false;
setInterval(async () => {
  if (!P.wanted || P.running || watchdogBusy || P.waitingFocus) return;
  watchdogBusy = true;
  try {
    const fr = await P.readFrame(40);
    let dots = 1; try { dots = P.verifyDots(); } catch (e) {}
    if (fr && fr.pacman && fr.ghosts.length >= 2 && dots > 0) { P.watchdogRestarts = (P.watchdogRestarts || 0) + 1; P.start(); }
  } catch (e) {} finally { watchdogBusy = false; }
}, 2000);

function resetGameState() {
  P.stats = {levels: 0, deaths: 0};
  P.eaten = new Set(); P.absent = new Map(); P.pelletAbsent = new Map();
  P.lastDir = null; P.lastTile = null; P.simCache = null; P.dotsOnScreen = undefined;
  P.pressCount = 0; P.levelPressesExtra = 0; P.levelLog = [];
  P.resetClock();
}
async function waitForFocus() {   // the game pauses while its window is blurred (e.g. the popup is open)
  if (document.hasFocus()) return true;
  P.waitingFocus = true; broadcast();
  const t0 = performance.now();
  while (!document.hasFocus() && P.wanted && performance.now() - t0 < 60000) await new Promise(r => setTimeout(r, 200));
  P.waitingFocus = false;
  await new Promise(r => setTimeout(r, 300));
  return document.hasFocus() && P.wanted;
}
async function gameOnScreen() {
  const fr = await P.readFrame(60);
  let dots = 0; try { dots = P.verifyDots(fr); } catch (e) {}
  return !!(fr && fr.pacman && fr.ghosts.length >= 2 && dots > 0);
}
// The game's menus also select the button under the mouse, so a cursor resting over the canvas
// shifts where the arrow keys start. While the bot uses the menus, real mouse events on the canvas
// are swallowed and every button is unselected first (the menu's own mouseleave handler does that).
const MOUSE_EVENTS = ['mousemove', 'mouseover', 'mouseenter', 'mouseleave', 'mouseout', 'mousedown', 'mouseup', 'click',
                      'touchstart', 'touchmove', 'touchend', 'touchcancel'];
const swallowMouse = e => { if (e.isTrusted && e.target && e.target.id === 'canvas') e.stopImmediatePropagation(); };
const clearMenuHover = () => { const c = document.getElementById('canvas'); if (c) c.dispatchEvent(new MouseEvent('mouseleave')); };
async function menuSequence(steps) {
  for (const t of MOUSE_EVENTS) window.addEventListener(t, swallowMouse, true);
  try {
    let fresh = true;   // a new menu screen: unselect whatever the mouse picked before the first arrow
    for (const [key, code] of steps) {
      if (fresh) clearMenuHover();
      await P.menuKey(key, code);
      fresh = key === 'Enter';
    }
  } finally {
    for (const t of MOUSE_EVENTS) window.removeEventListener(t, swallowMouse, true);
  }
}

// From the "choose your game" screen: PAC-MAN -> PLAY or PLAY TURBO
async function newGame(turbo) {
  P.running = false; P.wanted = true; P.note = ''; P.releaseAll();
  ui.ensure(); broadcast();
  if (!await waitForFocus()) { if (P.wanted) { P.wanted = false; P.note = 'Click the game window, then try again'; } broadcast(); return 'no focus'; }
  if (await gameOnScreen()) { P.wanted = false; P.note = 'A game is running: use PLAY CURRENT GAME, or quit it (Esc) first'; broadcast(); return 'game running'; }
  const DOWN = ['ArrowDown', 40], ENTER = ['Enter', 13];
  await menuSequence(turbo ? [DOWN, ENTER, DOWN, DOWN, ENTER]    // PAC-MAN, PLAY, PLAY TURBO
                           : [DOWN, ENTER, DOWN, ENTER]);        // PAC-MAN, PLAY
  P.turbo = turbo;
  resetGameState();
  ui.update();
  return P.start();
}
P.newRun = () => newGame(false);
P.newTurboRun = () => newGame(true);
// take over a game already in progress (level count starts at 1; set __pac.stats.levels if needed)
P.attach = async function (turbo) {
  if (P.running) return 'already running';
  if (typeof turbo === 'boolean') P.turbo = turbo;
  P.wanted = true; ui.ensure();
  if (!await waitForFocus()) { if (P.wanted) { P.wanted = false; P.note = 'Click the game window, then try again'; } broadcast(); return 'no focus'; }
  P.eaten = new Set(); P.absent = new Map(); P.pelletAbsent = new Map();
  P.lastDir = null; P.lastTile = null; P.simCache = null;
  P.clock = {frames: 0, last: null, started: true, trusted: false};
  for (let i = 0; i < 4; i++) P.verifyDots(null);   // learn which dots are already gone
  return P.start();
};

// ---------------------------------------------------------------- overlays (top right)
const ARROWS = {up: '↑ UP', down: '↓ DOWN', left: '← LEFT', right: '→ RIGHT'};
const BANNER_H = 40;
const ui = {
  els: null, flash: null, timer: null,
  ensure() {
    if (this.els || !document.body) return;
    const box = (id, css) => { const e = document.createElement('div'); e.id = id; e.style.cssText = css; document.body.appendChild(e); return e; };
    const base = 'position:fixed;right:10px;z-index:999999;background:rgba(0,0,0,0.85);color:#0f0;font-family:monospace;' +
                 'font-weight:bold;border:2px solid #0f0;border-radius:8px;pointer-events:none;white-space:pre;text-align:right;';
    const keys = box('bot-direction-overlay', base + 'top:10px;font-size:28px;padding:10px 18px;min-width:120px;text-align:center;');
    const status = box('bot-status-overlay', base + 'font-size:20px;padding:6px 14px;');
    const log = box('bot-level-log', base + 'font-size:15px;padding:6px 12px;min-width:180px;overflow-y:auto;');
    const banner = box('bot-banner', `position:fixed;top:0;left:0;right:0;height:${BANNER_H}px;z-index:1000000;display:none;` +
      'align-items:center;justify-content:center;background:#1a1a8c;color:#ffd800;font:bold 18px monospace;' +
      'border-bottom:3px solid #ffd800;pointer-events:none;letter-spacing:1px;');
    // drawn as SVG so it doesn't depend on the font having Pac-Man glyphs
    const pac = flip => `<svg width="24" height="24" viewBox="0 0 22 22" style="flex:none${flip ? ';transform:scaleX(-1)' : ''}">` +
      '<path d="M11 11 L19.2 5.3 A10 10 0 1 0 19.2 16.7 Z" fill="#ffd800"/><circle cx="11.5" cy="6" r="1.6" fill="#1a1a8c"/></svg>';
    banner.innerHTML = `${pac(false)}<span style="margin:0 12px">···&nbsp; Xecaz Pacman bot is playing, enjoy! &nbsp;···</span>${pac(true)}`;
    this.els = {keys, status, log, banner};
    this.layout();
    this.timer = setInterval(() => this.update(), 500);
  },
  // the banner pushes the page down while the bot is on
  showBanner(on) {
    const b = this.els.banner;
    if ((b.style.display !== 'none') === on) return;
    b.style.display = on ? 'flex' : 'none';
    document.body.style.paddingTop = on ? BANNER_H + 'px' : '';
    this.els.keys.style.top = (on ? BANNER_H + 10 : 10) + 'px';
  },
  layout() {
    const {keys, status, log} = this.els;
    this.showBanner(P.wanted);
    status.style.top = (keys.getBoundingClientRect().bottom + 8) + 'px';
    log.style.top = (status.getBoundingClientRect().bottom + 8) + 'px';
    log.style.maxHeight = `calc(100vh - ${Math.round(status.getBoundingClientRect().bottom + 20)}px)`;
  },
  press(dir) {
    if (!this.els) return;
    const k = this.els.keys;
    k.textContent = `#${P.pressCount} ${ARROWS[dir] || ''}`;
    k.style.background = 'rgba(0,255,0,0.85)'; k.style.color = '#000';
    clearTimeout(this.flash);
    this.flash = setTimeout(() => { k.textContent = `#${P.pressCount} (idle)`; k.style.background = 'rgba(0,0,0,0.85)'; k.style.color = '#0f0'; }, 350);
  },
  update() {
    if (!this.els) return;
    const {keys, status, log} = this.els;
    let lives = '?';
    try { lives = P.countLives() + 1; } catch (e) {}
    const state = P.running ? (P.turbo ? 'TURBO' : 'PLAY') : P.wanted ? 'WAIT' : 'OFF';
    status.textContent = `LEVEL ${P.level()}   LIVES ${typeof lives === 'number' ? '●'.repeat(Math.max(0, Math.min(lives, 6))) : lives}\nDEATHS ${P.stats.deaths}   BOT ${state}`;
    if (!P.running && !P.pressCount) keys.textContent = '#0 (idle)';
    const rows = P.levelLog.map(e => `LVL ${String(e.level).padStart(2)}  ${String(e.keys).padStart(4)} keys`);
    const text = 'CLEARED (keys)\n' + (rows.length ? rows.join('\n') : '-');
    if (log.textContent !== text) { log.textContent = text; log.scrollTop = log.scrollHeight; }
    this.layout();
    broadcast();
  },
};

// ---------------------------------------------------------------- extension messages (via bridge.js)
function statusObj() {
  return {running: P.running, wanted: P.wanted, turbo: P.turbo, level: P.level(), deaths: P.stats.deaths,
          waitingFocus: P.waitingFocus, note: P.note};
}
let lastBroadcast = '';
function broadcast() {
  const s = statusObj(), j = JSON.stringify(s);
  if (j === lastBroadcast) return;
  lastBroadcast = j;
  window.postMessage({source: 'pacbot', type: 'state', status: s}, '*');
}
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.source !== 'pacbot-ext') return;
  const {id, cmd} = e.data;
  if (cmd === 'turbo') P.newTurboRun();
  else if (cmd === 'normal') P.newRun();
  else if (cmd === 'attach') P.attach();
  else if (cmd === 'stop') P.stop();
  // reply right away with the state after the command was accepted
  setTimeout(() => window.postMessage({source: 'pacbot', type: 'reply', id, status: statusObj()}, '*'), 50);
});
})();

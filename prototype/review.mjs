// Visual-review harness: renders TideMap across a grid of tide/light states via the offline
// renderer look.mjs, and composes labeled contact sheets so the artwork can be judged at a
// glance. This file only orchestrates look.mjs + sharp compositing — it does not reproduce any
// of the shader/render math itself. Scratch tool, not shipped.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import sharp from 'sharp';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_DIR = 'data/review';               // relative to ROOT, matches look.mjs's own convention
const REVIEW_ABS = path.join(ROOT, REVIEW_DIR);

const CELL_W = 640, CELL_H = 480;
const GUTTER = 22;
const TITLE_H = 30;
const CONCURRENCY = 3;

// ---- CLI ---------------------------------------------------------------------------------
const MODE = process.argv[2];
if (!['states', 'crops', 'all'].includes(MODE)) {
  console.error("Usage: node review.mjs <states|crops|all> [t=SECONDS] [set='{...}']");
  process.exit(1);
}
// Everything after the mode is forwarded verbatim to every look.mjs call (t=, set=, etc.),
// EXCEPT keys that a cell definition owns (out/w/h/tide/light/past/dir/moon/zoom/cx/cy) — those
// stay under harness control so the grid stays consistent.
const RESERVED = new Set(['out', 'w', 'h', 'tide', 'light', 'past', 'dir', 'moon', 'zoom', 'cx', 'cy']);
const passArgs = {};
for (const raw of process.argv.slice(3)) {
  const i = raw.indexOf('=');
  if (i === -1) continue;
  const k = raw.slice(0, i), v = raw.slice(i + 1);
  if (!RESERVED.has(k)) passArgs[k] = v;
}
if (passArgs.t === undefined) passArgs.t = '40';

// ---- look.mjs runner with a small concurrency pool ---------------------------------------
function runLook(argsObj) {
  const args = ['--max-old-space-size=8192', 'look.mjs',
    ...Object.entries(argsObj).map(([k, v]) => `${k}=${v}`)];
  return new Promise(resolve => {
    const proc = spawn(process.execPath, args, { cwd: ROOT });
    let stderr = '';
    proc.stdout.on('data', () => {});           // look.mjs's one-line stdout isn't needed here
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => resolve({ ok: code === 0, stderr }));
    proc.on('error', err => resolve({ ok: false, stderr: String(err) }));
  });
}

async function runPool(tasks, worker) {
  let idx = 0;
  async function lane() {
    while (idx < tasks.length) {
      const i = idx++;
      await worker(tasks[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, lane));
}

// ---- SVG label overlay --------------------------------------------------------------------
const escapeXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function labelSvg(w, h, lines, { failed = false } = {}) {
  const pad = 6, lh = 16, fs = 13;
  const maxLen = Math.max(...lines.map(l => l.length), 1);
  const boxW = Math.min(w - 12, pad * 2 + Math.ceil(maxLen * 7.3));
  const boxH = pad * 2 + lines.length * lh;
  const texts = lines.map((l, i) =>
    `<text x="${pad + 6}" y="${pad + (i + 0.82) * lh}" font-family="Consolas,'DejaVu Sans Mono',monospace" font-size="${fs}" fill="${failed ? '#ff6b6b' : '#ffffff'}">${escapeXml(l)}</text>`
  ).join('');
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="6" width="${boxW}" height="${boxH}" rx="3" fill="#000000" fill-opacity="0.55"/>
    ${texts}
  </svg>`;
}

function titleSvg(w, h, text) {
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <text x="10" y="${Math.round(h * 0.7)}" font-family="Consolas,'DejaVu Sans Mono',monospace" font-size="15" fill="#d8dde0">${escapeXml(text)}</text>
  </svg>`;
}

// ---- generic grid sheet builder ------------------------------------------------------------
// cells: array of { out, args, labelLines }, laid out row-major with `cols` columns.
async function composeSheet({ cells, cols, rows, outPath, title }) {
  await fs.promises.mkdir(REVIEW_ABS, { recursive: true });

  console.log(`\n== rendering ${cells.length} cells for ${path.basename(outPath)} (concurrency ${CONCURRENCY}) ==`);
  await runPool(cells, async cell => {
    const res = await runLook(cell.args);
    cell.failed = !res.ok;
    if (!res.ok) {
      console.error(`[review] look.mjs FAILED for ${cell.args.out}:\n${res.stderr.trim()}`);
    } else {
      console.log(`  ok: ${cell.args.out}`);
    }
  });

  const titleH = title ? TITLE_H : 0;
  const sheetW = GUTTER * (cols + 1) + CELL_W * cols;
  const sheetH = titleH + GUTTER * (rows + 1) + CELL_H * rows;

  const composites = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const r = Math.floor(i / cols), c = i % cols;
    const left = GUTTER + c * (CELL_W + GUTTER);
    const top = titleH + GUTTER + r * (CELL_H + GUTTER);
    let imgInput;
    if (cell.failed) {
      imgInput = await sharp({
        create: { width: CELL_W, height: CELL_H, channels: 3, background: { r: 0, g: 0, b: 0 } }
      }).png().toBuffer();
    } else {
      imgInput = path.join(ROOT, cell.args.out);
    }
    composites.push({ input: imgInput, left, top });
    const lines = cell.failed ? [...cell.labelLines, '** render failed — see log **'] : cell.labelLines;
    composites.push({ input: Buffer.from(labelSvg(CELL_W, CELL_H, lines, { failed: cell.failed })), left, top });
  }
  if (title) {
    composites.push({ input: Buffer.from(titleSvg(sheetW, titleH, title)), left: 0, top: 0 });
  }

  await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: { r: 13, g: 13, b: 15 } } })
    .composite(composites)
    .png()
    .toFile(outPath);
  console.log(`wrote ${outPath}  (${sheetW}x${sheetH})`);
}

// ---- sheet: states ---------------------------------------------------------------------------
const LIGHT_STATES = [
  { label: 'night', sub: 'light 0.00 (moon 0.8)', light: 0, extra: { moon: 0.8 } },
  { label: 'dusk', sub: 'light 0.12', light: 0.12 },
  { label: 'golden', sub: 'light 0.30', light: 0.30 },
  { label: 'morning', sub: 'light 0.60', light: 0.60 },
  { label: 'midday', sub: 'light 0.92', light: 0.92 },
];
const TIDE_STATES = [
  { label: 'low ebbing', sub: 'tide 0.45 past 1.05 dir -1', tide: 0.45, extra: { past: 1.05, dir: -1 } },
  { label: 'mid rising', sub: 'tide 1.15 dir +1', tide: 1.15, extra: { dir: 1 } },
  { label: 'high', sub: 'tide 1.95 dir +1', tide: 1.95, extra: { dir: 1 } },
];

async function buildStates() {
  const cells = [];
  for (let r = 0; r < TIDE_STATES.length; r++) {
    for (let c = 0; c < LIGHT_STATES.length; c++) {
      const tideS = TIDE_STATES[r], lightS = LIGHT_STATES[c];
      const out = `${REVIEW_DIR}/_cell-states-${r}-${c}.png`;
      const args = {
        out, w: CELL_W, h: CELL_H,
        tide: tideS.tide, light: lightS.light,
        ...(tideS.extra ?? {}), ...(lightS.extra ?? {}),
        ...passArgs,
      };
      cells.push({ args, labelLines: [`${tideS.label} / ${lightS.label}`, tideS.sub, lightS.sub] });
    }
  }
  const setNote = passArgs.set ? ` set=${passArgs.set}` : '';
  await composeSheet({
    cells, cols: LIGHT_STATES.length, rows: TIDE_STATES.length,
    outPath: path.join(REVIEW_ABS, 'sheet-states.png'),
    title: `TideMap review — states — t=${passArgs.t}${setNote}`,
  });
}

// ---- sheet: crops ------------------------------------------------------------------------
// Verified by rendering one cell each and looking at the PNG (see handover notes below).
const FRAMINGS = [
  { key: 'entrance', label: 'entrance', zoom: 0.16, cx: 0.575, cy: 0.585 },
  { key: 'flats', label: 'upper-harbour flats', zoom: 0.22, cx: 0.20, cy: 0.42 },
  { key: 'beach', label: 'ocean beach', zoom: 0.28, cx: 0.36, cy: 0.28 },
];
const CROP_STATES = [
  { label: 'day low', sub: 'tide 0.5 light 0.92 ebb', tide: 0.5, light: 0.92, extra: { past: 1.1, dir: -1 } },
  { label: 'day mid', sub: 'tide 1.15 light 0.92', tide: 1.15, light: 0.92 },
  { label: 'night mid', sub: 'tide 1.15 light 0 moon 0.8', tide: 1.15, light: 0, extra: { moon: 0.8 } },
];

async function buildCrops() {
  const cells = [];
  for (let r = 0; r < FRAMINGS.length; r++) {
    for (let c = 0; c < CROP_STATES.length; c++) {
      const fr = FRAMINGS[r], st = CROP_STATES[c];
      const out = `${REVIEW_DIR}/_cell-crops-${r}-${c}.png`;
      const args = {
        out, w: CELL_W, h: CELL_H,
        zoom: fr.zoom, cx: fr.cx, cy: fr.cy,
        tide: st.tide, light: st.light,
        ...(st.extra ?? {}),
        ...passArgs,
      };
      cells.push({ args, labelLines: [`${fr.label} / ${st.label}`, `zoom ${fr.zoom} cx ${fr.cx} cy ${fr.cy}`, st.sub] });
    }
  }
  const setNote = passArgs.set ? ` set=${passArgs.set}` : '';
  await composeSheet({
    cells, cols: CROP_STATES.length, rows: FRAMINGS.length,
    outPath: path.join(REVIEW_ABS, 'sheet-crops.png'),
    title: `TideMap review — crops — t=${passArgs.t}${setNote}`,
  });
}

// ---- main ----------------------------------------------------------------------------------
await fs.promises.mkdir(REVIEW_ABS, { recursive: true });
if (MODE === 'states' || MODE === 'all') await buildStates();
if (MODE === 'crops' || MODE === 'all') await buildCrops();

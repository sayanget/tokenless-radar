// Tokenless Radar (token-radar-01), Node 22, standard library only.
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), runs the value model in
// dashboard/model.js and the farm verdict in dashboard/farm.js (the same two files the page runs, so the
// page and board.json cannot disagree), writes /output/board.json and /output/data.js, copies dashboard/
// and screenshots/ to /output, and last writes /output/dossier.json with the vendored make.fun library.
//
// Outside the grader, MAKEFUN_OUTPUT_DIR (or --output) stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const load = createRequire(import.meta.url);
const Model = load('./dashboard/model.js');
const Farm = load('./dashboard/farm.js');

/** The scorer's caps: the text cap shapes the dossier's bytes, the others only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=value out of the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`tokenless radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`tokenless radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

interface Protocol {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] }

/** The snapshot, held to its ten fields (null for anything absent), so the model sees one shape. */
function readSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text);
  if (!raw || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) fail('snapshot.json lacks protocols or watchlist');
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const protocols: Protocol[] = raw.protocols
    .filter((p: any) => p && typeof p.slug === 'string' && typeof p.name === 'string' && num(p.tvl_usd) !== null && p.tvl_usd > 0)
    .map((p: any) => ({
      slug: p.slug, name: p.name, category: str(p.category), chains: Array.isArray(p.chains) ? p.chains.filter((c: unknown) => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd, change_7d: num(p.change_7d), mcap_usd: num(p.mcap_usd), listed_at: str(p.listed_at), gecko_id: str(p.gecko_id), symbol: str(p.symbol),
    }));
  return { as_of: String(raw.as_of), source: String(raw.source ?? ''), floor_usd: Number(raw.floor_usd), protocols, watchlist: raw.watchlist.filter((s: unknown) => typeof s === 'string') };
}

const snapshot = readSnapshot(readFileSync(inputFile, 'utf8'));
const m = Model.run(snapshot);
const settings = Farm.DEFAULTS;

const rows = m.rows.map((r: any) => {
  const v = Farm.farmVerdict(Model, m, r, settings);
  return {
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    implied_value_usd: r.implied_value_usd,
    tier: r.group,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    age_days: r.age_days,
    value_if_launched_usd: Math.round(r.value_if_launched),
    launch_odds_12m: Math.round(r.odds_12m * 1e4) / 1e4,
    range_p25_usd: Math.round(r.p25),
    range_p75_usd: Math.round(r.p75),
    farm_verdict: v.verdict,
    farm_net_usd: Math.round(v.net),
    farm_steps: Farm.farmPlan(r, v, settings).map(Farm.stepText),
  };
});

/** Why the gate would refuse this board, or null. */
function boardIssue(): string | null {
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set(rows.map((r: any) => r.slug));
  if (rows.length < 100 || rows.length > 4000) return `${rows.length} rows, not 100 to 4000`;
  if (slugs.size !== rows.length) return 'a slug appears twice';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `watchlist slugs missing: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
    if (r.rank !== i + 1) return `row ${i} has rank ${r.rank}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} implied value ${r.implied_value_usd}`;
    if (i > 0 && r.implied_value_usd > rows[i - 1].implied_value_usd) return `${r.slug} outranks the row above it`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a step of ${s.trim().length} characters`;
  }
  if (rows[0].implied_value_usd === rows[rows.length - 1].implied_value_usd) return 'every row has the same implied value';
  return null;
}
const issue = boardIssue();
if (issue !== null) fail(`the board would fail the gate: ${issue}`);

const sel = m.selection;
const board = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  model: {
    implied_value: 'value_if_launched x launch_odds_12m, rounded to 3 significant figures',
    value_if_launched: 'tvl_usd x 10^(fitted log10 cap/TVL of traded comps)',
    terms_kept: Object.keys(sel.terms),
    held_out_miss: { leave_one_out: Math.round(sel.loo * 100) / 100, walk_forward: Math.round(sel.walk * 100) / 100 },
    comps: m.comps.length,
    farm_settings: settings,
  },
  ledger: m.ledger,
  rows,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify(board)}\n`);
// data.js: the raw snapshot the page refits the model from, and board.json's ranks to check against.
const data = { snapshot, board: rows.map((r: any) => [r.slug, r.rank, r.implied_value_usd]) };
writeFileSync(join(out, 'data.js'), `window.RADAR_DATA = ${JSON.stringify(data)};\n`);

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images: hand in 3 (board, detail, filtered)`);
for (const name of shots) if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: names are letters, digits and . _ -`);

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const counts = rows.reduce((c: Record<string, number>, r: any) => ((c[r.farm_verdict] = (c[r.farm_verdict] ?? 0) + 1), c), {});
process.stdout.write(
  `tokenless radar: ${snapshot.protocols.length} protocols, ${rows.length} ranked (${m.ledger.watchlist} watchlist, ${m.ledger.offlist ?? 0} off-list, ${m.ledger.early ?? 0} early); ` +
    `held-out miss x${sel.loo.toFixed(2)} (leave-one-out), x${sel.walk.toFixed(2)} (walk-forward); verdicts ${JSON.stringify(counts)}\n`,
);

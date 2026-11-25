// Local stand-in for the token-radar-01 gate: the seven rows of RULES.txt "The gate", checked on an
// output directory. Usage: node tools/gate.mjs <out_dir> <snapshot.json>
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const [outDir = 'out', snapPath = '/input/snapshot.json'] = process.argv.slice(2);
const snapshot = JSON.parse(readFileSync(snapPath, 'utf8'));
const results = [];
const row = (name, ok, detail) => results.push({ name, ok, detail });
const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const URL_RE = /https?:\/\//i;

// 1. dashboard_files
{
  const root = join(outDir, 'dashboard');
  const files = [];
  let problem = null;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name.startsWith('.')) problem ??= `dot-directory ${p}`; walk(p); }
      else if (e.isFile()) { if (!NAME.test(e.name)) problem ??= `bad name ${p}`; files.push(p); }
      else problem ??= `not a regular file: ${p}`;
    }
  };
  walk(root);
  const rel = files.map((f) => relative(root, f));
  const bytes = files.reduce((n, f) => n + lstatSync(f).size, 0);
  if (!rel.includes('index.html')) problem ??= 'no index.html';
  if (!rel.some((f) => f.endsWith('.css'))) problem ??= 'no .css';
  if (!rel.some((f) => f.endsWith('.js'))) problem ??= 'no .js';
  if (files.length > 400 || bytes > 4 * 1024 * 1024) problem ??= `${files.length} files, ${bytes} bytes`;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    if (f.endsWith('.css') && URL_RE.test(text)) problem ??= `URL in CSS ${f}`;
    if (f.endsWith('.html')) {
      for (const m of text.matchAll(/<[a-zA-Z][^>]*>/g)) {
        for (const a of m[0].matchAll(/\s[^\s=]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)) if (URL_RE.test(a[1])) problem ??= `URL in an HTML attribute: ${a[0].trim()}`;
      }
      for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) if (URL_RE.test(m[1])) problem ??= 'URL in a <style> body';
      for (const m of text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) if (/(import|require)\s*\(?\s*['"`]https?:/i.test(m[1])) problem ??= 'URL import in inline script';
    }
    if (/\.(m?js)$/.test(f)) {
      if (/(?:\bimport\s*(?:[^'"`;]*?\bfrom\s*)?|\bexport\s[^'"`;]*?\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"`]https?:/.test(text)) problem ??= `URL import/require in ${f}`;
      if (URL_RE.test(text)) console.log(`  note: ${relative(outDir, f)} mentions a URL in a string or comment (allowed, but check it)`);
    }
  }
  row('dashboard_files', problem === null, problem ?? `${files.length} files, ${bytes} bytes: ${rel.join(', ')}`);
}

// 2-5. board_file, sorted_by_value, coverage, farm_steps
{
  const raw = readFileSync(join(outDir, 'board.json'));
  const doc = JSON.parse(raw.toString('utf8'));
  const rows = Array.isArray(doc) ? doc : doc.rows;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  let p1 = null;
  if (raw.length > 8 * 1024 * 1024) p1 = 'over 8 MiB';
  if (!Array.isArray(rows) || rows.length < 100 || rows.length > 4000) p1 ??= `rows: ${rows?.length}`;
  const seen = new Set();
  for (const r of rows) {
    if (typeof r.slug !== 'string' || !/^\S{1,128}$/.test(r.slug) || !known.has(r.slug)) p1 ??= `invented or bad slug ${r.slug}`;
    if (seen.has(r.slug)) p1 ??= `slug twice ${r.slug}`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) p1 ??= `empty name ${r.slug}`;
    if (!Number.isSafeInteger(r.rank) || r.rank < 1) p1 ??= `bad rank ${r.slug}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) p1 ??= `bad implied value ${r.slug}`;
    if (!Array.isArray(r.farm_steps)) p1 ??= `no farm_steps ${r.slug}`;
  }
  const values = new Set(rows.map((r) => r.implied_value_usd));
  if (rows.length >= 2 && values.size === 1) p1 ??= 'all implied values equal';
  row('board_file', p1 === null, p1 ?? `${rows.length} rows, ${raw.length} bytes, ${values.size} distinct values`);

  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  let p2 = null;
  byRank.forEach((r, i) => { if (r.rank !== i + 1) p2 ??= `rank ${i + 1} missing or repeated`; });
  for (let i = 1; i < byRank.length; i++) if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) p2 ??= `rank ${byRank[i].rank} rises`;
  row('sorted_by_value', p2 === null, p2 ?? `ranks 1..${rows.length}, values ${byRank[0].implied_value_usd} down to ${byRank.at(-1).implied_value_usd}`);

  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  const outside = rows.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  row('coverage', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${snapshot.watchlist.length} of ${snapshot.watchlist.length} watchlist slugs; ${outside} rows outside it`);

  let p3 = null, minLen = Infinity, maxLen = 0;
  for (const r of rows) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) p3 ??= `${r.slug}: ${r.farm_steps.length} steps`;
    for (const s of r.farm_steps) {
      const n = typeof s === 'string' ? s.trim().length : -1;
      minLen = Math.min(minLen, n); maxLen = Math.max(maxLen, n);
      if (n < 20 || n > 600) p3 ??= `${r.slug}: a step of ${n} characters`;
    }
  }
  row('farm_steps', p3 === null, p3 ?? `step lengths ${minLen}..${maxLen}`);
}

// 6. screenshots
function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return { type: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20), whole: b.subarray(-8, -4).toString('latin1') === 'IEND' };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'jpeg', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), whole: b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9 };
      i += 2 + len;
    }
  }
  return null;
}
{
  const dir = join(outDir, 'screenshots');
  const names = readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  let problem = names.length < 3 || names.length > 4 ? `${names.length} images` : null;
  const info = [];
  for (const n of names) {
    const b = readFileSync(join(dir, n));
    const s = imageSize(b);
    if (!NAME.test(n)) problem ??= `bad name ${n}`;
    if (b.length > 524288) problem ??= `${n} is ${b.length} bytes`;
    if (!s || !s.whole) problem ??= `${n} is not a whole PNG/JPEG`;
    else if (Math.max(s.w, s.h) > 1440 || Math.min(s.w, s.h) < 800) problem ??= `${n} is ${s.w}x${s.h}`;
    info.push(`${n} ${s ? `${s.type} ${s.w}x${s.h}` : '?'} ${b.length} B`);
  }
  row('screenshots', problem === null, problem ?? info.join('; '));
}

// 7. dossier_matches
{
  const written = readFileSync(join(outDir, 'dossier.json'));
  const rebuilt = Buffer.from(buildDossier(outDir, { text_max_bytes: 65536 }));
  const doc = JSON.parse(written.toString('utf8'));
  const textBytes = Buffer.byteLength(doc.text, 'utf8');
  const cut = doc.text.includes('[Cut at') || doc.text.includes("lines not shown");
  const ok = written.equals(rebuilt) && written.length <= 1.5 * 1024 * 1024 && !cut;
  row('dossier_matches', ok, `${written.equals(rebuilt) ? 'byte-identical' : 'DIFFERS'}; ${written.length} bytes (cap 1572864); text ${textBytes} of 65536 bytes${cut ? ', TEXT CUT' : ', nothing cut'}`);
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(16)} ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} row(s) fail` : 'all 7 rows pass');
process.exit(failed ? 1 : 0);

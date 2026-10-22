#!/usr/bin/env node
// Lay out a commit range as material for writing the CHANGELOG [Unreleased]
// section: every commit grouped by the area of the tree it changed most,
// with its full body. Printed to stdout; never committed.
//
//   node scripts/changelog-draft.mjs [--from <ref>] [--to <ref>]
//
// --from defaults to the latest v*.*.* tag, --to to HEAD.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

let from = null;
let to = 'HEAD';
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--from') from = argv[++i] ?? fail('--from needs a ref');
  else if (argv[i] === '--to') to = argv[++i] ?? fail('--to needs a ref');
  else fail(`unknown argument ${argv[i]}`);
}
if (!from) {
  try {
    from = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*').trim();
  } catch {
    fail('no v*.*.* tag found; pass --from');
  }
}

const commits = git(
  'log', '--no-merges', '--reverse', '--date=short',
  '--format=%H%x1f%ad%x1f%s%x1f%b%x1e', `${from}..${to}`,
)
  .split('\x1e')
  .map((r) => r.replace(/^\n+/, ''))
  .filter(Boolean)
  .map((r) => {
    const [sha, date, subject, body = ''] = r.split('\x1f');
    return { sha, date, subject, body };
  });

const AREA_PREFIX = /^src\/(?:components|lib|stores|app)\/|^src\//;

// The directory holding the largest share of a commit's non-test lines.
function areaOf(sha) {
  const out = git(
    'show', '--dirstat=lines,0', '--format=', sha,
    '--', '.', ':(exclude)tests', ':(exclude)**/*.test.*',
  );
  let best = null;
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*([\d.]+)%\s+(.+)$/);
    if (m && (!best || Number(m[1]) > best.pct)) best = { pct: Number(m[1]), dir: m[2] };
  }
  if (!best) return 'other';
  const rest = best.dir.replace(AREA_PREFIX, '');
  const segment = rest.split('/').filter(Boolean)[0];
  return segment ?? best.dir.split('/').filter(Boolean).pop();
}

const byArea = new Map();
for (const c of commits) {
  const area = areaOf(c.sha);
  if (!byArea.has(area)) byArea.set(area, []);
  byArea.get(area).push(c);
}

const out = [`# Changelog material: ${from}..${to} (${commits.length} commits)`, ''];
const areas = [...byArea.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
for (const [area, list] of areas) {
  out.push(`## ${area} (${list.length})`, '');
  for (const c of list) {
    out.push(`- ${c.date} ${c.sha.slice(0, 7)} ${c.subject}`);
    for (const line of c.body.split('\n')) if (line.trim()) out.push(`    ${line}`);
  }
  out.push('');
}
process.stdout.write(out.join('\n'));

#!/usr/bin/env node
// Turn CHANGELOG.md's [Unreleased] section into a release and bump the version.
//
//   node scripts/release-prepare.mjs <X.Y.Z> [--check] [--date YYYY-MM-DD]
//
// --check validates without writing. Without it, CHANGELOG.md, package.json and
// package-lock.json are rewritten to X.Y.Z. No git writes: the caller commits
// and tags (the Release workflow, or a maintainer by hand).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const notes = require('./release-notes.cjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (f) => path.join(root, f);

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

function git(...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function parseArgs(argv) {
  const out = { version: null, check: false, date: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') out.check = true;
    else if (a === '--date') out.date = argv[++i] ?? fail('--date needs a value');
    else if (a.startsWith('-')) fail(`unknown option ${a}`);
    else if (out.version) fail(`unexpected argument ${a}`);
    else out.version = a;
  }
  return out;
}

const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

const { version, check, date: dateArg } = parseArgs(process.argv.slice(2));
if (!version) fail('usage: node scripts/release-prepare.mjs <X.Y.Z> [--check] [--date YYYY-MM-DD]');
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`version ${version} is not X.Y.Z`);
if (dateArg !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) fail(`date ${dateArg} is not YYYY-MM-DD`);

let latest;
try {
  latest = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*');
} catch {
  fail('no v*.*.* tag found (fetch tags first)');
}
const parts = (v) => v.replace(/^v/, '').split('.').map(Number);
if (cmp(parts(version), parts(latest)) <= 0) fail(`version ${version} is not above ${latest}`);
let tagExists = true;
try {
  git('rev-parse', '-q', '--verify', `refs/tags/v${version}`);
} catch {
  tagExists = false;
}
if (tagExists) fail(`tag v${version} already exists`);

const changelogPath = at('CHANGELOG.md');
const changelog = readFileSync(changelogPath, 'utf8');
const date = dateArg ?? new Date().toISOString().slice(0, 10);
let promoted;
try {
  promoted = notes.promoteUnreleased(changelog, version, date);
} catch (err) {
  fail(err.message);
}
const section = notes.unreleasedSection(changelog);
const hits = notes.forbiddenHits(section.body);
if (hits.length > 0) {
  for (const h of hits) console.error(`CHANGELOG.md:${section.firstLine + h.line - 1}: ${h.text}`);
  fail(`${hits.length} line(s) in [Unreleased] use wording a public release note cannot carry`);
}

if (check) {
  const n = section.body.trim().split('\n').length;
  console.log(`PASS: [Unreleased] is ready to release as ${version} (${n} lines)`);
  process.exit(0);
}

writeFileSync(changelogPath, promoted);

function setJson(file, apply) {
  const p = at(file);
  const before = readFileSync(p, 'utf8');
  const obj = JSON.parse(before);
  apply(obj);
  const after = JSON.stringify(obj, null, 2) + '\n';
  if (after !== before) writeFileSync(p, after);
}
setJson('package.json', (o) => {
  o.version = version;
});
setJson('package-lock.json', (o) => {
  o.version = version;
  if (o.packages?.['']) o.packages[''].version = version;
});

if (notes.extractSection(readFileSync(changelogPath, 'utf8'), version) === null) {
  fail('the promoted section does not extract');
}
console.log(`PASS: CHANGELOG.md, package.json and package-lock.json are at ${version}`);

// test/git-discovery.test.js
//
// Exercises agent/nest_agent/git.py discover_git_repos against temporary
// repositories: a normal branch repo, an empty repo, and a detached HEAD.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');

/** Run git in `cwd` with the given args. @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** Init a git repo at `dir` on branch main with identity configured. @param {string} dir */
function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', '--local', 'user.email', 't@example.com']);
  git(dir, ['config', '--local', 'user.name', 'Tester']);
}

/** Call discover_git_repos(roots=[root]) via python and return parsed records. @param {string} root */
function discover(root) {
  const code = [
    'import json, sys',
    'from agent.nest_agent.git import discover_git_repos',
    `print(json.dumps(discover_git_repos(roots=[${JSON.stringify(root)}], max_depth=2)))`,
  ].join('\n');
  const out = execFileSync('python3', ['-c', code], { cwd: REPO_ROOT, encoding: 'utf8' });
  return JSON.parse(out);
}

test('git discovery: normal, empty, and detached repositories', () => {
  const base = mkdtempSync(join(tmpdir(), 'nest-git-'));

  // Normal repo: branch main, one commit.
  const normal = join(base, 'normal');
  initRepo(normal);
  writeFileSync(join(normal, 'file.txt'), 'hello');
  git(normal, ['add', 'file.txt']);
  git(normal, ['commit', '-qm', 'first commit']);

  // Empty repo: initialized, no commits (unborn HEAD).
  const empty = join(base, 'empty');
  initRepo(empty);

  // Detached HEAD repo: checkout a commit directly.
  const detached = join(base, 'detached');
  initRepo(detached);
  writeFileSync(join(detached, 'a.txt'), '1');
  git(detached, ['add', 'a.txt']);
  git(detached, ['commit', '-qm', 'c1']);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: detached, encoding: 'utf8' }).trim();
  git(detached, ['checkout', '-q', sha]);

  // A plain directory that is not a repo — must be skipped by discovery.
  mkdirSync(join(base, 'plain'));

  const records = discover(base);
  const byName = Object.fromEntries(records.map((r) => [r.name, r]));

  // Only the three repos are discovered; the plain dir is skipped.
  assert.deepStrictEqual(records.map((r) => r.name).sort(), ['detached', 'empty', 'normal']);

  // Normal repo: branch + recent commit with all fields populated.
  const n = byName.normal;
  assert.strictEqual(n.status, 'ok');
  assert.strictEqual(n.branch, 'main');
  assert.strictEqual(n.detached, false);
  assert.strictEqual(n.commits.length, 1);
  const c = n.commits[0];
  assert.match(c.sha, /^[0-9a-f]{40}$/);
  assert.strictEqual(c.subject, 'first commit');
  assert.strictEqual(c.author, 'Tester');
  assert.ok(c.date, 'commit has a date');

  // Empty repo: explicit status, no commits, no crash.
  const e = byName.empty;
  assert.strictEqual(e.status, 'empty');
  assert.deepStrictEqual(e.commits, []);
  assert.ok(e.error, 'empty repo reports an explicit error');

  // Detached HEAD: flagged, no branch, head sha present, no crash.
  const d = byName.detached;
  assert.strictEqual(d.status, 'detached');
  assert.strictEqual(d.detached, true);
  assert.strictEqual(d.branch, null);
  assert.ok(d.head, 'detached repo exposes a head identifier');
});

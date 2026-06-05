// hub/src/automation-state.js
//
// Reads + drives the self-running board for the /automation cockpit: systemd
// timers, the pause flag, automation.yaml, the Linear pipeline, decision logs.
// Exports: automationState, setPaused, runJob, previewAutoDone.
// Depends: LINEAR_API_TOKEN env, systemctl (read + sudo start), python3+pyyaml.

import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEST_ROOT = join(__dirname, '../..');
const YAML_PATH = join(NEST_ROOT, 'config/automation.yaml');
const LOG_DIR = join(NEST_ROOT, 'data/automation');
const PAUSE_FLAG = join(NEST_ROOT, 'data/automation.paused');

// job key → systemd unit base name. The cockpit only ever touches these three.
const JOBS = { executor: 'nest-executor', janitor: 'nest-janitor', 'auto-done': 'nest-auto-done' };

/** Run a command, never reject — resolve {err, stdout, stderr}. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, maxBuffer: 4 << 20, ...opts }, (err, stdout = '', stderr = '') => {
      resolve({ err, stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

/** systemctl show <unit> → {Property: value} map for the requested props. */
async function showUnit(unit, props) {
  const { stdout } = await run('systemctl', ['show', unit, `--property=${props.join(',')}`]);
  const map = {};
  for (const line of stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) map[line.slice(0, i)] = line.slice(i + 1);
  }
  return map;
}

/** systemctl renders *USec props as human date strings; parse to epoch ms or null. */
function dateMs(v) {
  if (!v || v === 'n/a') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// These timers fire on a monotonic schedule, so NextElapseUSecRealtime is empty.
// list-timers computes the wall-clock NEXT (first 4 tokens: "Day date time tz").
async function nextRuns() {
  const units = Object.values(JOBS).map((b) => `${b}.timer`);
  const { stdout } = await run('systemctl', ['list-timers', '--all', '--no-pager', ...units]);
  const map = {};
  for (const line of stdout.split('\n')) {
    for (const [job, base] of Object.entries(JOBS)) {
      if (!line.includes(`${base}.timer`)) continue;
      const t = line.trim().split(/\s+/);
      map[job] = t[0] === 'n/a' ? null : dateMs(`${t[0]} ${t[1]} ${t[2]} ${t[3]}`);
    }
  }
  return map;
}

async function readTimers() {
  const nexts = await nextRuns();
  const out = {};
  for (const [job, base] of Object.entries(JOBS)) {
    const t = await showUnit(`${base}.timer`, ['UnitFileState', 'ActiveState', 'LastTriggerUSec']);
    const s = await showUnit(`${base}.service`, ['ActiveState', 'Result', 'ExecMainStatus', 'ExecMainExitTimestamp']);
    out[job] = {
      unit: base,
      enabled: t.UnitFileState === 'enabled',
      timerActive: t.ActiveState === 'active',
      lastRun: dateMs(t.LastTriggerUSec),
      nextRun: nexts[job] ?? null,
      running: s.ActiveState === 'active' || s.ActiveState === 'activating',
      lastResult: s.Result || null,
      lastExit: s.ExecMainStatus ? Number(s.ExecMainStatus) : 0,
      lastFinished: dateMs(s.ExecMainExitTimestamp),
    };
  }
  return out;
}

async function readConfig() {
  const { stdout, err } = await run('python3', ['-c',
    'import yaml,json,sys; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', YAML_PATH]);
  if (err) return null;
  try { return JSON.parse(stdout); } catch { return null; }
}

async function readPipeline() {
  const token = process.env.LINEAR_API_TOKEN;
  if (!token) return { error: 'LINEAR_API_TOKEN not set' };
  // Top-level `issues` connections (filtered by team key) — NOT nested under
  // teams, which multiplies complexity past the 10k cap. Counts select only the
  // scalar `identifier`; Working/Review pull capped detail + labels.
  const ORDER = ['Backlog', "Spec'd", 'Working', 'Review', 'Done'];
  const team = 'team:{key:{eq:"AI"}}';
  const cnt = (alias, name) => `${alias}: issues(filter:{${team}, state:{name:{eq:"${name}"}}}, first:250){ nodes{ identifier } }`;
  const det = (alias, name) => `${alias}: issues(filter:{${team}, state:{name:{eq:"${name}"}}}, first:50){ nodes{ identifier title url branchName labels(first:10){ nodes{ name } } } }`;
  const query = `query{ ${cnt('backlog', 'Backlog')} ${cnt('specd', "Spec'd")} ${cnt('done', 'Done')}
    ${det('working', 'Working')} ${det('review', 'Review')} }`;
  let data;
  try {
    const r = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(12000),
    });
    data = await r.json();
  } catch (e) { return { error: e.message }; }
  if (data?.errors) return { error: data.errors[0]?.message || 'Linear query error' };
  const d = data?.data;
  if (!d) return { error: 'no data from Linear' };
  const map = (conn) => (conn?.nodes || []).map((n) => ({ id: n.identifier, title: n.title, url: n.url,
    branch: n.branchName, labels: (n.labels?.nodes || []).map((l) => l.name) }));
  const len = (conn) => conn?.nodes?.length || 0;
  const counts = {
    Backlog: len(d.backlog), "Spec'd": len(d.specd),
    Working: len(d.working), Review: len(d.review), Done: len(d.done),
  };
  return { counts, order: ORDER, working: map(d.working), review: map(d.review) };
}

async function readDecisions() {
  const out = [];
  try {
    const raw = await readFile(join(LOG_DIR, 'auto-done.jsonl'), 'utf-8');
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      try { out.push({ source: 'auto-done', ...JSON.parse(line) }); } catch {}
    }
  } catch {}
  try {
    for (const f of (await readdir(LOG_DIR)).filter((x) => x.startsWith('exec-') && x.endsWith('.log'))) {
      const s = await stat(join(LOG_DIR, f));
      out.push({ source: 'executor', issue: f.slice(5, -4), ts: s.mtime.toISOString(), action: 'run', file: f });
    }
  } catch {}
  out.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  return out.slice(0, 25);
}

/** @returns {Promise<Object>} full cockpit snapshot */
export async function automationState() {
  const [timers, config, pipeline, decisions] = await Promise.all([
    readTimers(), readConfig(), readPipeline(), readDecisions(),
  ]);
  return { paused: existsSync(PAUSE_FLAG), pauseFlag: PAUSE_FLAG, timers, config, pipeline, decisions, now: Date.now() };
}

/** Toggle the pause flag. paused=true writes it (halts loop), false removes it. */
export async function setPaused(paused) {
  if (paused) await writeFile(PAUSE_FLAG, '');
  else await unlink(PAUSE_FLAG).catch(() => {});
  return { paused: existsSync(PAUSE_FLAG) };
}

/** Trigger one run of a job's oneshot service now (non-blocking). */
export async function runJob(job) {
  const base = JOBS[job];
  if (!base) throw new Error(`unknown job: ${job}`);
  const { err, stderr } = await run('sudo', ['-n', 'systemctl', 'start', '--no-block', `${base}.service`]);
  if (err) throw new Error((stderr || err.message).trim());
  return { started: `${base}.service` };
}

/** Run the auto-Done gate in dry mode; return its {decisions, ...} JSON. */
export async function previewAutoDone() {
  const script = join(NEST_ROOT, 'scripts/tasks/auto-done.sh');
  const { stdout, stderr, err } = await run('bash', ['-c', `echo '{"dry_run":true}' | ${script}`], { timeout: 120000 });
  if (err && !stdout) throw new Error((stderr || err.message).trim());
  try { return JSON.parse(stdout); } catch { return { raw: stdout, stderr }; }
}

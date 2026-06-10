// hub/src/energyhack-state.js
//
// Reads + drives the Energy Hack board for the /energyhack cockpit: the EH
// executor timer, the EH pause flag, automation-eh.yaml, the team-EH Linear
// pipeline, the decision log, and the /opt/energyhack build-branch progress.
// Exports: energyhackState, setEhPaused, runEhExecutor.
// Depends: LINEAR_API_TOKEN env, systemctl (read + sudo start), python3+pyyaml.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEST_ROOT = join(__dirname, '../..');
const YAML_PATH = join(NEST_ROOT, 'config/automation-eh.yaml');
const PAUSE_FLAG = join(NEST_ROOT, 'data/automation-eh.paused');
const LOG = join(NEST_ROOT, 'data/automation-eh/executor.jsonl');
const REPO = '/opt/energyhack';
const BUILD = 'build';
// EH board was migrated 2026-06-10 from a standalone team into the "Energy Hack"
// project under team AI (to free a free-tier team slot). Query by project id now.
const PROJECT_ID = '96a1ecfb-8f67-41b9-9578-272809222db9';
const APP_URL = 'https://energyhack.kaltenbach.dev';
const UNIT = 'nest-eh-executor';

/** Run a command, never reject — resolve {err, stdout, stderr}. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, maxBuffer: 4 << 20, ...opts }, (err, stdout = '', stderr = '') => {
      resolve({ err, stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

async function showUnit(unit, props) {
  const { stdout } = await run('systemctl', ['show', unit, `--property=${props.join(',')}`]);
  const map = {};
  for (const line of stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) map[line.slice(0, i)] = line.slice(i + 1);
  }
  return map;
}

function dateMs(v) {
  if (!v || v === 'n/a') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

async function nextRun() {
  const { stdout } = await run('systemctl', ['list-timers', '--all', '--no-pager', `${UNIT}.timer`]);
  for (const line of stdout.split('\n')) {
    if (!line.includes(`${UNIT}.timer`)) continue;
    const t = line.trim().split(/\s+/);
    return t[0] === 'n/a' ? null : dateMs(`${t[0]} ${t[1]} ${t[2]} ${t[3]}`);
  }
  return null;
}

async function readTimer() {
  const t = await showUnit(`${UNIT}.timer`, ['UnitFileState', 'ActiveState', 'LastTriggerUSec']);
  const s = await showUnit(`${UNIT}.service`, ['ActiveState', 'Result', 'ExecMainStatus', 'ExecMainExitTimestamp']);
  return {
    unit: UNIT,
    enabled: t.UnitFileState === 'enabled',
    timerActive: t.ActiveState === 'active',
    installed: t.UnitFileState !== '' && t.UnitFileState !== undefined,
    lastRun: dateMs(t.LastTriggerUSec),
    nextRun: await nextRun(),
    running: s.ActiveState === 'active' || s.ActiveState === 'activating',
    lastResult: s.Result || null,
    lastExit: s.ExecMainStatus ? Number(s.ExecMainStatus) : 0,
    lastFinished: dateMs(s.ExecMainExitTimestamp),
  };
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
  const ORDER = ['Backlog', "Spec'd", 'Working', 'Review', 'Done'];
  const scope = `project:{id:{eq:"${PROJECT_ID}"}}`;
  const det = (alias, name) => `${alias}: issues(filter:{${scope}, state:{name:{eq:"${name}"}}}, first:50){ nodes{ identifier title url branchName labels(first:10){ nodes{ name } } } }`;
  const query = `query{ ${det('backlog', 'Backlog')} ${det('specd', "Spec'd")} ${det('working', 'Working')} ${det('review', 'Review')} ${det('done', 'Done')} }`;
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
  return {
    order: ORDER,
    counts: { Backlog: len(d.backlog), "Spec'd": len(d.specd), Working: len(d.working), Review: len(d.review), Done: len(d.done) },
    specd: map(d.specd), working: map(d.working), review: map(d.review), done: map(d.done),
  };
}

async function readDecisions() {
  try {
    const raw = await readFile(LOG, 'utf-8');
    const out = [];
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      try { out.push(JSON.parse(line)); } catch {}
    }
    return out.reverse().slice(0, 25);
  } catch { return []; }
}

// Build-branch progress: commits ahead of main + last commit + changed file count.
async function readBuild() {
  const exists = (await run('git', ['-C', REPO, 'rev-parse', '--verify', BUILD])).err == null;
  if (!exists) return { branchExists: false, appUrl: APP_URL };
  const ahead = (await run('git', ['-C', REPO, 'rev-list', '--count', `main..${BUILD}`])).stdout.trim();
  const last = (await run('git', ['-C', REPO, 'log', BUILD, '-1', '--pretty=%h %s (%cr)'])).stdout.trim();
  const files = (await run('git', ['-C', REPO, 'diff', '--name-only', `main...${BUILD}`])).stdout
    .split('\n').map((s) => s.trim()).filter(Boolean);
  return { branchExists: true, commitsAhead: Number(ahead) || 0, lastCommit: last, files, appUrl: APP_URL };
}

// Is a burn-through (drain) currently sprinting? Reads the oneshot service.
async function readBurning() {
  const s = await showUnit('nest-eh-drain.service', ['ActiveState']);
  return s.ActiveState === 'active' || s.ActiveState === 'activating';
}

/** @returns {Promise<Object>} full EH cockpit snapshot */
export async function energyhackState() {
  const [timer, config, pipeline, decisions, build, burning] = await Promise.all([
    readTimer(), readConfig(), readPipeline(), readDecisions(), readBuild(), readBurning(),
  ]);
  return { paused: existsSync(PAUSE_FLAG), pauseFlag: PAUSE_FLAG, timer, config, pipeline, decisions, build, burning, now: Date.now() };
}

/** Start a burn-through: run EH tickets back-to-back until done/out-of-tokens. */
export async function runEhBurn() {
  const { err, stderr } = await run('sudo', ['-n', 'systemctl', 'start', '--no-block', 'nest-eh-drain.service']);
  if (err) throw new Error((stderr || err.message).trim());
  return { started: 'nest-eh-drain.service' };
}

/** Toggle the EH pause flag. paused=true halts the loop; false resumes. */
export async function setEhPaused(paused) {
  const { writeFile, unlink } = await import('node:fs/promises');
  if (paused) await writeFile(PAUSE_FLAG, '');
  else await unlink(PAUSE_FLAG).catch(() => {});
  return { paused: existsSync(PAUSE_FLAG) };
}

/** Trigger one EH executor run now (non-blocking). */
export async function runEhExecutor() {
  const { err, stderr } = await run('sudo', ['-n', 'systemctl', 'start', '--no-block', `${UNIT}.service`]);
  if (err) throw new Error((stderr || err.message).trim());
  return { started: `${UNIT}.service` };
}

// hub/src/ssh-exec.js
//
// Shared spawn helper for SSH-driven hosts (discovery + lifecycle). Exports: runSsh(alias, command, opts). Depends: child_process.

import { spawn } from "child_process";

/**
 * Run a single command on an SSH-aliased host. Non-interactive (BatchMode),
 * connect-bounded (ConnectTimeout=10), kill-bounded (timeoutMs hard SIGKILL).
 * The command is passed as one positional argument to ssh — the remote shell
 * splits it. Callers MUST construct it from trusted/whitelisted inputs.
 *
 * @param {string} alias  ssh_config Host alias (e.g. "stoneshop")
 * @param {string} command  remote command line
 * @param {{ timeoutMs?: number, stderrLimit?: number }} [opts]
 * @returns {Promise<{ ok: boolean, exitCode: number|null, stdout: string, stderr: string, durationMs: number, timedOut: boolean }>}
 */
export function runSsh(alias, command, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const stderrLimit = opts.stderrLimit ?? 4096;
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      "ssh",
      ["-o", "ConnectTimeout=10", "-o", "BatchMode=yes", alias, command],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.length > stderrLimit) stderr = stderr.slice(0, stderrLimit);
    });
    const killTimer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(killTimer);
      resolve({ ok: false, exitCode: null, stdout, stderr: e.message, durationMs: Date.now() - started, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        stdout,
        stderr: stderr.trim(),
        durationMs: Date.now() - started,
        timedOut,
      });
    });
  });
}

// ── chat.js ───────────────────────────────────────────
// OpenClaw chat backed by local Codex CLI
// ──────────────────────────────────────────────────────
import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { getAgentData } from "../ws/agentHandler.js";
import { sendJson, sendError } from '../server.js';

const execFileAsync = promisify(execFile);
const CODEX_BIN = process.env.NEST_CODEX_BIN || "codex";
const CODEX_MODEL = process.env.NEST_CLAW_MODEL || "gpt-5.4";
const HETZNER_API = "https://api.hetzner.cloud/v1";
const REPO_ROOT = "/opt/nest";

const history = [];
let msgCounter = 0;

function makeId() {
  return `msg-${++msgCounter}-${Date.now()}`;
}

function truncate(text, max = 24000) {
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated]`;
}

function formatAgentContext() {
  const agents = getAgentData();
  if (agents.length === 0) return "No live Nest agents are currently connected.";

  return agents.map((agent) => {
    const metrics = agent.metrics
      ? `CPU ${agent.metrics.cpu.percent}% | RAM ${agent.metrics.memory.percent}% | Disk ${agent.metrics.disk.percent}% | Uptime ${Math.round(agent.metrics.uptime_seconds / 60)}m`
      : "metrics unavailable";
    const containers = (agent.containers || []).slice(0, 12).map((container) => `${container.name} (${container.status})`);
    const repos = (agent.discoveredRepos || []).slice(0, 8).map((repo) => `${repo.name} @ ${repo.path}${repo.dirty ? " [dirty]" : ""}`);
    return [
      `Host ${agent.hostname}: ${metrics}`,
      `Containers: ${containers.length > 0 ? containers.join(", ") : "none"}`,
      `Repos: ${repos.length > 0 ? repos.join(", ") : "none discovered"}`,
    ].join("\n");
  }).join("\n\n");
}

async function fetchHetznerServers() {
  if (!process.env.HETZNER_API_TOKEN) return [];

  try {
    const res = await fetch(`${HETZNER_API}/servers`, {
      headers: { Authorization: `Bearer ${process.env.HETZNER_API_TOKEN}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.servers || []).map((server) => ({
      id: server.id,
      name: server.name,
      status: server.status,
      ipv4: server.public_net?.ipv4?.ip ?? null,
    }));
  } catch {
    return [];
  }
}

async function readCodexSummary() {
  try {
    const raw = await readFile("/home/claude/.codex/auth.json", "utf-8");
    const auth = JSON.parse(raw);
    const accessToken = auth.tokens?.access_token;
    if (!accessToken) return "Codex auth file present, but access token is missing.";

    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString());
    const openaiAuth = payload["https://api.openai.com/auth"] || {};
    const profile = payload["https://api.openai.com/profile"] || {};
    const plan = openaiAuth.chatgpt_plan_type || "unknown";
    const expires = payload.exp ? new Date(payload.exp * 1000).toISOString() : "unknown";
    return `Codex CLI is logged in via ChatGPT OAuth. Plan: ${plan}. Account: ${profile.email || "unknown"}. Access token expires: ${expires}.`;
  } catch {
    return "Codex CLI auth status could not be read.";
  }
}

async function buildPrompt(messages, currentMessage, mode) {
  const servers = await fetchHetznerServers();
  const codexSummary = await readCodexSummary();
  const recentHistory = messages
    .slice(-10)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");

  const serverText = servers.length > 0
    ? servers.map((server) => `- ${server.name} (${server.status})${server.ipv4 ? ` ${server.ipv4}` : ""}`).join("\n")
    : "No Hetzner server snapshot available.";

  return truncate([
    "You are OpenClaw running inside Nest.",
    "You are the conversational operator for this infrastructure and code workspace.",
    "Be concise, precise, and operationally useful.",
    mode === "workspace-write"
      ? "The user explicitly requested write mode. You may inspect and modify files inside /opt/nest when needed, then summarize what changed."
      : "You are in read-only mode. Do not make file changes. If the user wants edits, tell them to prefix the request with /apply.",
    "Prefer concrete answers grounded in the live Nest state below.",
    "If live state is missing, say so plainly instead of inventing facts.",
    "",
    `Current UTC time: ${new Date().toISOString()}`,
    codexSummary,
    "",
    "Live Nest agent state:",
    formatAgentContext(),
    "",
    "Hetzner servers:",
    serverText,
    "",
    "Recent chat history:",
    recentHistory || "No prior history.",
    "",
    "Current user message:",
    currentMessage,
  ].join("\n"));
}

async function runCodex(prompt, mode) {
  const outputPath = join(tmpdir(), `nest-claw-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    mode,
    "-C",
    REPO_ROOT,
    "-m",
    CODEX_MODEL,
    "-o",
    outputPath,
    prompt,
  ];

  const { stdout, stderr } = await execFileAsync(CODEX_BIN, args, {
    cwd: REPO_ROOT,
    timeout: 180_000,
    maxBuffer: 1024 * 1024 * 4,
  });

  const finalMessage = await readFile(outputPath, "utf-8").catch(() => "");
  const text = finalMessage.trim();
  if (text) return text;

  const combined = `${stdout}\n${stderr}`.trim();
  if (combined) return combined;
  throw new Error("Codex returned no output");
}

function helpMessage() {
  return [
    "OpenClaw is now backed by the local Codex CLI.",
    "",
    "Modes:",
    "- Plain message: read-only analysis and guidance",
    "- `/apply ...`: workspace-write mode for changes inside `/opt/nest`",
    "",
    "Examples:",
    "- `summarize the failing services`",
    "- `/apply make the tokens page denser`",
    "- `which server looks overloaded right now?`",
  ].join("\n");
}

export function chatRoutes(router) {
  router.get("/chat/history", async (req, res) => {
    sendJson(res, { messages: history.slice(-50) });
  });

  router.post("/chat/send", async (req, res) => {
    const message = req.body.message?.trim();
    if (!message) return sendError(res, 400, "message is required");

    const userMsg = { id: makeId(), role: "user", content: message, timestamp: Date.now() };
    history.push(userMsg);

    let response;

    if (message.toLowerCase() === "help") {
      response = helpMessage();
    } else {
      const writeMode = message.startsWith("/apply ");
      const content = writeMode ? message.slice(7).trim() : message;

      try {
        const prompt = await buildPrompt(history, content, writeMode ? "workspace-write" : "read-only");
        response = await runCodex(prompt, writeMode ? "workspace-write" : "read-only");
      } catch (error) {
        console.error("OpenClaw Codex execution failed", error);
        response = `OpenClaw could not reach Codex cleanly: ${error.message || "unknown error"}`;
      }
    }

    const assistantMsg = {
      id: makeId(),
      role: "assistant",
      content: response,
      timestamp: Date.now(),
    };
    history.push(assistantMsg);

    sendJson(res, { userMessage: userMsg, assistantMessage: assistantMsg });
  });
}

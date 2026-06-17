// hub/src/routes/council.js
//
// Council: multi-user discussion topics with Claude as mediator. File-backed, no DB.
// Exports: councilRoutes(router). Depends: data/council/, council-mediator.js

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { sendJson, sendError } from '../server.js';
import { runMediator } from './council-mediator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEST_ROOT = join(__dirname, '../../..');
const DATA_DIR = process.env.NEST_COUNCIL_DIR || join(NEST_ROOT, 'data/council');
const INDEX_FILE = join(DATA_DIR, 'index.json');

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/** @returns {Array<{id, title, createdBy, createdAt}>} */
function loadIndex() {
  if (!existsSync(INDEX_FILE)) return [];
  try { return JSON.parse(readFileSync(INDEX_FILE, 'utf-8')); }
  catch { return []; }
}

function saveIndex(topics) {
  ensureDir();
  writeFileSync(INDEX_FILE, JSON.stringify(topics, null, 2), 'utf-8');
}

/** @param {string} id - topic id (validated by caller) */
function topicFile(id) {
  return join(DATA_DIR, `${id}.jsonl`);
}

/** Only allow ids we generated — blocks path traversal into other files. */
function validId(id) {
  return typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
}

/**
 * @param {string} id
 * @param {number} [after] - return only messages with ts strictly greater
 * @returns {Array<{ts, author, role, text}>}
 */
function readMessages(id, after) {
  const path = topicFile(id);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  const msgs = [];
  for (const line of lines) {
    try {
      const m = JSON.parse(line);
      if (!after || m.ts > after) msgs.push(m);
    } catch { /* skip malformed line */ }
  }
  return msgs;
}

/** @param {string} id @param {{ts, author, role, text}} msg */
function appendMessage(id, msg) {
  ensureDir();
  appendFileSync(topicFile(id), JSON.stringify(msg) + '\n');
}

/** Distinct human display names in a thread, in first-seen order. */
function participantsOf(messages) {
  const seen = [];
  for (const m of messages) {
    if (m.role === 'human' && !seen.includes(m.author)) seen.push(m.author);
  }
  return seen;
}

/**
 * Register Council routes. Author always comes from req.user, never the body.
 * @param {import('../server.js').Router} router
 */
export function councilRoutes(router) {
  // List topics (newest first)
  router.get('/council/topics', (req, res) => {
    const topics = loadIndex().slice().sort((a, b) => b.createdAt - a.createdAt);
    sendJson(res, { topics });
  });

  // Create a topic
  router.post('/council/topics', (req, res) => {
    const title = (req.body?.title || '').toString().trim();
    if (!title) return sendError(res, 400, 'title is required');
    const topic = { id: randomUUID(), title: title.slice(0, 200), createdBy: req.user.name, createdAt: Date.now() };
    const topics = loadIndex();
    topics.push(topic);
    saveIndex(topics);
    sendJson(res, { topic }, 201);
  });

  // Incremental message poll
  router.get('/council/:id/messages', (req, res) => {
    const { id } = req.params;
    if (!validId(id)) return sendError(res, 404, 'Topic not found');
    if (!loadIndex().some((t) => t.id === id)) return sendError(res, 404, 'Topic not found');
    const after = req.query?.after ? Number(req.query.after) : 0;
    sendJson(res, { messages: readMessages(id, Number.isFinite(after) ? after : 0) });
  });

  // Append a human message
  router.post('/council/:id/message', (req, res) => {
    const { id } = req.params;
    if (!validId(id)) return sendError(res, 404, 'Topic not found');
    if (!loadIndex().some((t) => t.id === id)) return sendError(res, 404, 'Topic not found');
    const text = (req.body?.text || '').toString().trim();
    if (!text) return sendError(res, 400, 'text is required');
    const msg = { ts: Date.now(), author: req.user.name, role: 'human', text: text.slice(0, 8000) };
    appendMessage(id, msg);
    sendJson(res, { message: msg }, 201);
  });

  // Invoke the mediator
  router.post('/council/:id/invoke', async (req, res) => {
    const { id } = req.params;
    if (!validId(id)) return sendError(res, 404, 'Topic not found');
    if (!loadIndex().some((t) => t.id === id)) return sendError(res, 404, 'Topic not found');
    const focus = req.body?.focus ? String(req.body.focus) : undefined;
    const messages = readMessages(id);
    try {
      const { text } = await runMediator({ messages, participants: participantsOf(messages), focus });
      const msg = { ts: Date.now(), author: 'Claude', role: 'mediator', text };
      appendMessage(id, msg);
      sendJson(res, { message: msg }, 201);
    } catch (err) {
      sendError(res, err.status || 500, err.message);
    }
  });
}

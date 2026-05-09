// hub/src/routes/router.js
//
// Capacity-aware engine recommendation for the future Nest chat router.
// Reads the C10 token ledger and returns the best current engine plus a human-readable reason.
// Exports: routerRoutes(router)

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sendJson, sendError } from '../server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEST_ROOT = join(__dirname, '../../..');
const LEDGER_FILE = process.env.NEST_TOKEN_LEDGER || join(NEST_ROOT, 'data/token-ledger.json');

function fmtPct(fraction) {
  if (fraction == null || Number.isNaN(Number(fraction))) return 'unknown';
  return `${Math.round(Number(fraction) * 100)}%`;
}

function sourceById(ledger, id) {
  return (ledger.sources || []).find((s) => s.id === id) || null;
}

function knownFraction(source) {
  const pct = source?.remaining?.percent;
  if (source?.remaining?.unknown === false && pct != null) return Math.max(0, Math.min(1, Number(pct) / 100));
  return null;
}

function buildCandidates(ledger) {
  const hermes = sourceById(ledger, 'openrouter-hermes');
  const claude = sourceById(ledger, 'claude-pro');
  const codex = sourceById(ledger, 'codex-pro');

  const candidates = [];

  if (hermes) {
    const fraction = knownFraction(hermes);
    const remaining = hermes.remaining?.amount;
    const cap = hermes.cap?.amount;
    candidates.push({
      engine: 'hermes',
      label: 'Hermes / OpenRouter',
      confidence: fraction == null ? 'unknown' : 'high',
      fraction,
      rank: fraction == null ? 0.1 : 0.85 + fraction,
      reason: fraction == null
        ? 'Hermes/OpenRouter quota exists, but remaining daily free requests are unknown.'
        : `Hermes has ${remaining}/${cap} OpenRouter free requests left today (${fmtPct(fraction)} remaining).`,
      sourceId: 'openrouter-hermes',
    });
  }

  if (claude) {
    const fraction = knownFraction(claude);
    candidates.push({
      engine: 'claude-code',
      label: 'Claude Code',
      confidence: fraction == null ? 'unknown' : 'medium',
      fraction,
      rank: fraction == null ? 0.05 : 0.7 + fraction,
      reason: fraction == null
        ? 'Claude Code capacity is unknown from local logs.'
        : `Claude Code has ${claude.remaining?.amount}/${claude.cap?.amount} conservative 5h prompts left (${fmtPct(fraction)} remaining).`,
      sourceId: 'claude-pro',
    });
  }

  if (codex) {
    candidates.push({
      engine: 'openclaw',
      label: 'OpenClaw / Codex',
      confidence: 'low',
      fraction: null,
      rank: 0.2,
      reason: `Codex usage is tracked (${(codex.used?.amount || 0).toLocaleString()} tokens this month), but OAuth does not expose remaining subscriber quota locally.`,
      sourceId: 'codex-pro',
    });
  }

  return candidates.sort((a, b) => b.rank - a.rank);
}

export async function routerRoutes(router) {
  router.get('/router/recommendation', async (req, res) => {
    try {
      const ledger = JSON.parse(await readFile(LEDGER_FILE, 'utf-8'));
      const candidates = buildCandidates(ledger);
      if (!candidates.length) return sendError(res, 503, 'No engine capacity sources available');
      const recommendation = candidates[0];
      sendJson(res, {
        generatedAt: new Date().toISOString(),
        ledgerGeneratedAt: ledger.generatedAt || null,
        mode: 'auto',
        recommendation,
        candidates,
      });
    } catch (err) {
      sendError(res, 500, `Router recommendation failed: ${err.message}`);
    }
  });
}

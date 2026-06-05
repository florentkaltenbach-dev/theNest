// hub/src/routes/automation.js
//
// Cockpit API for the self-running board: live state + supervise/debug controls.
// Exports: automationRoutes(router). Depends: automation-state.js.

import { sendJson, sendError, requireAdmin } from '../server.js';
import { automationState, setPaused, runJob, previewAutoDone } from '../automation-state.js';

/** @param {Object} router - the /api-prefixed router */
export function automationRoutes(router) {
  // Live snapshot: timers, pause flag, Linear pipeline, decisions, config.
  router.get('/automation/state', async (req, res) => {
    try { sendJson(res, await automationState()); }
    catch (e) { sendError(res, 500, e.message); }
  });

  // Pause (default) or resume the loop by toggling the pause flag. Admin only.
  router.post('/automation/pause', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendJson(res, await setPaused(req.body?.paused !== false));
  });

  // Trigger one run now: job ∈ {executor, janitor, auto-done}. Admin only.
  router.post('/automation/run/:job', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try { sendJson(res, await runJob(req.params.job)); }
    catch (e) { sendError(res, 400, e.message); }
  });

  // Dry-run the auto-Done gate → per-ticket would-close/would-hold verdicts.
  router.post('/automation/preview-auto-done', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try { sendJson(res, await previewAutoDone()); }
    catch (e) { sendError(res, 500, e.message); }
  });
}

// hub/src/routes/energyhack.js
//
// Cockpit API for the Energy Hack board: live EH state + pause/resume + run-now.
// Exports: energyhackRoutes(router). Depends: energyhack-state.js.

import { sendJson, sendError, requireAdmin } from '../server.js';
import { energyhackState, setEhPaused, runEhExecutor, runEhBurn } from '../energyhack-state.js';

/** @param {Object} router - the /api-prefixed router */
export function energyhackRoutes(router) {
  // Live snapshot: EH timer, pause flag, automation-eh.yaml, EH pipeline,
  // decisions, build-branch progress.
  router.get('/energyhack/state', async (req, res) => {
    try { sendJson(res, await energyhackState()); }
    catch (e) { sendError(res, 500, e.message); }
  });

  // Pause (default) or resume the EH loop by toggling its pause flag. Admin only.
  router.post('/energyhack/pause', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendJson(res, await setEhPaused(req.body?.paused !== false));
  });

  // Trigger one EH executor run now. Admin only.
  router.post('/energyhack/run', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try { sendJson(res, await runEhExecutor()); }
    catch (e) { sendError(res, 400, e.message); }
  });

  // Burn through: run tickets back-to-back until done / out-of-tokens. Admin only.
  router.post('/energyhack/burn', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try { sendJson(res, await runEhBurn()); }
    catch (e) { sendError(res, 400, e.message); }
  });
}

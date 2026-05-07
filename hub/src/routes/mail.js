// hub/src/routes/mail.js
//
// Outbound mail endpoint for the hub. POST /api/mail/test sends a test mail to the requesting user (admin-only). Future: alert hooks (agent offline, backup failed, etc.) call sendMail() directly. Exports: mailRoutes(router). Depends: ../mail.js.

import { sendMail } from "../mail.js";
import { sendJson, sendError } from "../server.js";

export function mailRoutes(router) {
  router.post("/mail/test", async (req, res) => {
    if (req.user?.role !== "admin") return sendError(res, 403, "Admin only");
    const { to, subject, body } = req.body || {};
    const recipient = to || "ausfragezeichen@gmail.com";

    try {
      await sendMail({
        to: recipient,
        subject: subject || "Nest hub test mail",
        body: body || `This is a test from the Nest hub at ${new Date().toISOString()}.\n\nTriggered by ${req.user.name || req.user.id} via /api/mail/test.\n\nIf you received this with dkim=pass, the SMTP relay through kaltenbach mailcow is healthy.\n`,
      });
      sendJson(res, { ok: true, sentTo: recipient });
    } catch (e) {
      sendError(res, 500, `mail send failed: ${e.message}`);
    }
  });
}

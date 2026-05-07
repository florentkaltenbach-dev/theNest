// hub/src/mail.js
//
// Outbound mail via SMTP+STARTTLS through the kaltenbach mailcow relay. Spawns python3 + smtplib (already on the box for the agent) instead of pulling in nodemailer or rolling raw SMTP. Reads SMTP_HOST/PORT/USER/PASS/FROM from process.env. Exports: sendMail({to, subject, body, from?}). Throws on transport failure.

import { spawn } from "child_process";

const SCRIPT = `
import json, smtplib, ssl, sys
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid

p = json.load(sys.stdin)
msg = MIMEText(p["body"], "plain", "utf-8")
msg["Subject"] = p["subject"]
msg["From"] = p["from"]
msg["To"] = p["to"]
msg["Date"] = formatdate(localtime=True)
msg["Message-ID"] = make_msgid(domain=p["from"].split("@")[-1].rstrip(">"))

ctx = ssl.create_default_context()
with smtplib.SMTP(p["host"], int(p["port"]), timeout=20) as s:
    s.ehlo()
    s.starttls(context=ctx)
    s.ehlo()
    s.login(p["user"], p["password"])
    s.send_message(msg)
print("ok")
`;

/**
 * Send mail through the configured SMTP relay.
 * @param {{ to: string, subject: string, body: string, from?: string }} args
 * @returns {Promise<{ messageId?: string }>}  Resolves on a 250 from the server. Rejects with stderr on any other outcome.
 */
export async function sendMail({ to, subject, body, from }) {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || "587";
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASS;
  const fromAddr = from || process.env.SMTP_FROM;
  if (!host || !user || !password || !fromAddr) {
    throw new Error("SMTP_HOST/USER/PASS/FROM not all set in env — see config.env.example");
  }
  if (!to || !subject || body === undefined) {
    throw new Error("sendMail: to, subject, and body are required");
  }

  const payload = JSON.stringify({ host, port, user, password, from: fromAddr, to, subject, body });

  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`mail send failed (exit ${code}): ${stderr.trim()}`));
      if (!stdout.includes("ok")) return reject(new Error(`mail send returned unexpected output: ${stdout.trim()}`));
      resolve({ ok: true });
    });
    child.stdin.end(payload);
  });
}

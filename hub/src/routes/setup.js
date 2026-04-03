// ── setup.js ──────────────────────────────────────────
// First-run onboarding (provider token + git identity)
// ──────────────────────────────────────────────────────
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { execSync } from "child_process";
import { hostname } from "node:os";
import { sendJson, sendError } from '../server.js';

const SETUP_FILE = "/opt/nest/setup.json";

async function loadSetup() {
  try {
    if (existsSync(SETUP_FILE)) {
      return JSON.parse(await readFile(SETUP_FILE, "utf-8"));
    }
  } catch {}
  return { completed: false };
}

async function saveSetup(state) {
  await writeFile(SETUP_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export function setupRoutes(router) {
  // Check if onboarding is completed (public — no auth needed for initial setup check)
  router.get("/setup/status", async (req, res) => {
    const setup = await loadSetup();
    sendJson(res, { needsSetup: !setup.completed, ...setup });
  });

  // Save provider token during onboarding
  router.post("/setup/complete", async (req, res) => {
    const { hetznerToken, adminPassword, gitName, gitEmail } = req.body;
    if (!hetznerToken || !adminPassword) {
      return sendError(res, 400, "hetznerToken and adminPassword required");
    }

    // Write to config.env
    const configPath = process.env.NEST_CONFIG_PATH || "/opt/nest/config.env";
    let content = "";
    try {
      content = await readFile(configPath, "utf-8");
    } catch {}

    // Update or append values
    const updates = {
      HETZNER_API_TOKEN: hetznerToken,
      NEST_ADMIN_PASSWORD: adminPassword,
    };
    if (gitName) updates.GIT_USER_NAME = gitName;
    if (gitEmail) updates.GIT_USER_EMAIL = gitEmail;

    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`);
      } else {
        content += `\n${key}=${value}`;
      }
    }

    await writeFile(configPath, content, "utf-8");

    // Update process env so hub picks it up immediately
    process.env.HETZNER_API_TOKEN = hetznerToken;
    process.env.NEST_ADMIN_PASSWORD = adminPassword;

    // Configure git identity
    const gName = gitName || "nest";
    const gEmail = gitEmail || `nest@${hostname()}`;
    try {
      execSync(`git config --global user.name ${JSON.stringify(gName)}`);
      execSync(`git config --global user.email ${JSON.stringify(gEmail)}`);
    } catch {}

    // Mark setup as completed
    await saveSetup({ completed: true, completedAt: Date.now() });

    sendJson(res, { success: true });
  });
}

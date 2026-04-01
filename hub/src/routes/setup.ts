import { FastifyInstance } from "fastify";
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { execSync } from "child_process";

const SETUP_FILE = "/opt/nest/setup.json";

interface SetupState {
  completed: boolean;
  completedAt?: number;
  hubServer?: string;
}

async function loadSetup(): Promise<SetupState> {
  try {
    if (existsSync(SETUP_FILE)) {
      return JSON.parse(await readFile(SETUP_FILE, "utf-8"));
    }
  } catch {}
  return { completed: false };
}

async function saveSetup(state: SetupState): Promise<void> {
  await writeFile(SETUP_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export async function setupRoutes(app: FastifyInstance) {
  // Check if onboarding is completed (public — no auth needed for initial setup check)
  app.get("/setup/status", async () => {
    const setup = await loadSetup();
    return { needsSetup: !setup.completed, ...setup };
  });

  // Save provider token during onboarding
  app.post<{ Body: { hetznerToken: string; adminPassword: string; gitName?: string; gitEmail?: string } }>("/setup/complete", async (req, reply) => {
    const { hetznerToken, adminPassword, gitName, gitEmail } = req.body;
    if (!hetznerToken || !adminPassword) {
      return reply.code(400).send({ error: "hetznerToken and adminPassword required" });
    }

    // Write to config.env
    const configPath = process.env.NEST_CONFIG_PATH || "/opt/nest/config.env";
    let content = "";
    try {
      content = await readFile(configPath, "utf-8");
    } catch {}

    // Update or append values
    const updates: Record<string, string> = {
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
    const gEmail = gitEmail || `nest@${require("os").hostname()}`;
    try {
      execSync(`git config --global user.name ${JSON.stringify(gName)}`);
      execSync(`git config --global user.email ${JSON.stringify(gEmail)}`);
    } catch {}

    // Mark setup as completed
    await saveSetup({ completed: true, completedAt: Date.now() });

    return { success: true };
  });
}

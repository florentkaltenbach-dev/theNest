// ── canvas.js ─────────────────────────────────────────
// Visual canvas state (scripts filesystem mapping)
// ──────────────────────────────────────────────────────
import { readFile, writeFile, mkdir, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { sendJson } from '../server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANVAS_FILE = process.env.NEST_CANVAS_FILE || "/opt/nest/data/canvas.json";
const SCRIPTS_DIR = join(__dirname, "../../../scripts");

async function loadCanvas() {
  try {
    if (existsSync(CANVAS_FILE)) {
      return JSON.parse(await readFile(CANVAS_FILE, "utf-8"));
    }
  } catch {}
  return { boxes: {} };
}

async function saveCanvas(canvas) {
  const dir = dirname(CANVAS_FILE);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(CANVAS_FILE, JSON.stringify(canvas, null, 2), "utf-8");
}

// Recursively scan scripts directory to build canvas boxes
async function scanDir(dir, prefix) {
  const boxes = {};
  const children = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    // Sort: directories first, then files
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        const boxId = relPath.replace(/\//g, "-");
        const sub = await scanDir(join(dir, entry.name), relPath);
        if (sub.children.length === 0) continue; // skip empty dirs
        boxes[boxId] = {
          label: entry.name.toUpperCase(),
          children: sub.children,
        };
        Object.assign(boxes, sub.boxes);
        children.push(boxId);
      } else if (entry.name.endsWith(".sh")) {
        const boxId = `s-${relPath.replace(/\//g, "-").replace(/\.sh$/, "")}`;
        // Parse script name from tags
        let label = basename(entry.name, ".sh");
        try {
          const content = await readFile(join(dir, entry.name), "utf-8");
          const nameMatch = content.match(/^#\s*@name\s+(.+)$/m);
          if (nameMatch) label = nameMatch[1].trim();
        } catch {}
        boxes[boxId] = {
          type: "script",
          ref: relPath,
          label,
        };
        children.push(boxId);
      }
    }
  } catch {}

  return { boxes, children };
}

export function canvasRoutes(router) {
  // Get canvas state
  router.get("/canvas", async (req, res) => {
    sendJson(res, await loadCanvas());
  });

  // Save canvas state
  router.put("/canvas", async (req, res) => {
    const canvas = req.body;
    await saveCanvas(canvas);
    sendJson(res, { ok: true });
  });

  // Sync canvas with filesystem — merge new/removed scripts while preserving user customization
  router.post("/canvas/sync", async (req, res) => {
    const { boxes: freshBoxes, children: freshRootChildren } = await scanDir(SCRIPTS_DIR, "");
    const existing = await loadCanvas();

    if (!existing.boxes || Object.keys(existing.boxes).length === 0) {
      // No existing canvas — just init from scratch
      let nextY = 20;
      for (const childId of freshRootChildren) {
        const box = freshBoxes[childId];
        if (box) {
          box.x = 20;
          box.y = nextY;
          const childCount = box.children?.length || 1;
          const rows = Math.ceil(childCount / 5);
          nextY += rows * 100 + 60;
        }
      }
      const canvas = {
        boxes: { root: { children: freshRootChildren }, ...freshBoxes },
      };
      await saveCanvas(canvas);
      return sendJson(res, canvas);
    }

    // Collect all script refs from fresh scan
    const freshScriptRefs = new Set();
    for (const [, box] of Object.entries(freshBoxes)) {
      if (box.type === "script" && box.ref) freshScriptRefs.add(box.ref);
    }

    // Build a map of freshBox id -> parent id for quick lookup
    const freshParent = {};
    for (const [id, box] of Object.entries(freshBoxes)) {
      if (box.children) {
        for (const child of box.children) {
          freshParent[child] = id;
        }
      }
    }
    for (const child of freshRootChildren) {
      if (!freshParent[child]) freshParent[child] = "root";
    }

    // Add new boxes that don't exist yet
    for (const [id, box] of Object.entries(freshBoxes)) {
      if (!existing.boxes[id]) {
        existing.boxes[id] = box;
        // Ensure it's in its parent's children array
        const parentId = freshParent[id] || "root";
        if (existing.boxes[parentId]) {
          const parentChildren = existing.boxes[parentId].children || [];
          if (!parentChildren.includes(id)) {
            parentChildren.push(id);
            existing.boxes[parentId].children = parentChildren;
          }
        }
      }
    }

    // Ensure new directories appear in root children if they're top-level
    if (existing.boxes.root) {
      const rootChildren = existing.boxes.root.children || [];
      for (const childId of freshRootChildren) {
        if (!rootChildren.includes(childId)) {
          rootChildren.push(childId);
        }
      }
      existing.boxes.root.children = rootChildren;
    }

    // Remove boxes whose script ref no longer exists on disk
    for (const [id, box] of Object.entries(existing.boxes)) {
      if (box.type === "script" && box.ref && !freshScriptRefs.has(box.ref)) {
        // Remove from any parent's children array
        for (const [, pBox] of Object.entries(existing.boxes)) {
          if (pBox.children) {
            const idx = pBox.children.indexOf(id);
            if (idx !== -1) pBox.children.splice(idx, 1);
          }
        }
        delete existing.boxes[id];
      }
    }

    // Remove directory containers that existed before but are now gone from disk and are empty
    const freshDirIds = new Set();
    for (const [id, box] of Object.entries(freshBoxes)) {
      if (!box.type || box.type !== "script") freshDirIds.add(id);
    }
    for (const [id, box] of Object.entries(existing.boxes)) {
      if (id === "root") continue;
      if ((!box.type || box.type !== "script") && !freshDirIds.has(id)) {
        const children = box.children || [];
        if (children.length === 0) {
          for (const [, pBox] of Object.entries(existing.boxes)) {
            if (pBox.children) {
              const idx = pBox.children.indexOf(id);
              if (idx !== -1) pBox.children.splice(idx, 1);
            }
          }
          delete existing.boxes[id];
        }
      }
    }

    await saveCanvas(existing);
    sendJson(res, existing);
  });

  // Auto-generate canvas from scripts filesystem
  router.post("/canvas/init", async (req, res) => {
    const { boxes: scriptBoxes, children: rootChildren } = await scanDir(SCRIPTS_DIR, "");

    // Compute initial x,y for top-level boxes — stack vertically
    let nextY = 20;
    for (const childId of rootChildren) {
      const box = scriptBoxes[childId];
      if (box) {
        box.x = 20;
        box.y = nextY;
        const childCount = box.children?.length || 1;
        const rows = Math.ceil(childCount / 5);
        nextY += rows * 100 + 60;
      }
    }

    const canvas = {
      boxes: {
        root: { children: rootChildren },
        ...scriptBoxes,
      },
    };

    await saveCanvas(canvas);
    sendJson(res, canvas);
  });
}

// ── artifacts.js ──────────────────────────────────────
// Browse and view docs artifacts (text + images)
// ──────────────────────────────────────────────────────
import { readdir, readFile, stat } from "fs/promises";
import { dirname, extname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { sendJson, sendError } from '../server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = resolve(join(__dirname, "../../../docs"));
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yml", ".yaml"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg", ".webp"]);
const ALLOWED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...IMAGE_EXTENSIONS]);
const MAX_INLINE_BYTES = 2 * 1024 * 1024;

function artifactKind(ext) {
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}

async function listArtifactsRecursive(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) return listArtifactsRecursive(fullPath);
    if (!entry.isFile()) return [];

    const ext = extname(entry.name).toLowerCase();
    const kind = artifactKind(ext);
    if (!kind) return [];

    const info = await stat(fullPath);
    return [{
      path: relative(ARTIFACTS_DIR, fullPath),
      name: entry.name,
      ext,
      kind,
      size: info.size,
      modified: info.mtime.toISOString(),
    }];
  }));

  return nested.flat().sort((a, b) => a.path.localeCompare(b.path));
}

function resolveArtifactPath(relPath) {
  const normalized = relPath.replace(/\\/g, "/");
  const fullPath = resolve(ARTIFACTS_DIR, normalized);
  if (!fullPath.startsWith(`${ARTIFACTS_DIR}/`) && fullPath !== ARTIFACTS_DIR) return null;

  const ext = extname(fullPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;
  return fullPath;
}

function mimeType(ext) {
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".svg": return "image/svg+xml";
    case ".webp": return "image/webp";
    case ".json": return "application/json";
    case ".yml":
    case ".yaml": return "application/x-yaml";
    default: return "text/plain; charset=utf-8";
  }
}

export function artifactRoutes(router) {
  router.get("/artifacts", async (req, res) => {
    const artifacts = await listArtifactsRecursive(ARTIFACTS_DIR).catch(() => []);
    sendJson(res, { root: ARTIFACTS_DIR, artifacts });
  });

  router.get("/artifacts/view/*", async (req, res) => {
    const relPath = req.params['*'];
    const fullPath = resolveArtifactPath(relPath);
    if (!fullPath) return sendError(res, 400, "Invalid artifact path");

    let info;
    try {
      info = await stat(fullPath);
    } catch {
      return sendError(res, 404, "Artifact not found");
    }

    if (info.size > MAX_INLINE_BYTES) {
      return sendJson(res, { error: "Artifact too large to preview", size: info.size }, 413);
    }

    const ext = extname(fullPath).toLowerCase();
    const kind = artifactKind(ext);
    if (!kind) return sendError(res, 400, "Unsupported artifact type");

    if (kind === "text") {
      const content = await readFile(fullPath, "utf-8");
      return sendJson(res, {
        path: relPath,
        kind,
        ext,
        size: info.size,
        modified: info.mtime.toISOString(),
        content,
      });
    }

    const buf = await readFile(fullPath);
    sendJson(res, {
      path: relPath,
      kind,
      ext,
      size: info.size,
      modified: info.mtime.toISOString(),
      mime: mimeType(ext),
      contentBase64: buf.toString("base64"),
    });
  });
}

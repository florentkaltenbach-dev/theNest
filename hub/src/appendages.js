// hub/src/appendages.js
//
// Loads + validates appendage contract files from /opt/nest/appendages/. Returns the merged catalog. Exports: loadAppendages(), validateAppendage(def). Depends: config/appendage-schema.json.

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEST_ROOT = join(__dirname, "../..");
const APPENDAGES_DIR = process.env.NEST_APPENDAGES_DIR || join(NEST_ROOT, "appendages");

// Hand-rolled validator for the small subset of JSON-Schema we use in
// appendage-schema.json. Avoids pulling in ajv just for this.
const NAME_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const IMAGE_RE = /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?(?:@sha256:[0-9a-f]{64})?$/;
const PORT_RE = /^\d{1,5}(?::\d{1,5})?(?:\/(?:tcp|udp))?$/;
const ROUTE_PATH_RE = /^\/[A-Za-z0-9/_-]*$/;
const SECRET_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
const VALID_CATEGORIES = new Set(["service", "tooling", "model", "custom"]);

/**
 * Validate an appendage definition object. Returns array of error strings (empty = valid).
 * @param {Object} def
 * @returns {string[]}
 */
export function validateAppendage(def) {
  const errs = [];
  if (!def || typeof def !== "object") return ["not an object"];

  if (typeof def.name !== "string" || !NAME_RE.test(def.name)) errs.push("name: must be lowercase kebab-case");
  if (typeof def.version !== "string" || !VERSION_RE.test(def.version)) errs.push("version: must be semver");
  if (typeof def.description !== "string" || def.description.length === 0 || def.description.length > 200) {
    errs.push("description: 1..200 chars required");
  }
  if (!VALID_CATEGORIES.has(def.category)) errs.push(`category: must be one of ${[...VALID_CATEGORIES].join("|")}`);

  // Exactly one of `container`, `compose`, or `discovery` is required.
  const hasContainer = !!def.container;
  const hasCompose = !!def.compose;
  const hasDiscovery = !!def.discovery;
  const branchCount = [hasContainer, hasCompose, hasDiscovery].filter(Boolean).length;
  if (branchCount !== 1) {
    errs.push("must have exactly one of `container`, `compose`, or `discovery`");
  }

  if (hasDiscovery) {
    if (typeof def.discovery !== "object") {
      errs.push("discovery: must be an object");
    } else {
      if (typeof def.discovery.host !== "string" || def.discovery.host.length === 0) {
        errs.push("discovery.host: required string");
      }
      if (!def.discovery.containers || typeof def.discovery.containers !== "object") {
        errs.push("discovery.containers: required object");
      } else {
        const ma = def.discovery.containers.match_any;
        if (!Array.isArray(ma) || ma.length === 0) errs.push("discovery.containers.match_any: required non-empty array");
        else for (const p of ma) {
          if (typeof p !== "string") errs.push("discovery.containers.match_any: entries must be strings");
          else { try { new RegExp(p); } catch (e) { errs.push(`discovery.containers.match_any: bad regex "${p}"`); } }
        }
      }
    }
  }

  if (hasContainer) {
    if (typeof def.container !== "object") {
      errs.push("container: must be an object");
    } else {
      if (typeof def.container.image !== "string" || !IMAGE_RE.test(def.container.image)) {
        errs.push("container.image: invalid image reference");
      }
      if (def.container.ports && !Array.isArray(def.container.ports)) errs.push("container.ports: must be array");
      if (Array.isArray(def.container.ports)) {
        for (const p of def.container.ports) if (!PORT_RE.test(p)) errs.push(`container.ports: bad entry "${p}"`);
      }
      if (def.container.volumes && !Array.isArray(def.container.volumes)) errs.push("container.volumes: must be array");
      if (def.container.env_from_secrets && !Array.isArray(def.container.env_from_secrets)) {
        errs.push("container.env_from_secrets: must be array");
      }
      if (Array.isArray(def.container.env_from_secrets)) {
        for (const k of def.container.env_from_secrets) if (!SECRET_KEY_RE.test(k)) errs.push(`env_from_secrets: bad key "${k}"`);
      }
      if (def.container.env !== undefined) {
        if (typeof def.container.env !== "object" || Array.isArray(def.container.env)) errs.push("container.env: must be object");
        else for (const k of Object.keys(def.container.env)) {
          if (!SECRET_KEY_RE.test(k)) errs.push(`container.env: bad key "${k}"`);
        }
      }
    }
  }

  if (hasCompose) {
    if (typeof def.compose !== "object") {
      errs.push("compose: must be an object");
    } else {
      const hasGit = typeof def.compose.git === "string" && def.compose.git.length > 0;
      const hasInline = typeof def.compose.inline === "string" && def.compose.inline.length > 0;
      if (hasGit === hasInline) errs.push("compose: must have exactly one of `git` or `inline`");
      if (def.compose.branch !== undefined && typeof def.compose.branch !== "string") errs.push("compose.branch: must be string");
      if (def.compose.file !== undefined && typeof def.compose.file !== "string") errs.push("compose.file: must be string");
      if (def.compose.init_script !== undefined && typeof def.compose.init_script !== "string") errs.push("compose.init_script: must be string");
      if (def.compose.env !== undefined) {
        if (typeof def.compose.env !== "object" || Array.isArray(def.compose.env)) errs.push("compose.env: must be object");
        else for (const k of Object.keys(def.compose.env)) {
          if (!SECRET_KEY_RE.test(k)) errs.push(`compose.env: bad key "${k}"`);
        }
      }
    }
  }

  if (def.routes !== undefined) {
    if (!Array.isArray(def.routes)) errs.push("routes: must be array");
    else for (const r of def.routes) {
      if (typeof r?.path !== "string" || !ROUTE_PATH_RE.test(r.path)) errs.push(`routes.path: bad "${r?.path}"`);
      if (!Number.isInteger(r?.port) || r.port < 1 || r.port > 65535) errs.push(`routes.port: bad "${r?.port}"`);
    }
  }

  if (def.requirements !== undefined) {
    const r = def.requirements;
    if (r.min_ram_mb !== undefined && (!Number.isInteger(r.min_ram_mb) || r.min_ram_mb < 64)) errs.push("requirements.min_ram_mb: int >= 64");
    if (r.min_cpu_cores !== undefined && (typeof r.min_cpu_cores !== "number" || r.min_cpu_cores < 0.1)) errs.push("requirements.min_cpu_cores: number >= 0.1");
    if (r.min_disk_mb !== undefined && (!Number.isInteger(r.min_disk_mb) || r.min_disk_mb < 64)) errs.push("requirements.min_disk_mb: int >= 64");
  }

  return errs;
}

/**
 * Read all *.json appendage files from APPENDAGES_DIR. Validates each;
 * invalid definitions are returned with their errors (still listed so the UI
 * can show what's broken instead of silently dropping them).
 * @returns {{ definitions: Object[], invalid: { file: string, errors: string[] }[] }}
 */
export function loadAppendages() {
  if (!existsSync(APPENDAGES_DIR)) return { definitions: [], invalid: [] };
  const definitions = [];
  const invalid = [];
  for (const f of readdirSync(APPENDAGES_DIR)) {
    if (extname(f) !== ".json") continue;
    const path = join(APPENDAGES_DIR, f);
    try {
      const raw = readFileSync(path, "utf-8");
      const def = JSON.parse(raw);
      const errs = validateAppendage(def);
      if (errs.length > 0) invalid.push({ file: f, errors: errs });
      else definitions.push(def);
    } catch (e) {
      invalid.push({ file: f, errors: [`parse error: ${e.message}`] });
    }
  }
  return { definitions, invalid };
}

/**
 * Convert a validated appendage definition into the legacy catalog shape used
 * by the agent's install commands. Returns a hint object that includes the
 * delivery mode so the route handler picks the right WS command.
 * @param {Object} def
 * @returns {{ id: string, name: string, description: string, category: string, mode: string, image?: string, ports?: Object<string,string>, volumes?: string[], env?: Object, compose?: Object, minRamMb: number, minCpuCores: number, routes: any[] }}
 */
export function toLegacyCatalogEntry(def) {
  if (def.discovery) {
    return {
      id: def.name,
      name: def.name,
      description: def.description,
      category: def.category,
      mode: "discovery",
      discovery: def.discovery,
      minRamMb: def.requirements?.min_ram_mb ?? null,
      minCpuCores: def.requirements?.min_cpu_cores ?? null,
      routes: def.routes || [],
    };
  }
  if (def.compose) {
    return {
      id: def.name,
      name: def.name,
      description: def.description,
      category: def.category,
      mode: "compose",
      compose: def.compose,
      env: def.compose.env || {},
      minRamMb: def.requirements?.min_ram_mb ?? null,
      minCpuCores: def.requirements?.min_cpu_cores ?? null,
      routes: def.routes || [],
    };
  }
  const ports = {};
  for (const p of def.container?.ports || []) {
    // Docker compose syntax "HOST:CONTAINER" (HOST on the left). docker-py
    // wants { "<containerPort>/<proto>": <hostPort> }. Strip an optional
    // /tcp|/udp suffix from the container side; default to tcp.
    const parts = p.split(":");
    let host, container;
    if (parts.length === 1) {
      host = container = parts[0];
    } else {
      host = parts[0];
      container = parts[1];
    }
    let proto = "tcp";
    const slash = container.indexOf("/");
    if (slash >= 0) {
      proto = container.slice(slash + 1);
      container = container.slice(0, slash);
    }
    ports[`${container}/${proto}`] = host;
  }
  return {
    id: def.name,
    name: def.name,
    description: def.description,
    category: def.category,
    mode: "container",
    image: def.container.image,
    ports,
    volumes: def.container?.volumes || [],
    env: def.container?.env || {},
    minRamMb: def.requirements?.min_ram_mb ?? null,
    minCpuCores: def.requirements?.min_cpu_cores ?? null,
    routes: def.routes || [],
  };
}

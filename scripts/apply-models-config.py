#!/usr/bin/env python3
# scripts/apply-models-config.py
#
# Propagates config/models.yaml (the single source of truth for AI model
# selection) into each tool's native config: the codex CLI (~/.codex/config.toml)
# and openclaw (~/.openclaw/openclaw.json). Idempotent — it rewrites only the
# model fields it owns and leaves every other setting untouched. Backs up each
# file before changing it. Pass --dry-run to preview without writing.
#
# Depends: PyYAML (same as apply-linear-config.py). No other deps.

import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_YAML = os.path.join(ROOT, "config", "models.yaml")
CODEX_TOML = os.path.expanduser("~/.codex/config.toml")
OPENCLAW_JSON = os.path.expanduser("~/.openclaw/openclaw.json")
OPENCLAW_PREFIX = "openai/"  # openclaw namespaces models as openai/<id>


def load_models():
    """Read config/models.yaml. @returns {codex_model, claude_cap_label}."""
    with open(MODELS_YAML) as fh:
        data = yaml.safe_load(fh)
    if not data.get("codex_model"):
        sys.exit("models.yaml: codex_model is required")
    return data


def backup(path):
    """Copy path → path.bak-models-<utc> so a change is always reversible."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dst = f"{path}.bak-models-{stamp}"
    shutil.copy2(path, dst)
    return dst


def plan_codex(model):
    """Compute the new ~/.codex/config.toml text. @returns (new_text, changed)."""
    with open(CODEX_TOML) as fh:
        lines = fh.read().splitlines(keepends=True)
    want = f'model = "{model}"\n'
    out, replaced = [], False
    for line in lines:
        # Only touch a top-level `model =` (before the first [section]); a
        # `model` key inside a [table] would start with leading space or follow
        # a section header — we stop replacing once we hit any [section].
        if not replaced and re.match(r"^\s*model\s*=", line) and not _in_section(out):
            out.append(want)
            replaced = True
        else:
            out.append(line)
    if not replaced:
        # Insert as a top-level key before the first [section] (or at top).
        idx = next((i for i, l in enumerate(out) if l.lstrip().startswith("[")), 0)
        out.insert(idx, want)
    new_text = "".join(out)
    with open(CODEX_TOML) as fh:
        return new_text, new_text != fh.read()


def _in_section(emitted):
    """True if a [section] header has already been emitted (so we're past the
    top-level key region)."""
    return any(l.lstrip().startswith("[") for l in emitted)


def plan_openclaw(model):
    """Compute the new openclaw.json object. @returns (obj, changed, removed)."""
    with open(OPENCLAW_JSON) as fh:
        original = fh.read()
    obj = json.loads(original)
    defaults = obj.setdefault("agents", {}).setdefault("defaults", {})
    full = f"{OPENCLAW_PREFIX}{model}"
    old_models = defaults.get("models", {}) or {}
    removed = [m for m in old_models if m != full]
    defaults["model"] = {"primary": full}
    defaults["models"] = {full: {"agentRuntime": {"id": "codex"}}}
    new_text = json.dumps(obj, indent=2) + "\n"
    return obj, new_text, new_text != original, removed


def main():
    ap = argparse.ArgumentParser(description="Apply config/models.yaml to codex + openclaw.")
    ap.add_argument("--dry-run", action="store_true", help="Preview without writing.")
    args = ap.parse_args()

    cfg = load_models()
    model = cfg["codex_model"]
    print(f"source of truth: codex_model = {model}")

    # --- codex CLI ---
    codex_text, codex_changed = plan_codex(model)
    if codex_changed:
        print(f"  codex   {CODEX_TOML}: set model = \"{model}\"")
        if not args.dry_run:
            print(f"          backup → {backup(CODEX_TOML)}")
            with open(CODEX_TOML, "w") as fh:
                fh.write(codex_text)
    else:
        print(f"  codex   unchanged (already {model})")

    # --- openclaw ---
    _, oc_text, oc_changed, removed = plan_openclaw(model)
    if oc_changed:
        full = f"{OPENCLAW_PREFIX}{model}"
        print(f"  openclaw {OPENCLAW_JSON}: primary → {full}")
        for r in removed:
            print(f"           dropped stale model entry: {r}")
        if not args.dry_run:
            print(f"           backup → {backup(OPENCLAW_JSON)}")
            with open(OPENCLAW_JSON, "w") as fh:
                fh.write(oc_text)
    else:
        print(f"  openclaw unchanged (already {OPENCLAW_PREFIX}{model})")

    if args.dry_run:
        print("\n(--dry-run — no changes written)")
    elif oc_changed:
        print("\nopenclaw.json changed — restart the gateway for it to take hold:")
        print("  openclaw gateway restart")
    return 0


if __name__ == "__main__":
    sys.exit(main())

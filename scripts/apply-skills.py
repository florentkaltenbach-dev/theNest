#!/usr/bin/env python3
"""
Synchronize Nest's canonical skills into agent-specific delivery wrappers.

Canonical skills live in /opt/nest/skills/<name>/SKILL.md. Claude Code receives
them through a local marketplace plugin whose skill entries are symlinks back to
the canonical directories.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / "skills"
CLAUDE_MARKETPLACE_DIR = ROOT / "integrations/claude/marketplace"
CLAUDE_PLUGIN_DIR = CLAUDE_MARKETPLACE_DIR / "plugins/nest-skills"
CLAUDE_PLUGIN_SKILLS_DIR = CLAUDE_PLUGIN_DIR / "skills"


def skill_dirs() -> list[Path]:
    if not SKILLS_DIR.exists():
        return []
    return sorted(
        path for path in SKILLS_DIR.iterdir()
        if path.is_dir() and (path / "SKILL.md").is_file()
    )


def require_frontmatter(skill: Path) -> None:
    text = (skill / "SKILL.md").read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise SystemExit(f"{skill}/SKILL.md is missing YAML frontmatter")
    frontmatter = text.split("---\n", 2)[1]
    for field in ("name:", "description:"):
        if field not in frontmatter:
            raise SystemExit(f"{skill}/SKILL.md frontmatter is missing {field}")


def sync_claude_symlinks() -> list[str]:
    CLAUDE_PLUGIN_SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    expected = {skill.name: skill for skill in skill_dirs()}

    for skill in expected.values():
        require_frontmatter(skill)

    for child in CLAUDE_PLUGIN_SKILLS_DIR.iterdir():
        if child.name not in expected:
            if child.is_symlink() or child.is_file():
                child.unlink()
            elif child.is_dir():
                raise SystemExit(f"Refusing to remove non-symlink directory: {child}")

    changed = []
    for name, target in expected.items():
        link = CLAUDE_PLUGIN_SKILLS_DIR / name
        if link.is_symlink() and link.resolve() == target.resolve():
            continue
        if link.exists() or link.is_symlink():
            if link.is_dir() and not link.is_symlink():
                raise SystemExit(f"Refusing to replace non-symlink directory: {link}")
            link.unlink()
        relative_target = Path("../../../../../../skills") / name
        link.symlink_to(relative_target)
        if not (link / "SKILL.md").is_file():
            raise SystemExit(f"Created broken Claude skill link: {link} -> {relative_target}")
        changed.append(name)
    return changed


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=False, text=True, capture_output=True)


def validate_with_claude() -> None:
    if not shutil.which("claude"):
        print("claude not found; skipped Claude plugin validation", file=sys.stderr)
        return
    result = run(["claude", "plugin", "validate", str(CLAUDE_PLUGIN_DIR)])
    if result.returncode != 0:
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode)
    print(result.stdout.strip())


def install_claude_plugin() -> None:
    if not shutil.which("claude"):
        raise SystemExit("claude not found; cannot install Claude plugin")

    known = Path.home() / ".claude/plugins/known_marketplaces.json"
    marketplace_known = False
    if known.exists():
        data = json.loads(known.read_text(encoding="utf-8"))
        marketplace_known = data.get("nest-local", {}).get("installLocation") == str(CLAUDE_MARKETPLACE_DIR)

    if not marketplace_known:
        result = run(["claude", "plugin", "marketplace", "add", str(CLAUDE_MARKETPLACE_DIR)])
        if result.returncode != 0 and "already exists" not in (result.stdout + result.stderr):
            sys.stderr.write(result.stdout)
            sys.stderr.write(result.stderr)
            raise SystemExit(result.returncode)
        print(result.stdout.strip())

    result = run(["claude", "plugin", "install", "nest-skills@nest-local", "--scope", "user"])
    if result.returncode != 0 and "already installed" not in (result.stdout + result.stderr):
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode)
    print(result.stdout.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply Nest skills to supported agent wrappers.")
    parser.add_argument("--install-claude", action="store_true", help="register the local Claude marketplace and install nest-skills")
    parser.add_argument("--no-validate", action="store_true", help="skip Claude plugin validation")
    args = parser.parse_args()

    changed = sync_claude_symlinks()
    print(f"Synced {len(skill_dirs())} Claude skill link(s).")
    if changed:
        print("Updated links: " + ", ".join(changed))

    if not args.no_validate:
        validate_with_claude()

    if args.install_claude:
        install_claude_plugin()


if __name__ == "__main__":
    main()

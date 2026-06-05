"""Discover services on the server: git repos, Docker, systemd, listening ports."""

import json
import os
import re
import subprocess


SCAN_DIRS = ["/opt", "/home/claude", "/srv"]
MAX_DEPTH = 3


def find_git_repos() -> list[dict]:
    """Scan known directories for git repositories."""
    repos = []
    seen = set()

    for scan_dir in SCAN_DIRS:
        if not os.path.isdir(scan_dir):
            continue
        _walk_for_git(scan_dir, 0, repos, seen)

    return repos


def _walk_for_git(path: str, depth: int, repos: list, seen: set):
    """Recursively find .git directories up to MAX_DEPTH."""
    if depth > MAX_DEPTH:
        return
    try:
        entries = os.listdir(path)
    except PermissionError:
        return

    if ".git" in entries:
        real = os.path.realpath(path)
        if real in seen:
            return
        seen.add(real)
        repos.append(_repo_info(path))
        return  # Don't recurse into git repos

    for entry in entries:
        full = os.path.join(path, entry)
        if os.path.isdir(full) and not entry.startswith("."):
            _walk_for_git(full, depth + 1, repos, seen)


def _repo_info(path: str) -> dict:
    """Extract metadata from a git repository."""
    def git(*args):
        try:
            result = subprocess.run(
                ["git", "-C", path] + list(args),
                capture_output=True, text=True, timeout=5,
            )
            return result.stdout.strip() if result.returncode == 0 else ""
        except Exception:
            return ""

    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    commit = git("rev-parse", "--short", "HEAD")
    commit_msg = git("log", "-1", "--format=%s")
    remote_url = git("remote", "get-url", "origin")
    dirty = git("status", "--porcelain") != ""

    # Extract GitHub owner/repo from remote URL
    github = ""
    if remote_url:
        for prefix in ["https://github.com/", "git@github.com:"]:
            if remote_url.startswith(prefix):
                github = remote_url[len(prefix):].removesuffix(".git")
                break

    return {
        "name": os.path.basename(path),
        "path": path,
        "branch": branch,
        "commit": commit,
        "commitMessage": commit_msg,
        "remoteUrl": remote_url,
        "github": github,
        "dirty": dirty,
    }


def _run(cmd: list[str]) -> str:
    """Run a discovery command, returning stdout or "" on any failure."""
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return result.stdout if result.returncode == 0 else ""
    except (FileNotFoundError, subprocess.SubprocessError, OSError):
        return ""


def _parse_docker_ps(output: str) -> list[dict]:
    """Parse `docker ps --format '{{json .}}'` (one JSON object per line)."""
    containers = []
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except (ValueError, json.JSONDecodeError):
            continue
        containers.append({
            "id": (obj.get("ID") or "")[:12],
            "name": obj.get("Names", ""),
            "image": obj.get("Image", ""),
            "state": obj.get("State", ""),
            "status": obj.get("Status", ""),
            "ports": obj.get("Ports", ""),
        })
    return containers


def discover_docker() -> list[dict]:
    """List Docker containers via the docker CLI."""
    return _parse_docker_ps(
        _run(["docker", "ps", "--all", "--no-trunc", "--format", "{{json .}}"])
    )


def _parse_systemd_units(output: str) -> list[dict]:
    """Parse `systemctl list-units --plain --no-legend` service rows."""
    units = []
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        # Failed units are prefixed with a status bullet (●) — drop it.
        if line[0] in ("●", "*"):
            line = line[1:].strip()
        parts = line.split(None, 4)
        if len(parts) < 4:
            continue
        units.append({
            "unit": parts[0],
            "load": parts[1],
            "active": parts[2],
            "sub": parts[3],
            "description": parts[4] if len(parts) > 4 else "",
        })
    return units


def discover_systemd() -> list[dict]:
    """List systemd service units via systemctl."""
    return _parse_systemd_units(_run([
        "systemctl", "list-units", "--type=service",
        "--all", "--no-legend", "--plain", "--no-pager",
    ]))


_PROC_RE = re.compile(r'\(\("([^"]+)",pid=(\d+)')


def _parse_listening_ports(output: str) -> list[dict]:
    """Parse `ss -H -tlnp` rows into {address, port, process, pid}."""
    ports = []
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        addr, sep, port_s = parts[3].rpartition(":")
        if not sep:
            continue
        try:
            port = int(port_s)
        except ValueError:
            continue
        m = _PROC_RE.search(line)
        ports.append({
            "address": addr,
            "port": port,
            "protocol": "tcp",
            "process": m.group(1) if m else "",
            "pid": int(m.group(2)) if m else None,
        })
    return ports


def discover_listening_ports() -> list[dict]:
    """List TCP listening sockets via ss."""
    return _parse_listening_ports(_run(["ss", "-H", "-tlnp"]))


def discover_all() -> dict:
    """Discover all service categories, keyed by stable category name."""
    return {
        "repos": find_git_repos(),
        "docker": discover_docker(),
        "systemd": discover_systemd(),
        "ports": discover_listening_ports(),
    }

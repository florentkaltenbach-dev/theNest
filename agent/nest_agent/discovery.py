"""Discover git repositories on the server."""

import os
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

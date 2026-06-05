# agent/nest_agent/git.py
#
# Git discovery for the agent. Scans search roots for repositories and
# reports each repo's branch (or detached HEAD) and recent commits.
# Public API: discover_git_repos(), inspect_repo(). No shell, no deps.

"""Discover Git repositories on the server and report branch + recent commits.

Designed to be imported by Nest consumers (future hub routes, diagnostics)
without depending on the hub implementation. Every record carries an explicit
``status`` so callers can distinguish healthy repos from empty repos, detached
HEADs, and unreadable/broken checkouts without inspecting exceptions.
"""

import os
import subprocess

# Default directories scanned when no explicit roots are supplied.
SCAN_ROOTS = ["/opt", "/home/claude", "/srv"]
MAX_DEPTH = 3
MAX_COMMITS = 10
_GIT_TIMEOUT = 5

# Field/record separators for parsing `git log` output safely. ASCII unit
# separator (0x1f) between fields, record separator (0x1e) between commits;
# neither can appear in a commit subject/author/date.
_FIELD = "\x1f"
_RECORD = "\x1e"


def discover_git_repos(roots=None, max_depth=MAX_DEPTH, max_commits=MAX_COMMITS):
    """Scan ``roots`` for Git repositories and return one record per repo.

    :param roots: directories to search; defaults to :data:`SCAN_ROOTS`.
    :param max_depth: how deep to recurse below each root looking for ``.git``.
    :param max_commits: number of recent commits to include per repo.
    :returns: list of repo records (see :func:`inspect_repo`), sorted by path.
    """
    if roots is None:
        roots = SCAN_ROOTS

    records = []
    seen = set()
    for root in roots:
        if not os.path.isdir(root):
            continue
        for path in _find_repos(root, 0, max_depth, seen):
            records.append(inspect_repo(path, max_commits=max_commits))

    records.sort(key=lambda r: r["path"])
    return records


def _find_repos(path, depth, max_depth, seen):
    """Yield repository working-tree paths found under ``path``.

    Skips non-Git directories, does not recurse into a repo once found, and
    silently skips directories it cannot read.
    """
    if depth > max_depth:
        return
    try:
        entries = os.listdir(path)
    except (PermissionError, FileNotFoundError, NotADirectoryError, OSError):
        return

    if ".git" in entries:
        real = os.path.realpath(path)
        if real in seen:
            return
        seen.add(real)
        yield path
        return  # A repo's subdirectories are part of the same repo.

    for entry in entries:
        if entry.startswith("."):
            continue
        full = os.path.join(path, entry)
        if os.path.isdir(full):
            yield from _find_repos(full, depth + 1, max_depth, seen)


def inspect_repo(path, max_commits=MAX_COMMITS):
    """Return a structured record for the repository rooted at ``path``.

    The record always contains ``path``, ``name``, ``branch``, ``detached``,
    ``head``, ``commits``, ``status`` and ``error``. ``status`` is one of:

    - ``"ok"``       — branch and/or commits resolved normally.
    - ``"empty"``    — a valid repo with no commits yet (unborn HEAD).
    - ``"detached"`` — HEAD points directly at a commit, no current branch.
    - ``"error"``    — not a Git repo or Git could not read it; see ``error``.

    Empty repos, detached HEADs and unreadable paths never raise.
    """
    record = {
        "path": path,
        "name": os.path.basename(os.path.normpath(path)),
        "branch": None,
        "detached": False,
        "head": None,
        "commits": [],
        "status": "ok",
        "error": None,
    }

    inside, err = _git(path, "rev-parse", "--is-inside-work-tree")
    if inside.strip() != "true":
        record["status"] = "error"
        record["error"] = err.strip() or "not a git repository"
        return record

    # Current branch. On an unborn or detached HEAD symbolic-ref fails.
    branch, _ = _git(path, "symbolic-ref", "--quiet", "--short", "HEAD")
    branch = branch.strip()
    if branch:
        record["branch"] = branch

    # Short HEAD sha; absent on a repo with no commits.
    head, _ = _git(path, "rev-parse", "--short", "HEAD")
    head = head.strip()
    if head:
        record["head"] = head
        if not branch:
            record["detached"] = True
            record["status"] = "detached"
    else:
        # No resolvable HEAD commit → unborn branch (empty repo).
        record["status"] = "empty"
        record["error"] = "repository has no commits"
        return record

    record["commits"] = _recent_commits(path, max_commits)
    return record


def _recent_commits(path, max_commits):
    """Return up to ``max_commits`` recent commits as structured dicts."""
    fmt = _FIELD.join(["%H", "%s", "%an", "%aI"]) + _RECORD
    out, _ = _git(
        path, "log", "-z",
        "--max-count", str(max_commits),
        "--pretty=format:" + fmt,
    )
    commits = []
    for raw in out.split(_RECORD):
        raw = raw.strip("\x00\n")
        if not raw:
            continue
        fields = raw.split(_FIELD)
        if len(fields) != 4:
            continue
        sha, subject, author, date = fields
        commits.append({
            "sha": sha,
            "subject": subject,
            "author": author,
            "date": date,
        })
    return commits


def _git(path, *args):
    """Run ``git -C path <args>``; return ``(stdout, stderr)`` strings.

    Never raises: on timeout or a missing ``git`` binary returns empty stdout
    and a descriptive stderr so callers can surface an explicit error field.
    """
    try:
        result = subprocess.run(
            ["git", "-C", path, *args],
            capture_output=True, text=True, timeout=_GIT_TIMEOUT,
        )
        return result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return "", "git timed out"
    except FileNotFoundError:
        return "", "git executable not found"
    except OSError as exc:
        return "", str(exc)

# ADR-002: Nest skill delivery

> **Status:** accepted 2026-05-21 for Claude Code; other scaffolds pending verification.
> **Context:** AI-45. C5-C8 need a concrete way for Nest-owned skills to reach diverse agent scaffolds without resurrecting the cancelled chat router.

## Decision

Canonical skills live in:

```text
/opt/nest/skills/<name>/SKILL.md
```

The canonical schema is Claude-style:

- `name` frontmatter field, required
- `description` frontmatter field, required and written as the trigger contract
- Markdown body with executable instructions
- Optional bundled files beside `SKILL.md` as needed

Claude Code receives Nest skills through a local wrapper plugin:

```text
integrations/claude/marketplace/
  .claude-plugin/marketplace.json
  plugins/nest-skills/
    .claude-plugin/plugin.json
    skills/<name> -> /opt/nest/skills/<name>
```

`scripts/apply-skills.py` keeps the wrapper's `skills/` entries symlinked to the canonical skill directories and validates the plugin with Claude Code.

## Why A Wrapper

A direct symlink into `~/.claude/skills` works, but it mixes Nest-owned delivery with ad-hoc user skills. The wrapper plugin gives Claude Code a named inventory (`nest-skills`) while preserving a single canonical source in `/opt/nest/skills`.

Generated copies are deferred. They are only for runtimes that cannot follow symlinks or require scaffold-specific packaging. Copies need drift checks, headers, and cleanup rules; symlinks avoid that cost for Claude Code.

## Verified Behavior

Verified locally on Claude Code `2.1.146`:

- Claude scans `/home/claude/.claude/skills` for direct user skills.
- Claude plugin skills use `skills/<name>/SKILL.md`.
- Required skill frontmatter is `name` and `description`.
- `claude plugin validate` follows a symlinked skill directory.
- Launching with `--plugin-dir <wrapper>` loaded `nest-skills:server-overview`.
- A local marketplace can be added from disk and `nest-skills@nest-local` installs at user scope.

## Scaffold Positions

Claude Code: accepted. Use the wrapper plugin above.

Codex CLI: pending verification. It has a `~/.codex/skills/` tree, but compatibility with Claude-style frontmatter and symlinked directories must be tested before delivery is promised.

OpenClaw: pending verification. OpenClaw currently exposes a plugin catalog, not arbitrary user-written SKILL.md directories as a first-class delivery surface. Wrap only if its catalog can preserve canonical-skill semantics cleanly.

Hermes: deferred until its skill mechanism is known.

## Apply

Refresh wrapper links and validate:

```sh
scripts/apply-skills.py
```

Install for Claude Code user sessions:

```sh
scripts/apply-skills.py --install-claude
```

## Consequences

- C5 can now exercise `server-overview` through Claude Code without waiting on a Nest-wide dispatcher.
- C6-C8 should use the same canonical skill schema once specified.
- Any future scaffold delivery must either symlink to `/opt/nest/skills/<name>` or document why it needs generated copies.

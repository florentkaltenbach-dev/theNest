# DESIGN.md — Nest Design Tokens

> The shared vocabulary for every page in `hub/static/`. Vanilla HTML5, no build step — pages inline what they use. This file exists so a new page matches the rest without guessing.

Extracted 2026-04-23 from current pages. If you see a value here that's wrong or missing, fix it in the file where you notice the drift and update this doc in the same commit.

## Palette

| Token | Value | Use |
|-------|------:|-----|
| `--ink` | `#1a1a2e` | Primary text, top-bar background |
| `--ink-hover` | `#2a2a4a` | Hover fills on dark surfaces |
| `--ink-pressed` | `#16162a` | Active/pressed on dark surfaces |
| `--paper` | `#f5f5f5` | Page background |
| `--surface` | `#ffffff` | Cards, panels |
| `--border` | `#e5e7eb` | Default surface borders |
| `--border-soft` | `#f0f0f0` | Dividers within cards |
| `--muted` | `#6b7280` | Secondary text |
| `--muted-dim` | `#8b8fa3` | Dim nav links on dark bg |
| `--muted-subtle` | `#777` | Captions, labels |
| `--accent-blue` | `#3b82f6` | POST, info |
| `--accent-sky` | `#7eb8ff` | Links, highlights |
| `--ok` | `#22c55e` | GET, success |
| `--warn` | `#f59e0b` | PUT/PATCH, warnings |
| `--danger` | `#ef4444` | DELETE, errors |
| `--danger-strong` | `#b91c1c` | Error text |

## Method badges

Used by `/routes` and future API-surface UI.

| Method | Color |
|--------|------:|
| GET | `#22c55e` |
| POST | `#3b82f6` |
| PUT / PATCH | `#f59e0b` |
| DELETE | `#ef4444` |
| HEAD | `#6366f1` |
| WS | `#8b5cf6` |

## Typography

- Base: `14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Monospace: `ui-monospace, SFMono-Regular, Menlo, monospace`
- Uppercase section labels: `text-transform:uppercase; letter-spacing:0.5px; font-weight:700; color:var(--muted)`

## Spacing

- Card padding: `14px`
- Row padding: `8px 10px`
- Page max-width: `960px` (detail pages can go to `1040px`)
- Grid gap: `12px` between cards, `8px` within toolbars

## Shapes

- Card border-radius: `10px`
- Button/badge border-radius: `6px`
- Thin bars / progress fills: `3px`

## Patterns

- **Top nav.** Dark `--ink` band, `.nav a` uses `--muted-dim`, active link flips to `#fff`.
- **Card.** White on `--paper`, `1px solid --border`, radius `10px`, padding `14px`.
- **Section header inside card.** Uppercase 11–12px, `--muted`, margin-bottom `10px`.
- **Table row.** `8px 10px` padding, `1px solid --border-soft` bottom border, last-child has no bottom border.
- **Numeric cells.** `text-align:right; font-variant-numeric:tabular-nums`.
- **Auth gate.** `const t = localStorage.getItem("nest_token"); if (!t) location.href = "/login";` — every protected page starts with this.

## Don't

- Don't import a CSS file. Pages are self-contained. If a token is worth sharing, copy it inline.
- Don't introduce a new shade when an existing token is close enough. Drift here makes the whole surface look cheaper.
- Don't add emoji to UI unless the user explicitly asks.

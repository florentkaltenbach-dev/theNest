# mathviz — Appendage Spec

> ManimCE-based 3D math visualization appendage with a web UI to browse and
> create renders. This document is the implementation-ready spec: it fixes
> scope, the Nest integration shape, and the open risks so a future engineer
> can cut follow-up tickets without re-deriving the design.

## Status

**Deferred.** This is a written spec only — no code, container image, or
appendage definition ships with ticket AI-51. The acceptance criterion for
AI-51 is *this document*, not a working render. Implementation begins when a
follow-up sprint pulls the tickets sketched under [Follow-up tickets](#follow-up-tickets)
below. Until then mathviz remains a backlog appendage idea
(ROADMAP.md §"Backlog: appendage ideas").

## Scope

mathviz is a **tooling** appendage (`category: tooling`) that wraps a ManimCE
project in a long-running container and exposes, through the Hub, a web UI to:

- **browse** previously rendered 3D math scenes (a gallery of MP4 artifacts), and
- **create** new renders by choosing a function from a curated registry,
  setting parameters, submitting a render job, and watching it complete.

It is a *greenfield* appendage (`container:` contract — hub instructs an agent
to deploy it), not brownfield discovery. It is served behind the Hub's existing
auth, like every other Nest page.

### In Scope

- A `mathviz/` source tree in the repo (ManimCE project + a small render
  service) and a `mathviz/Dockerfile` that builds the container image.
- An `appendages/mathviz.json` contract validating against
  `config/appendage-schema.json` so it appears in `/api/appendages` and the
  `/appendages` page alongside nginx / uptime-kuma / etc.
- A **curated function registry** (saddle, gaussian, torus, divergence field,
  …): each entry names a renderable scene plus its tunable parameters.
- A web UI with exactly two surfaces — **Browse** (gallery) and **Create**
  (parameter form + progress + player) — in the vanilla Nest client style
  (no build step, no framework).
- An **async render-job flow**: submit returns a job id immediately; the job
  runs ManimCE out-of-band; the UI polls/streams status; the finished MP4
  artifact is served back for playback.
- A retention/storage story for rendered MP4 artifacts (see
  [Open questions](#risks--open-questions)).

### Out of Scope

- **Free-form / arbitrary user expressions.** v1 renders only registry
  entries. Accepting arbitrary `f(x,y)` or LaTeX is explicitly deferred
  because it is a code-execution surface (see authoring safety below).
- **CLI-first delivery.** The original scaffold plan was CLI-first; the web UI
  supersedes that. A `mathviz render <name>` CLI may exist *inside* the
  container as an internal the web layer drives, but it is not a Nest surface.
- **Real-time / interactive 3D in the browser** (WebGL, live orbit). v1 plays
  pre-rendered MP4s only.
- **Multi-server placement, autoscaling, GPU scheduling.** Single container on
  one host for v1.
- **Editing or versioning scenes from the UI.** The registry is code in the
  repo; changing it is a code change, not a UI action.

## Proposed Nest integration shape

```
Browser → Caddy (TLS) → Hub (/mathviz page + /api/mathviz/* routes, auth)
                          │
                          │  enqueue job / read status / fetch artifact
                          ▼
                    mathviz container (render service + ManimCE)
                          │  writes MP4s
                          ▼
                    media volume (rendered artifacts)
```

### Browser UI surfaces

One vanilla HTML5 page, `hub/static/mathviz.html`, registered via a row in
`HUB.md` section 2 (page table) — same as any other page. Two tabs/surfaces:

- **Browse** — gallery grid of rendered scenes. Each tile = thumbnail/title +
  inline `<video>` player for the MP4 artifact. Backed by a "list artifacts"
  API call.
- **Create** — form driven by the function registry: pick a registry entry,
  then set its declared parameters (e.g. x/y ranges, resolution/quality,
  colormap, orbit camera, title). Submit posts a render job; the page then
  shows live job status (queued → rendering → done/failed) and, on success,
  plays the resulting MP4.

### Hub-side responsibilities

A new route module `hub/src/routes/mathviz.js` exporting
`mathvizRoutes(router)` (per the CLAUDE.md "Adding an API route" recipe),
imported and wired in `index.js`. The Hub is the **only** thing the browser
talks to; it proxies/relays to the mathviz container on the internal network.
Responsibilities:

- Enforce auth (`req.user`) — the page and all `/api/mathviz/*` routes sit
  behind the Hub's existing middleware. Gate any expensive or unsafe action on
  role where appropriate (mirroring the admin-only pattern used elsewhere).
- Expose the **curated registry** to the client (read-only list of renderable
  functions + their parameter schemas) so the Create form can render fields.
- Accept render-job submissions, validate parameters against the registry's
  declared parameter schema *server-side* (never trust the client form), and
  forward to the container's render API.
- Surface **job status** and the list of finished **artifacts** to the client.
- Serve (or proxy) the MP4 artifact bytes for playback.

The container itself runs the render service (FastAPI or similar) + ManimCE and
owns the actual job execution and the media volume; the Hub never shells out to
Manim directly.

### Proposed API / render-job flow

A minimal `/api/mathviz/*` surface (final shape is a follow-up ticket; this is
the proposed contract):

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/mathviz/registry` | List curated functions + their parameter schemas (drives the Create form). |
| `GET` | `/api/mathviz/renders` | List rendered artifacts (drives the Browse gallery). |
| `POST` | `/api/mathviz/renders` | Submit a render job `{ fn, params }`; returns `{ jobId, status: "queued" }` immediately. |
| `GET` | `/api/mathviz/renders/:jobId` | Job status `queued \| rendering \| done \| failed` (+ artifact URL when done). |
| `GET` | `/api/mathviz/renders/:jobId/video` | The MP4 artifact (proxied from the container/media volume). |

Job lifecycle: **submit → queue → render (ManimCE, seconds-to-minutes) →
artifact written to media volume → done**. The flow is async by design because
Manim renders are slow; the browser polls `GET …/:jobId` (or a future
WebSocket/SSE upgrade) for progress. In-flight job state can live in an
in-memory map in the render service for v1 (mirroring the Hub's `runs` Map
pattern for scripts), with the artifact list reconstructed from the media
volume on restart.

### Appendage contract sketch

`appendages/mathviz.json` (greenfield `container:` contract). Indicative only:

```json
{
  "name": "mathviz",
  "version": "0.1.0",
  "description": "ManimCE 3D math visualizer — browse and create cinematic renders.",
  "category": "tooling",
  "requirements": { "min_ram_mb": 1024, "min_cpu_cores": 1, "min_disk_mb": 2048 },
  "container": {
    "image": "<registry>/mathviz:latest",
    "ports": ["8090:8090"],
    "volumes": ["/opt/nest/data/mathviz/media:/media"]
  },
  "routes": [{ "path": "/mathviz", "port": 8090 }],
  "apis": [{ "name": "render", "port": 8090, "description": "Render-job API consumed by the hub." }]
}
```

(Requirements numbers are guesses — Manim's real RAM/CPU/disk footprint at the
target quality must be measured during M1, see below.)

## Source tree (starting point)

The idea originated as a standalone ManimCE project. The internal layout below
is the starting point for the appendage's source tree; it is not the appendage
contract itself.

```
mathviz/
├── Dockerfile          # builds the appendage image (NEW vs. original sketch)
├── pyproject.toml
├── manim.cfg
├── src/mathviz/
│   ├── service.py      # render API (FastAPI or similar) the hub talks to
│   ├── scenes/         # MathVizScene base + ExplicitSurface, Parametric, VectorField, Contour
│   ├── components/     # axes, camera, colormap, labels
│   ├── library/        # function registry: register("saddle", lambda x,y: x**2 - y**2, ...)
│   └── cli.py          # internal: mathviz render <name> [--quality h] [...]
├── examples/           # 01_saddle, 02_gaussian, 03_torus, 04_divergence
└── tests/test_smoke.py # render at -ql, assert mp4 exists
```

Milestones from the original plan, in order (the web UI supersedes CLI-first
ordering — the gallery and Create form are the primary surface, the
CLI/registry are internals the web layer drives):

- **M1** Scaffold — saddle (`z = x² − y²`) renders end-to-end at `-ql`, served
  and played through the web UI. Curated registry of one, no parameters,
  single MP4. Everything else lands on top of this.
- **M2** Components — axes / colormap / orbit camera helpers.
- **M3** ExplicitSurfaceScene — `f(x,y)`, ranges, resolution, colormap.
- **M4** ParametricSurfaceScene — `(u,v) → (x,y,z)`; torus, Möbius, sphere.
- **M5** VectorField3DScene — arrow grid, optional streamlines.
- **M6** Function library + registry — `register(...)` pattern wired to the
  Create form's parameter schema.
- **M7** Polish — title cards, MathTex overlays, transitions, gallery thumbnails.

## Risks & open questions

These must be resolved (or consciously accepted) before implementation starts:

- **Runtime cost.** ManimCE renders are CPU- and time-heavy (seconds to
  minutes per scene) and the image + TeX/LaTeX toolchain is large. Open: target
  quality tier, per-render time budget, whether to cap concurrency to a single
  in-flight job, and the real RAM/CPU/disk requirements (the contract numbers
  above are placeholders to be measured at M1). This host is resource-shared —
  a runaway render must not starve the Hub.
- **Render isolation.** Renders run untrusted-ish code paths (Manim + TeX) and
  must not be able to wedge or crash the Hub. Open: per-job process/timeout
  isolation inside the container, resource limits (cgroup/ulimit), and a hard
  kill on overrun. The Hub must treat the render service as a separate failure
  domain reached over the network, never an in-process call.
- **Storage / retention.** Rendered MP4s accumulate on the media volume. Open:
  retention policy (keep-last-N? TTL? manual pin?), disk-pressure handling,
  whether artifacts are backed up (cf. the restic appendage) or treated as
  disposable cache, and artifact naming/dedup so identical params reuse a
  render.
- **Authoring safety.** The single biggest gate on free-form expressions:
  arbitrary user-supplied `f(x,y)` or LaTeX is remote code execution against
  the render container. v1 dodges this with a curated registry only. Open:
  if/when free-form is allowed, it needs sandboxing (restricted expression
  evaluator, no Python eval of raw input) **and** trusted-user-only gating —
  decide the threat model before building it.
- **Auth & exposure.** Served behind the Hub's auth (default). Open: is Browse
  world-readable to any logged-in user while Create is gated to admins, or is
  the whole appendage admin-only? Decide before wiring routes.
- **Build & registry reachability.** This host is IPv6-only; the mathviz image
  must build from an IPv6-reachable base and push to / pull from an
  IPv6-reachable registry (see AGENTS.md "route around" checklist). Confirm the
  ManimCE base image is reachable before committing to `image:`.

## Follow-up tickets

A future sprint can cut these directly from this spec without re-discovering
the design:

1. **mathviz/ scaffold + Dockerfile (M1):** saddle renders at `-ql`; smoke test
   asserts an MP4 exists. Measure real resource footprint.
2. **Render service API:** the `/render` job API (submit/status/artifact) the
   Hub consumes; in-memory job map; media-volume artifact listing.
3. **Hub routes:** `hub/src/routes/mathviz.js` per the proposed API table,
   behind auth, with server-side parameter validation against the registry.
4. **Client page:** `hub/static/mathviz.html` Browse + Create surfaces; add the
   `HUB.md` page-table row.
5. **Appendage contract:** `appendages/mathviz.json` validating against
   `config/appendage-schema.json`; verify it shows in `/api/appendages`.
6. **Registry expansion (M2–M6)** and **polish (M7)** as the function library
   grows.
7. **Retention + authoring-safety decisions** resolved into concrete policy
   before free-form expressions (if ever) are enabled.

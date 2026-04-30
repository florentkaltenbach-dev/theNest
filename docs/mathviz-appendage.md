# mathviz — Appendage Idea

> Captured idea, not yet scoped for a sprint. Pluggable appendage that
> renders cinematic 3D math visualizations (ManimCE) and exposes a web UI
> to browse and create them. Implementation details deferred to the
> coding agent that picks this up.

## Shape

- **Category:** tooling
- **Runtime:** long-running container (FastAPI or similar) wrapping a
  ManimCE project. Mounts a media volume for rendered MP4s.
- **UI:** plain HTML page in the Nest client style. Two surfaces:
  - **Browse** — gallery of previously rendered scenes
  - **Create** — pick a function from a curated registry, set parameters
    (ranges, resolution, colormap, orbit, title), submit, watch render
    progress, play the result
- **Catalog entry:** add to `hub/src/routes/appendages.js` so it shows up
  alongside nginx/uptime-kuma/etc. Image built from a `mathviz/`
  Dockerfile in the repo.

## Open decisions (for the implementing sprint)

- Curated registry vs. free-form expressions. Default: curated. Free-form
  needs sandboxing or trusted-user-only gating.
- Async render queue vs. synchronous request. Default: async with job ids
  — Manim renders take seconds to minutes.
- Auth: served behind the Hub's existing auth, or standalone with its
  own. Default: behind the Hub.
- Storage: how long to keep rendered MP4s, retention policy.

## Reference: original mathviz scaffold plan

The idea originated as a standalone ManimCE project. The internal layout
below is the starting point for the appendage's source tree; it is not
the appendage contract itself.

```
mathviz/
├── pyproject.toml
├── manim.cfg
├── src/mathviz/
│   ├── scenes/         # MathVizScene base + ExplicitSurface, Parametric, VectorField, Contour
│   ├── components/     # axes, camera, colormap, labels
│   ├── library/        # function registry: register("saddle", lambda x,y: x**2 - y**2, ...)
│   └── cli.py          # mathviz render <name> [--quality h] [...]
├── examples/           # 01_saddle, 02_gaussian, 03_torus, 04_divergence
└── tests/test_smoke.py # render at -ql, assert mp4 exists
```

Milestones from the original plan, in order:

- **M1** Scaffold — saddle (`z = x² − y²`) renders end-to-end at -ql
- **M2** Components — axes / colormap / orbit camera helpers
- **M3** ExplicitSurfaceScene — `f(x,y)`, ranges, resolution, colormap
- **M4** ParametricSurfaceScene — `(u,v) → (x,y,z)`; torus, Möbius, sphere
- **M5** VectorField3DScene — arrow grid, optional streamlines
- **M6** Function library + CLI — registry pattern, `mathviz render saddle`
- **M7** Polish — title cards, MathTex overlays, transitions, README gifs

The web UI requirement supersedes the CLI-first ordering: the gallery
and create form become the primary surface, with the CLI/registry as
internals the web layer drives.

## First commit

When the sprint starts, M1 still applies: get one saddle rendering
through the web UI before adding abstraction. Curated registry of one,
no parameters, single mp4 played in the browser. Everything else lands
on top of that.

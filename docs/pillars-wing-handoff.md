# Handoff: Reconstruct the Nest around its pillars

> Status: planning artifact. Do not implement yet. The next coding session
> picks this up and executes the steps below in order.
> Branch when implementing: `nest/pillars-wing` (per handoff convention).

## Goal of this handoff

Do not implement yet. Prepare the ground so the next coding session can move fast. This means: scaffold the new architectural skeleton, archive the superseded material, leave clear markers for what comes next. No soil changes beyond what's needed to make the new structure exist.

## The architecture, in one paragraph

The Nest is reorganized around three layers: **pillars** (pure TypeScript interfaces, the architectural truth), **soil** (the existing implementations under `hub/`, `agent/`, `scripts/`, `hub/static/`), and a new **roof** (`Nest.md`, rewritten). Pillars live in a new `/pillars/` wing at the repo root. Each pillar is a `.ts` file declaring an interface plus a typed meta constant. A `_dictionary.ts` defines the types every pillar's metadata must satisfy. A `_registry.ts` assembles all pillars and journeys into one compile-checked census. The wing imports nothing outside itself — it is closed under its own types.

## What to create

### 1. The wing: `/pillars/`

#### `/pillars/_dictionary.ts`

Type-only file. Imports nothing. Defines:

- `Inhabitant` union: `"operator" | "invited-user" | "ai-agent" | "appendage"`
- `PillarName` union: `"IProxy" | "IRepoSync" | "IScriptRunner" | "IServerProvider" | "IClawAdapter" | "INetwork" | "ISecretTransfer"`
- `JourneyName` union: `"operator-setup" | "invited-user-entry" | "ai-agent-registration" | "appendage-installation" | "idea-hatching" | "idea-fledging"`
- `Concurrency` union: `"exclusive" | "shared" | "parallel"`
- `Ordering` union: `"fifo" | "causal" | "none"`
- `MethodContract` type: `{ readonly concurrency: Concurrency; readonly scope: string }`
- `PillarMeta` type with fields: `role: string`, `invariants: readonly string[]`, `dependsOn: readonly PillarName[]`, `ordering: Ordering`, `methods: Readonly<Record<string, MethodContract>>`, `v1: { path: string; tech: string } | null`
- `JourneyMeta` type: `{ role: string; walker: Inhabitant; touches: readonly PillarName[] }`

> Note: `forbids` and `permits` are deliberately **not** fields. What is forbidden is what the interface does not expose. What is permitted is what is declared. **The shape is the contract.**

#### `/pillars/<Name>.ts` — seven stub files

For each of the seven pillars, create a file containing:

- The interface declaration (move/copy from `hub/src/interfaces/` and the old `Nest.md` §5).
- A meta constant typed as `const satisfies PillarMeta`, with `role`, `invariants`, `dependsOn`, `ordering`, `methods`, `v1` populated from the old `Nest.md` content.
- Each method in `methods` should declare its `concurrency` and `scope` thoughtfully — pick the safest reasonable default and add a `// TODO: review concurrency` comment where unsure.

The seven: `IProxy`, `IRepoSync`, `IScriptRunner`, `IServerProvider`, `IClawAdapter`, `INetwork`, `ISecretTransfer`.

#### `/pillars/_registry.ts`

Imports each pillar's meta. Exports:

```ts
export const PILLARS = { IProxy, IRepoSync, ... } as const satisfies Record<PillarName, PillarMeta>;
export const JOURNEYS = { "operator-setup": { ... }, ... } as const satisfies Record<JourneyName, JourneyMeta>;
export type UnquarriedPillars = Exclude<PillarName, keyof typeof PILLARS>;
export type UnwalkedJourneys  = Exclude<JourneyName, keyof typeof JOURNEYS>;
```

The `Exclude` types are compile-time witnesses of pillars/journeys named in the dictionary but not yet inscribed in the registry — **the supersetting gate**. This is intentional. Names may be reserved before stones are laid.

For the six journeys, populate `role`, `walker`, `touches` from the old `Nest.md` and from this handoff's notes below.

### 2. The new roof: `Nest.md`

Replace the existing `Nest.md` entirely. The new version is short — it points at the wing rather than restating it.

Sections, in order:

1. **What the nest is** — one paragraph: a self-knowing house for ideas to hatch, brooded by humans and diverse intelligences, fledged into the world.
2. **The metaphor** — pillar, soil, inhabitant, stone, journey, archive.
3. **The dictionary** — points at `/pillars/_dictionary.ts`.
4. **The pillars** — points at `/pillars/_registry.ts` and lists the seven names.
5. **The soil** — names `hub/src/`, `hub/static/`, `agent/`, `scripts/` and what each is.
6. **The inhabitants** — operator, invited user, AI agent, appendage; richer description deferred to prose.
7. **The journeys** — points at `/pillars/_registry.ts` and lists the six journey names with one line each.
8. **The conventions** — pillars touched only through declared shape; hub stores no secrets except SSH key; `ISecretTransfer` never on hub; no secrets in repo; pillars depend only on pillars; soil depends on pillars never on other soil's internals.
9. **Growth** — the rite of admission for new pillars and journeys.
10. **Archive** — points at `/archive/`.
11. **Glossary**.

The previous `Nest.md` sections about technology stack, dependency graph, security rules, etc., should be distilled into the new sections above where appropriate, not copied wholesale. Anything that's purely implementation detail belongs in soil files or prose, not the roof.

### 3. The archive: `/archive/`

Move (do not copy):

- The old `Nest.md` → `/archive/Nest.md.2026-04-30`
- Any file in the soil that the new structure supersedes — but only if you're certain. When in doubt, leave it in place and add a TODO. The archive is for things laid to rest, not things you're unsure about.

Add `/archive/README.md` stating: this directory is read-only; nothing in active use may reference these files; entries carry their original path and a date suffix.

### 4. Prose: `/prose/`

Create the directory with a single placeholder `/prose/README.md` explaining: prose is the wet connective tissue between the dry pillars; files here introduce, narrate, and connect; they are not parsed as contract; they exist to be read by inhabitants who need more than a signature to understand. Do not write any prose files yet — that's for the next session.

### 5. The two new journeys: `idea-hatching` and `idea-fledging`

These are not in the old `Nest.md`. They were added in the design conversation. They are core, not optional.

- **idea-hatching** — walker: any (this is a modeling problem; pick the most permissive `Inhabitant` value and leave a `// TODO: walker may need to be a union or a new type`). Role: "Partners convene under the roof to brood and conceive an idea." Touches: leave as `[]` for now and add a TODO — the touched pillars depend on what the brooding requires; this journey is shape-permissive by design.
- **idea-fledging** — walker: same modeling note. Role: "A conceived idea is equipped for first flight and released into the world." Touches: `["IRepoSync", "IProxy", "ISecretTransfer", "IClawAdapter"]`.

Flag in a top-level `TODO.md` (see below) that the `walker` field may need to evolve to accommodate journeys walked by combinations of inhabitants. Do not solve this now.

### 6. `TODO.md` at repo root

Create a file capturing what was deferred. Sections:

- **Pillar metadata gaps** — methods whose concurrency/scope were guessed and need review.
- **Walker generalization** — `idea-hatching` and `idea-fledging` may need a richer walker type.
- **Touches as sequence** — `JourneyMeta.touches` is currently a flat list; order is meant but not enforced. Future: consider whether journeys deserve a richer step shape.
- **Failure language** — pillars currently have no declared failure modes / errors field. Likely needed before the wing leaves childhood.
- **Audience for runtime registry** — when the Hub's self-knowledge API renders the wing, which fields are exposed to which inhabitants?
- **Inhabitants as their own dictionary?** — open question. Probably belongs in prose, not a wing of its own. Don't act yet.
- **Soil header conventions** — the new conventions reference "every soil file declares itself through a header." Audit existing soil for compliance in a future session.
- **Correspondence between fledged ideas and origin nests** — the swarm question. Future.

### 7. What NOT to do in this preparation pass

- Do not modify any soil to import from `/pillars/` yet. The wing exists; soil hasn't been rewired. That's the next session.
- Do not delete `hub/src/interfaces/`. Mark it deprecated in a comment at the top of each file there: `// DEPRECATED: superseded by /pillars/<Name>.ts`. Removal is a later rite.
- Do not write prose content beyond the README.
- Do not implement runtime exports of the registry. It's compile-time only for now.

## Verification before you stop

Run `tsc --noEmit` (or whatever the repo uses) on the new wing. The wing must type-check on its own. If `_registry.ts` compiles cleanly with all seven pillars and all six journeys present, the supersetting gate is closed and the structure is sound.

## Commit shape

One commit, message: `Lay the entrance stone: pillars wing, dictionary, registry, archived old Nest.md`. Include the `TODO.md`. Push to a branch named `nest/pillars-wing` and open a draft PR with this handoff document pasted into the description.

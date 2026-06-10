#!/usr/bin/env python3
# scripts/setup/eh-board-init.py
#
# Seeds the Energy Hack (team EH) board with the dependency-ordered scaffold
# tickets for the EnergyHackPrep app. Idempotent: skips any ticket whose exact
# title already exists in team EH. Creates SEQUENTIALLY so identifiers land in
# build order (EH-1 = scaffold … EH-16 = docs). Depends: LINEAR_API_TOKEN in
# /opt/nest/config.env. Run: python3 scripts/setup/eh-board-init.py
import json, os, sys, urllib.request

API = "https://api.linear.app/graphql"
TEAM_KEY = "EH"

def load_token():
    for line in open("/opt/nest/config.env"):
        line = line.strip()
        if line.startswith("LINEAR_API_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("LINEAR_API_TOKEN not found in /opt/nest/config.env")

TOKEN = load_token()

def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(API, data=body, headers={
        "Authorization": TOKEN, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    if data.get("errors"):
        sys.exit("Linear error: " + json.dumps(data["errors"]))
    return data["data"]

# --- resolve team, Spec'd state, ai-ready label ---------------------------
boot = gql("""query($k:String!){ teams(filter:{key:{eq:$k}}){ nodes{ id
  states{ nodes{ id name } } labels{ nodes{ id name } } } } }""", {"k": TEAM_KEY})
team = boot["teams"]["nodes"][0]
TID = team["id"]
SPECD = next(s["id"] for s in team["states"]["nodes"] if s["name"] == "Spec'd")
AIREADY = next(l["id"] for l in team["labels"]["nodes"] if l["name"] == "ai-ready")

# existing titles (idempotency)
existing = gql("""query($t:ID!){ issues(first:250, filter:{team:{id:{eq:$t}}}){
  nodes{ identifier title } } }""", {"t": TID})["issues"]["nodes"]
have = {n["title"] for n in existing}

P_URGENT, P_HIGH, P_NORMAL, P_LOW = 1, 2, 3, 4

# Each ticket: (priority, title, description). Order in this list == build order.
# The executor reads "Build order: N" to sequence; numbering is belt-and-suspenders.
TICKETS = [
 (P_URGENT, "Scaffold: repo layout + requirements + .env.example",
  """**Goal:** Create the project skeleton at the repo root so every later ticket has a home.

**Build order: 1**

**Context:** Source spec: `01_foundation_and_asset_copilot.md` (Repo layout, Tech, .env.example). Build at the REPO ROOT (`/opt/energyhack`) — do NOT create a nested `energy-hack/` subfolder; the repo itself is the app. Create `toolkit/__init__.py`, `pages/.gitkeep`, `data/.gitkeep`, `requirements.txt` (streamlit pandas numpy plotly pulp openai python-dotenv rapidfuzz markdown pytest), and `.env.example` (`LLM_BACKEND=auto`, `OPENROUTER_API_KEY=`, `OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free`).

**Acceptance criteria:**
- [ ] `tests/test_scaffold.py` asserts `requirements.txt` lists all runtime deps incl. `pulp`, and `.env.example` has `LLM_BACKEND`/`OPENROUTER_API_KEY`/`OPENROUTER_MODEL`  — verify: `pytest -q`
- [ ] `python -c "import toolkit"` succeeds (package importable)."""),

 (P_URGENT, "toolkit/data_mapper.py — EN/DE schema mapping",
  """**Goal:** Language-agnostic (English + German) schema mapping of raw sponsor headers to canonical fields.

**Build order: 2**

**Context:** `01_foundation_and_asset_copilot.md` §toolkit/data_mapper.py. Define `INTERNAL_SCHEMA` and `SYNONYMS` (EN+DE), `auto_map(df)` (rapidfuzz best-match above threshold), `apply_mapping(df, mapping)` (rename to canonical, parse timestamp→datetime, coerce numerics), `missing_fields(mapping)`.

**Acceptance criteria:**
- [ ] `tests/test_data_mapper.py`: `auto_map` maps German headers `Anlagen-ID`→`asset_id` and `Globalstrahlung`→`irradiance_wm2` — verify: `pytest -q`
- [ ] `apply_mapping` returns `timestamp` as datetime dtype and coerces numerics; `missing_fields` lists unmapped canonical fields (e.g. `price_eur_mwh`)."""),

 (P_HIGH, "toolkit/pv_model.py — expected generation + PR + peer fallback",
  """**Goal:** Physics-lite expected-generation model, performance ratio, and an irradiance-free peer fallback.

**Build order: 3**

**Context:** `01_foundation_and_asset_copilot.md` §toolkit/pv_model.py. `expected_generation(irradiance_wm2, temp_c, capacity_kwp, pr=0.80, gamma=-0.004, t_ref=25)` with `t_cell≈temp_c+irradiance*0.03`; `performance_ratio(actual, expected)`; `peer_expected(df)` using cohort hour-of-day median.

**Acceptance criteria:**
- [ ] `tests/test_pv_model.py`: `performance_ratio(80,100)==0.8` and `expected_generation` matches the documented formula for known inputs — verify: `pytest -q`
- [ ] `peer_expected(df)` returns a non-NaN per-asset expected series with NO irradiance column present."""),

 (P_HIGH, "toolkit/financials.py — revenue loss + monthly KPIs",
  """**Goal:** Financial quantification: revenue loss and a monthly KPI roll-up.

**Build order: 4**

**Context:** `01_foundation_and_asset_copilot.md` §toolkit/financials.py. `revenue_loss(lost_kwh, price_eur_mwh)`→EUR (divide by 1000 for kWh↔MWh); `monthly_kpis(df)`→dict (actual vs expected generation, performance ratio, availability %, downtime hours, incident count, estimated lost revenue).

**Acceptance criteria:**
- [ ] `tests/test_financials.py`: `revenue_loss(1000,50)==50.0` — verify: `pytest -q`
- [ ] `monthly_kpis(df)` returns a dict containing keys `performance_ratio`, `availability`, `downtime_hours`, `incident_count`, `lost_revenue` (numeric)."""),

 (P_HIGH, "toolkit/sample_data.py — story-shaped demo data + load_demo()",
  """**Goal:** Story-shaped synthetic data with deliberately planted, labeled anomalies so the copilot has obvious villains.

**Build order: 5**

**Context:** `01_foundation_and_asset_copilot.md` §toolkit/sample_data.py. Columns must match `data_mapper` canonical fields. Plant: `PV_Munich_03` inverter outage, `PV_Bavaria_01` soiling, `PV_Allgaeu_02` clipping, `PV_Donau_04` healthy. Hourly generation+irradiance+temp+inverter_status+alarm_code, plus `price_eur_mwh` with negative-price hours. Write CSVs to `data/`. `load_demo()` returns a ready DataFrame.

**Acceptance criteria:**
- [ ] `tests/test_sample_data.py`: `load_demo()` has all 4 asset_ids + canonical columns incl. `price_eur_mwh`, and `price_eur_mwh.min() < 0` — verify: `pytest -q`
- [ ] `PV_Munich_03` has a multi-hour window of high irradiance + near-zero actual + inverter alarm set."""),

 (P_HIGH, "toolkit/anomaly.py — detection rule tree + graceful degrade",
  """**Goal:** Deterministic anomaly detection that never hallucinates and never crashes on missing columns.

**Build order: 6**

**Context:** `01_foundation_and_asset_copilot.md` §toolkit/anomaly.py. `detect(df)`→issues DataFrame (cols: asset_id, issue_type, severity, window_start, window_end, evidence, lost_kwh_estimate). Rule tree: inverter_outage, soiling vs degradation (by decline timescale), clipping_or_curtailment, data_quality; night≈0 → no issue. Route through `pv_model.peer_expected` when irradiance missing; degrade gracefully (note reduced confidence), never raise on missing columns.

**Acceptance criteria:**
- [ ] `tests/test_anomaly.py`: `detect(load_demo())` flags `inverter_outage` for PV_Munich_03, `soiling` for PV_Bavaria_01, `clipping_or_curtailment` for PV_Allgaeu_02, and returns ZERO rows for PV_Donau_04 — verify: `pytest -q`
- [ ] `detect(demo.drop(columns=['irradiance_wm2']))` does not raise and returns a DataFrame with the documented columns."""),

 (P_HIGH, "toolkit/llm_writer.py — offline-first writer + template fallback",
  """**Goal:** LLM narration layer that works fully offline; every live call falls back to a deterministic template on ANY failure.

**Build order: 7**

**Context:** `01_foundation_and_asset_copilot.md` §toolkit/llm_writer.py. `class LLMWriter` picks backend on init (`LLM_BACKEND=='template'`→template; elif `OPENROUTER_API_KEY` set→OpenRouter via openai SDK `base_url=https://openrouter.ai/api/v1` + `OPENROUTER_MODEL`; else template). Methods `explain_diagnosis(issue)`, `draft_ticket(issue)`, `monthly_report(kpis, issues)`→markdown, each with a `_template_*` counterpart. Wrap every live call in try/except → template.

**Acceptance criteria:**
- [ ] `tests/test_llm_writer.py` (run with `LLM_BACKEND=template`): all three methods return non-empty strings and the writer's backend resolves to `template` — verify: `pytest -q`
- [ ] A simulated live-call exception still returns non-empty template output (no raise)."""),

 (P_HIGH, "toolkit/charts.py — reusable Plotly builders",
  """**Goal:** Reusable Plotly chart builders shared by the copilot and (later) battery pages.

**Build order: 8**

**Context:** `01_foundation_and_asset_copilot.md` §toolkit/charts.py. `expected_vs_actual(df, asset_id)`, `kpi_cards(kpis)` (values for `st.metric`), plus a generic time-series helper the battery page reuses.

**Acceptance criteria:**
- [ ] `tests/test_charts.py`: `expected_vs_actual(load_demo(),'PV_Munich_03')` returns a `plotly.graph_objects.Figure` — verify: `pytest -q`
- [ ] `kpi_cards(monthly_kpis(load_demo()))` returns metric values surfacing `performance_ratio` and `lost_revenue`."""),

 (P_NORMAL, "app.py — landing + portfolio overview",
  """**Goal:** Streamlit landing page with a portfolio overview ranked by estimated €/day lost.

**Build order: 9**

**Context:** `01_foundation_and_asset_copilot.md` §app.py. Intro, "Load demo data" button, portfolio table ranked by €/day lost, headline KPIs. Keep real logic in `toolkit/` (the page is thin wiring). Put the ranking in a testable toolkit helper, e.g. `toolkit/financials.portfolio_ranking(df)` returning assets sorted by €/day lost desc.

**Acceptance criteria:**
- [ ] `tests/test_app.py`: the toolkit portfolio-ranking helper ranks PV_Munich_03 (loss-maker) above PV_Donau_04 (healthy) — verify: `pytest -q`
- [ ] Same test AST-parses `app.py` (valid syntax) and asserts it references `load_demo` and the ranking helper."""),

 (P_NORMAL, "pages/1_Asset_Copilot.py — flagship flow",
  """**Goal:** The flagship Asset Copilot page: upload/demo → map → rank → diagnose → draft ticket → monthly report.

**Build order: 10**

**Context:** `01_foundation_and_asset_copilot.md` §pages/1_Asset_Copilot.py (full 7-step flow, incl. manual override dropdowns per canonical field). Thin wiring over `toolkit`.

**Acceptance criteria:**
- [ ] `tests/test_copilot_page.py` AST-parses the page and asserts the wiring symbols are referenced: `auto_map`, `apply_mapping`, `detect`, `expected_vs_actual`, `explain_diagnosis`, `draft_ticket`, `monthly_report` — verify: `pytest -q`
- [ ] The page references both upload and "Load demo data" entry points (assert both string markers present)."""),

 (P_HIGH, "toolkit/battery_opt.py — PuLP dispatch LP",
  """**Goal:** A real (small) linear program for battery dispatch — arbitrage + negative-price avoidance.

**Build order: 11**

**Context:** `02_battery_brain.md` §toolkit/battery_opt.py. PuLP, ~40-60 lines. Inputs hourly `solar_kwh[t]`, `price_eur_mwh[t]` + scalars (capacity_kwh, p_charge_max_kw, p_discharge_max_kw, eff_rt split as eff_c=eff_d=sqrt(eff_rt), soc_init/min/max). Vars charge/discharge/soc. Maximize `sum (discharge-charge)*price/1000`. Constraints: SoC balance, SoC bounds, power limits, optional `soc[end]>=soc_init`. Return schedule df (hour,price,solar,charge,discharge,soc) + `revenue_without_battery`, `revenue_with_battery`, `incremental_value`, `negative_price_energy_shifted_mwh`. Catch infeasibility.

**Acceptance criteria:**
- [ ] `tests/test_battery_opt.py`: on the demo series `incremental_value > 0`, `revenue_with_battery >= revenue_without_battery`, SoC within bounds, charge/discharge ≤ power limits — verify: `pytest -q`
- [ ] Infeasible inputs return a readable error/None rather than raising."""),

 (P_NORMAL, "pages/2_Battery_Brain.py — dispatch page",
  """**Goal:** The battery pivot page: run dispatch, show schedule + incremental €/day, with honest market positioning.

**Build order: 12**

**Context:** `02_battery_brain.md` §pages/2_Battery_Brain.py. Reuse `charts`, `llm_writer`, `sample_data`. Sidebar inputs; "Run optimization"→`battery_opt`; charts (price+solar overlay, SoC, dispatch table); revenue comparison; "Why this schedule?" via LLMWriter. The FCR/aFRR positioning sentence MUST be visible in the UI copy.

**Acceptance criteria:**
- [ ] `tests/test_battery_page.py` AST-parses the page, asserts it calls `battery_opt`, and the source contains both `FCR` and `aFRR` (positioning sentence) — verify: `pytest -q`
- [ ] The page references `Run optimization` and a revenue comparison (assert string markers)."""),

 (P_NORMAL, "toolkit/branding.py — reframe/rename presets",
  """**Goal:** Centralize all user-facing naming so the demo can be rebranded in one place on the day.

**Build order: 13**

**Context:** `03_demo_hardening_and_reframe_kit.md` §2. `PRESETS` dict: `asset_copilot`, `solarops_agent`, `revenue_at_risk`, `om_triage`, `flex_dispatch` — each with `title` + `subtitle`. Switchable via `BRANDING` env var / sidebar selector; propagates title+subtitle across pages.

**Acceptance criteria:**
- [ ] `tests/test_branding.py`: all 5 preset keys present, each with `title`+`subtitle`; `PRESETS['asset_copilot']['title']=='Asset Copilot'` and `PRESETS['flex_dispatch']['title']=='Flex Dispatch Assistant'` — verify: `pytest -q`
- [ ] A helper resolves the active preset from the `BRANDING` env var, defaulting to `asset_copilot`."""),

 (P_NORMAL, "Offline-hardening pass — friendly errors + backend badge",
  """**Goal:** Make the demo bulletproof offline: silent template fallback, friendly CSV errors, visible backend badge.

**Build order: 14**

**Context:** `03_demo_hardening_and_reframe_kit.md` §1. The whole app must run with NO `.env` (every LLM call falls back to template silently). Wrap data loading + detection in try/except so a malformed CSV shows a friendly message, not a traceback. Add a sidebar badge showing the current LLM backend. Expose a testable `toolkit` helper for safe-load and for the backend label.

**Acceptance criteria:**
- [ ] `tests/test_hardening.py` (env unset): `LLMWriter().backend=='template'`; a `toolkit` safe-load+detect helper returns a handled error (not a raise) on garbage CSV bytes — verify: `pytest -q`
- [ ] A `toolkit` helper returns the current backend label (`'template'` with no key) for the sidebar badge."""),

 (P_NORMAL, "preflight.py — no-network PASS/FAIL harness",
  """**Goal:** The Friday-morning preflight: exercise every critical path offline and exit non-zero on any failure.

**Build order: 15**

**Context:** `03_demo_hardening_and_reframe_kit.md` §5. `preflight.py` (plain Python, runnable as `python preflight.py`, no network) prints PASS/FAIL for: load demo, apply auto-mapping, anomaly detection (asserts planted outage/soiling/clipping found AND healthy asset NOT flagged), battery LP (asserts incremental value > 0), each `LLMWriter` method in template mode (non-empty). Exit non-zero if any check fails.

**Acceptance criteria:**
- [ ] `tests/test_preflight.py` runs `python preflight.py` via subprocess (no network) and asserts return code 0, stdout contains a `PASS` for each of the 5 checks, and contains no `FAIL` — verify: `pytest -q`
- [ ] This is the capstone integration gate: the full `pytest -q` suite (all prior modules) must be green alongside it."""),

 (P_LOW, "Docs — ARCHITECTURE.md + DEMO_SCRIPTS.md + README.md",
  """**Goal:** The pitch + onboarding docs that make the AI story defensible and the demo reproducible.

**Build order: 16**

**Context:** `03_demo_hardening_and_reframe_kit.md` §3,4,6. `ARCHITECTURE.md`: the arrow pipeline (Raw data → schema mapping (EN/DE) → deterministic detection + financial quantification → LLM narration only → human review) + the explicit statement that the diagnosis is deterministic and cannot be hallucinated. `DEMO_SCRIPTS.md`: 60-second narrations for Asset Copilot and Battery Brain. `README.md`: one-line pitch, install/run, OpenRouter env note (works fully without it), how to switch branding presets, pointers to DEMO_SCRIPTS.md + preflight.py.

**Acceptance criteria:**
- [ ] `tests/test_docs.py`: all three files exist; `ARCHITECTURE.md` contains the pipeline arrows and the word `deterministic`; `README.md` mentions `streamlit run app.py`, `preflight.py`, and the works-without-key note — verify: `pytest -q`
- [ ] `DEMO_SCRIPTS.md` contains both an `Asset Copilot` and a `Battery Brain` section."""),
]

created, skipped = [], []
for prio, title, desc in TICKETS:
    if title in have:
        skipped.append(title)
        continue
    res = gql("""mutation($i:IssueCreateInput!){ issueCreate(input:$i){
      success issue{ identifier title } } }""", {"i": {
        "teamId": TID, "title": title, "description": desc,
        "stateId": SPECD, "labelIds": [AIREADY], "priority": prio}})
    iss = res["issueCreate"]["issue"]
    created.append(iss["identifier"] + "  " + iss["title"])
    print("created", iss["identifier"], iss["title"])

print(f"\nDone. created={len(created)} skipped={len(skipped)}")
if skipped:
    print("skipped (already existed):", len(skipped))

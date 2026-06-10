#!/usr/bin/env python3
# scripts/tasks/sources/claude-usage.py
#
# Parses local Claude Code session logs (the same data `/usage` reads) into a per-model
# token + API-equivalent-cost breakdown plus contributing factors. Emits compact JSON on stdout.
# Dedupes by message id (streaming writes the same record several times). Env: PERIOD_START_ISO,
# PROJECTS_DIR. Called by claude-pro.sh — NOT a token source itself (aggregate-tokens runs *.sh).

import json, os, glob

PERIOD_START = os.environ.get("PERIOD_START_ISO", "")
PROJECTS_DIR = os.environ.get("PROJECTS_DIR", "/home/claude/.claude/projects")

# Per-MTok USD: (input, output, cache_read, cache_write_5m, cache_write_1h).
# Subscription users are not billed this — it's the pay-per-use equivalent, a relative
# "expensiveness" signal. read = 0.1x input; write = 1.25x (5m) / 2x (1h) input.
PRICING = {
    "claude-opus-4-8":   (5.0, 25.0, 0.5,  6.25, 10.0),
    "claude-opus-4-7":   (5.0, 25.0, 0.5,  6.25, 10.0),
    "claude-opus-4-6":   (5.0, 25.0, 0.5,  6.25, 10.0),
    "claude-sonnet-4-6": (3.0, 15.0, 0.3,  3.75,  6.0),
    "claude-sonnet-4-5": (3.0, 15.0, 0.3,  3.75,  6.0),
    "claude-haiku-4-5":  (1.0,  5.0, 0.1,  1.25,  2.0),
}


def price(model):
    if model in PRICING:
        return PRICING[model]
    for k, v in PRICING.items():               # prefixed variants (e.g. dated/[1m] suffixes)
        if model.startswith(k):
            return v
    if "opus" in model:   return PRICING["claude-opus-4-8"]
    if "sonnet" in model: return PRICING["claude-sonnet-4-6"]
    if "haiku" in model:  return PRICING["claude-haiku-4-5"]
    return None


def main():
    seen = set()
    by_model = {}                              # model -> [in, out, cache_read, cache_write, cost]
    total_cost = ctx_cost = sub_cost = 0.0     # factor accumulators (by API-equiv cost)
    mcp = {}

    for path in glob.glob(os.path.join(PROJECTS_DIR, "*", "*.jsonl")):
        try:
            fh = open(path, "r")
        except OSError:
            continue
        with fh:
            for line in fh:
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                msg = e.get("message") or {}
                u = msg.get("usage")
                if not u:
                    continue
                if (e.get("timestamp") or "") < PERIOD_START:
                    continue
                key = msg.get("id") or e.get("requestId") or e.get("uuid")
                if key in seen:                # streaming logs the same message repeatedly
                    continue
                seen.add(key)

                model = msg.get("model") or ""
                pin = u.get("input_tokens") or 0
                pout = u.get("output_tokens") or 0
                pcr = u.get("cache_read_input_tokens") or 0
                pcw = u.get("cache_creation_input_tokens") or 0
                cc = u.get("cache_creation") or {}
                cw5, cw1 = cc.get("ephemeral_5m_input_tokens"), cc.get("ephemeral_1h_input_tokens")
                if cw5 is None and cw1 is None:
                    cw5, cw1 = pcw, 0          # no split reported → treat as 5m
                else:
                    cw5, cw1 = cw5 or 0, cw1 or 0

                pr = price(model)
                cost = (pin * pr[0] + pout * pr[1] + pcr * pr[2] + cw5 * pr[3] + cw1 * pr[4]) / 1e6 if pr else 0.0

                m = by_model.setdefault(model, [0, 0, 0, 0, 0.0])
                m[0] += pin; m[1] += pout; m[2] += pcr; m[3] += pcw; m[4] += cost
                total_cost += cost

                if (pin + pcr + pcw) > 150000:  # context size of this request
                    ctx_cost += cost
                if e.get("isSidechain"):
                    sub_cost += cost
                srv = e.get("attributionMcpServer")
                if srv:
                    mcp[srv] = mcp.get(srv, 0.0) + cost

    def pct(x):
        return round(100 * x / total_cost, 1) if total_cost > 0 else 0

    models, total_tokens = [], 0
    for model, (i, o, cr, cw, cost) in sorted(by_model.items(), key=lambda kv: -kv[1][4]):
        tok = i + o + cr + cw
        if tok == 0:                           # synthetic / no-op turns
            continue
        total_tokens += tok
        models.append({"model": model, "input": i, "output": o, "cacheRead": cr,
                       "cacheWrite": cw, "tokens": tok, "costUsdEquivalent": round(cost, 4)})

    print(json.dumps({
        "byModel": models,
        "totalTokens": total_tokens,
        "totalCostUsdEquivalent": round(total_cost, 4),
        "requests": len(seen),
        "factors": {
            "over150kContextPct": pct(ctx_cost),
            "subagentPct": pct(sub_cost),
            "mcpByServerPct": {k: pct(v) for k, v in sorted(mcp.items(), key=lambda kv: -kv[1])},
        },
    }))


if __name__ == "__main__":
    main()

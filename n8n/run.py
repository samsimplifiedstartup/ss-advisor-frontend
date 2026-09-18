#!/usr/bin/env python3
"""Drives the live advisor and records every turn. Paced to stay under the widget's own rate limit."""
import json, sys, time, uuid, urllib.request, pathlib

URL = "https://n8n.notaiagent.com/webhook/advisor"
OUT = pathlib.Path(__file__).parent / "results.json"
GAP = 5.0   # seconds between requests


def ask(msg, token=None):
    body = {
        "type": "message",
        "state_token": token,
        "turn_client_id": "t_" + uuid.uuid4().hex[:24],
        "message": msg,
        "client": {"page_url": "https://simplifiedstartup.com/", "referrer": "",
                   "tz": "Asia/Kolkata", "locale": "en-US", "device": "desktop"},
    }
    req = urllib.request.Request(URL, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json",
                                          "Origin": "https://simplifiedstartup.com"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            raw = r.read().decode()
        ms = int((time.time() - t0) * 1000)
        try:
            return json.loads(raw), ms
        except Exception:
            return {"_unparsed": raw[:500]}, ms
    except Exception as e:
        return {"_error": str(e)}, int((time.time() - t0) * 1000)


def run(label, questions, chain=False):
    rows, token = [], None
    for i, q in enumerate(questions, 1):
        res, ms = ask(q, token if chain else None)
        if chain and isinstance(res, dict) and res.get("state_token"):
            token = res["state_token"]
        rows.append({
            "set": label, "n": i, "q": q, "ms": ms,
            "reply": res.get("reply", ""),
            "cta": [c.get("id") for c in (res.get("cta") or [])],
            "suggestions": res.get("suggestions") or [],
            "state": res.get("state") or {},
            "error": res.get("_error") or res.get("_unparsed"),
        })
        r = rows[-1]
        print(f"[{label} {i:>2}] {ms:>5}ms cta={','.join(r['cta']) or '-':<22} "
              f"phase={r['state'].get('phase','?'):<12} {q[:60]}")
        sys.stdout.flush()
        time.sleep(GAP)
    return rows


if __name__ == "__main__":
    which = sys.argv[1]
    sets = json.loads((pathlib.Path(__file__).parent / "questions.json").read_text())
    existing = json.loads(OUT.read_text()) if OUT.exists() else []
    new = run(which, sets[which], chain=(which == "conversation"))
    OUT.write_text(json.dumps(existing + new, indent=1))
    ok = sum(1 for r in new if r["reply"] and not r["error"])
    print(f"\n{which}: {ok}/{len(new)} answered, written to {OUT}")

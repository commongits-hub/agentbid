#!/usr/bin/env python3
"""009 payout_guard 검증 — PostgREST + RPC 전용"""

import json, urllib.request, urllib.parse, sys
from datetime import datetime, timezone, timedelta

PROJECT_URL = "https://xlhiafqcoyltgyfezdnm.supabase.co"
SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsaGlhZnFjb3lsdGd5ZmV6ZG5tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzM4NjQ0NywiZXhwIjoyMDg4OTYyNDQ3fQ.JoZU8K05-f845hOprT8Jh17n6A2zZhQfLMkz2ftEyiA"

HDR = {
    "apikey":        SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "return=representation",
}

def req(method, path, body=None, params=None):
    url = PROJECT_URL + "/rest/v1" + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, headers=HDR, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else [])
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def sel(table, **params):
    _, data = req("GET", f"/{table}", params=params)
    return data

def ins(table, body):
    code, data = req("POST", f"/{table}", body=body)
    if code not in (200, 201):
        raise RuntimeError(f"INSERT {table} failed {code}: {data}")
    return data

def upd(table, body, **params):
    code, data = req("PATCH", f"/{table}", body=body, params=params)
    if code not in (200, 204):
        raise RuntimeError(f"UPDATE {table} failed {code}: {data}")
    return data

def delete(table, **params):
    req("DELETE", f"/{table}", params=params)

def rpc(fn):
    code, data = req("POST", f"/rpc/{fn}", body={})
    if code not in (200, 204):
        raise RuntimeError(f"RPC {fn} failed {code}: {data}")
    return data

def now_iso(delta_minutes=0):
    t = datetime.now(timezone.utc) + timedelta(minutes=delta_minutes)
    return t.strftime("%Y-%m-%dT%H:%M:%S+00:00")

def payout_status(pid):
    rows = sel("payouts", id=f"eq.{pid}", select="status")
    return rows[0]["status"] if rows else "NOT FOUND"

PAYOUT_ID = "00000000-ffff-0000-0000-aabbcc000099"

# ─── setup ─────────────────────────────────────────────────────
print("=== 009 payout_guard 검증 (PostgREST) ===\n")

agents = sel("agents", select="id,stripe_onboarding_completed",
             soft_deleted_at="is.null", limit="1")
assert agents, "ERROR: agent 없음"
AGENT_ID     = agents[0]["id"]
orig_conn    = agents[0]["stripe_onboarding_completed"]

print(f"agent : {AGENT_ID}  connected={orig_conn}")

# payout 없는 order 찾기
all_orders = sel("orders", select="id", limit="20")
FREE_ORDER_ID = None
for o in all_orders:
    ep = sel("payouts", order_id=f"eq.{o['id']}", select="id")
    if not ep:
        FREE_ORDER_ID = o["id"]
        break

if not FREE_ORDER_ID:
    print("ERROR: payout-free order 없음 — paid order 없거나 모두 payout 존재")
    sys.exit(1)
print(f"order : {FREE_ORDER_ID}\n")

# 기존 테스트 payout 정리
delete("payouts", id=f"eq.{PAYOUT_ID}")

# ─── TEST 1: 미연결 + 만기 → hold ──────────────────────────────
upd("agents", {"stripe_onboarding_completed": False}, id=f"eq.{AGENT_ID}")
ins("payouts", {
    "id":         PAYOUT_ID,
    "order_id":   FREE_ORDER_ID,
    "agent_id":   AGENT_ID,
    "amount":     8000,
    "status":     "pending",
    "release_at": now_iso(-2),   # 2분 전 = 만기
})
rpc("release_matured_payouts")
got = payout_status(PAYOUT_ID)
print(f"[TEST 1] 미연결 + 만기   → 기대: hold     / 실제: {got}")
assert got == "hold",     f"FAIL: {got}"
print("  ✅ PASS\n")

# ─── TEST 2: 온보딩 완료 (만기 경과) → hold 해제 → released ────
upd("agents",
    {"stripe_onboarding_completed": True,
     "stripe_onboarding_completed_at": now_iso()},
    id=f"eq.{AGENT_ID}")
got = payout_status(PAYOUT_ID)
print(f"[TEST 2] 온보딩 완료 (만기 경과) → 기대: released / 실제: {got}")
assert got == "released", f"FAIL: {got}"
print("  ✅ PASS\n")

# ─── TEST 3: 미연결 + 만기 미경과 → pending 유지 ──────────────
delete("payouts", id=f"eq.{PAYOUT_ID}")
upd("agents", {"stripe_onboarding_completed": False}, id=f"eq.{AGENT_ID}")
ins("payouts", {
    "id":         PAYOUT_ID,
    "order_id":   FREE_ORDER_ID,
    "agent_id":   AGENT_ID,
    "amount":     5000,
    "status":     "pending",
    "release_at": now_iso(+3 * 24 * 60),   # 3일 후 = 만기 미경과
})
rpc("release_matured_payouts")
got = payout_status(PAYOUT_ID)
print(f"[TEST 3] 미연결 + 만기 미경과 → 기대: pending  / 실제: {got}")
assert got == "pending",  f"FAIL: {got}"
print("  ✅ PASS\n")

# ─── TEST 4: hold + 만기 미경과 → 온보딩 완료 → pending 복귀 ──
upd("payouts", {"status": "hold"}, id=f"eq.{PAYOUT_ID}")
upd("agents",
    {"stripe_onboarding_completed": True,
     "stripe_onboarding_completed_at": now_iso()},
    id=f"eq.{AGENT_ID}")
got = payout_status(PAYOUT_ID)
print(f"[TEST 4] hold (만기 미경과) + 온보딩 완료 → 기대: pending  / 실제: {got}")
assert got == "pending",  f"FAIL: {got}"
print("  ✅ PASS\n")

# ─── TEST 5: 연결 완료 + 만기 → released ─────────────────────
upd("payouts", {"release_at": now_iso(-2)}, id=f"eq.{PAYOUT_ID}")
rpc("release_matured_payouts")
got = payout_status(PAYOUT_ID)
print(f"[TEST 5] 연결 완료 + 만기   → 기대: released / 실제: {got}")
assert got == "released", f"FAIL: {got}"
print("  ✅ PASS\n")

# ─── 정리 ─────────────────────────────────────────────────────
delete("payouts", id=f"eq.{PAYOUT_ID}")
upd("agents",
    {"stripe_onboarding_completed": orig_conn},
    id=f"eq.{AGENT_ID}")

print("=== 전체 5/5 통과 ✅ ===")

# OPS_TODO.md
# AgentBid — 운영 TODO (Live 전환 기준)

Last updated: 2026-03-19

---

## 즉시 실행 (live 전환 전 필수)

### [STRIPE] Vercel 환경변수 교체
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_live_...
```
→ Vercel Dashboard → Settings → Environment Variables

### [STRIPE] Live Webhook 등록
```
URL: https://agentbid.vercel.app/api/webhooks/stripe
Events:
  - checkout.session.completed
  - payment_intent.payment_failed
  - charge.refunded
  - account.updated
```

### [PAYOUT] CRON_SECRET 주입
```
CRON_SECRET=<random 32+ char secret>
```
→ cron 호출 측: `Authorization: Bearer <CRON_SECRET>` 또는 `x-cron-secret: <CRON_SECRET>` 헤더 확인

### [SUPABASE] Site URL 갱신
```
Auth → URL Configuration → Site URL = https://agentbid.vercel.app
Redirect URLs에 live 도메인 추가
```

### [APP] NEXT_PUBLIC_APP_URL 확인
```
NEXT_PUBLIC_APP_URL=https://agentbid.vercel.app
```
→ success_url / onboarding return_url이 이 값 기준으로 생성됨

---

## Live 전환 후 즉시 실행

### 실결제 smoke (소액 1회)
1. 새 user/provider 계정 생성
2. task 등록 → submission 제출
3. checkout → 실결제
4. webhook 수신 확인 (Stripe Dashboard → Webhooks)
5. orders.status = paid, submissions.status = purchased 확인
6. success page 도착 확인

### payout cron 1회 수동 트리거
- released 상태 payout이 있으면 transfer-payouts 호출
- Stripe Transfer 생성 확인

---

## 운영 데이터 정리 (live 전환 전 or 후)

### 삭제 대상 test 계정
- smoke.provider.*@*
- qa.test.agentbid@gmail.com
- qa.provider.agentbid@gmail.com
- qa.regression.agentbid@gmail.com
- qa-h2@agentbid.dev

### 삭제 방법
Supabase Dashboard → Auth → Users → 해당 계정 삭제
(cascade로 public.users, agents, tasks, submissions, orders, reviews, payouts 정리됨)

---

## 운영 중 주기적 점검

### Stale lock 점검 (webhook)
```sql
SELECT id, stripe_event_id, processing, processing_started_at
FROM webhook_events
WHERE processing = true
  AND processing_started_at < NOW() - INTERVAL '10 minutes';
```
→ 있으면 수동 reset: `UPDATE webhook_events SET processing=false WHERE ...`

### Payout hold 점검
```sql
SELECT p.id, p.amount, p.status, a.stripe_account_id
FROM payouts p
JOIN orders o ON o.id = p.order_id
JOIN submissions s ON s.id = o.submission_id
JOIN agents a ON a.id = s.agent_id
WHERE p.status = 'hold';
```
→ hold 상태 = provider가 Stripe 미연결. 연결 후 자동 released 전환됨

---

## 완료 기준

PRE_LIVE_CHECKLIST.md 전 항목 ✅ → live 전환 가능

# PRE_LIVE_CHECKLIST.md
# AgentBid — Live 전환 전 체크리스트

Status: 기능 smoke 완료 (2026-03-19)
Next: 아래 순서대로 닫으면 live 전환 가능

---

## 1. Stripe Live 전환

### 1-1. Vercel 환경변수 교체
- [ ] `STRIPE_SECRET_KEY` — test → live (`sk_live_...`)
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — test → live (`pk_live_...`) *(있으면)*
- [ ] `STRIPE_WEBHOOK_SECRET` — test → live webhook secret

### 1-2. Live Webhook 등록
- [ ] Stripe Dashboard → Webhooks → Add endpoint
- [ ] URL: `https://agentbid.vercel.app/api/webhooks/stripe`
- [ ] Events: `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`, `account.updated`
- [ ] webhook secret → `STRIPE_WEBHOOK_SECRET` 업데이트

### 1-3. 테스트 키 제거 확인
- [ ] `.env.local` test key 삭제 (local dev 제외)
- [ ] Vercel env에 test key 잔존 없음 확인

---

## 2. Stripe Connect Live 준비

### 2-1. 운영 Connect 설정
- [ ] Stripe Dashboard → Connect → Settings → Live mode 확인
- [ ] `refresh_url`, `return_url` live 도메인으로 설정
  - refresh: `https://agentbid.vercel.app/onboarding/stripe?refresh=1`
  - return: `https://agentbid.vercel.app/onboarding/stripe?success=1`

### 2-2. 실제 provider 온보딩 1회
- [ ] provider 계정으로 `/onboarding/stripe` 진입
- [ ] Stripe Express 온보딩 완료
- [ ] `agents.stripe_onboarding_completed = true`
- [ ] `agents.stripe_onboarding_completed_at` 세팅 확인

---

## 3. 결제 실운영 Smoke

### 3-1. 소액 실결제 1회
- [ ] 실제 task 등록 (user 계정)
- [ ] provider가 submission 제출
- [ ] user가 `Select & Pay` → Stripe Checkout 진입
- [ ] 실결제 완료
- [ ] webhook → `checkout.session.completed` 수신
- [ ] `orders.status = paid` 전환
- [ ] `submissions.status = purchased` 전환
- [ ] `tasks.status = completed` 전환
- [ ] `/orders/[sessionId]/success` 도착 + paid 확인
- [ ] payout 레코드 생성 확인

### 3-2. 중복 / 에러 케이스
- [ ] 동일 submission 재결제 시 409 확인
- [ ] webhook 재전송 시 멱등성 확인

---

## 4. Payout 운영 준비

### 4-1. cron 환경변수
- [ ] `CRON_SECRET` Vercel env 주입

### 4-2. transfer-payouts cron 확인
- [ ] cron 호출 시 `x-cron-secret` 헤더 포함 확인
- [ ] released 상태 payout → Stripe Transfer 정상
- [ ] `payouts.status = transferred` 전환 확인
- [ ] stale lock (processing=true stuck) 점검

---

## 5. 운영 데이터 정리

### 5-1. Test 데이터 삭제
- [ ] test users (smoke.*, qa.test.*, qa.provider.*, qa.regression.* 등)
- [ ] test tasks
- [ ] test submissions
- [ ] test orders / payouts / reviews
- [ ] test stripe accounts (Stripe Dashboard에서 test mode 확인)

### 5-2. Admin 계정 확인
- [ ] admin role user 존재 확인
- [ ] admin 로그인 → `/admin` 진입 정상
- [ ] reports / tasks / users 페이지 정상

---

## 6. 최종 확인

- [ ] `NEXT_PUBLIC_APP_URL` = `https://agentbid.vercel.app` (또는 커스텀 도메인)
- [ ] Supabase Auth → Site URL = live 도메인
- [ ] 이메일 확인 설정 (현재 on/off 여부 확인 후 결정)
- [ ] Error 모니터링 설정 (Vercel Logs, Supabase Logs)

---

## 완료 기준

위 체크리스트 전 항목 닫힌 후 → live 전환 가능

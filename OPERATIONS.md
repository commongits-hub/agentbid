# AgentBid 운영 마감 문서

## 현재 상태 (2026-03-14 기준)

| 구분 | 상태 |
|---|---|
| MVP 구현 | ✅ 완료 (commit c33ce1b) |
| Vercel 배포 | ✅ Ready (`agentbid.vercel.app`) |
| 핵심 Smoke Test | ✅ 통과 |
| **결제 세션 실검증** | ⏳ **후속 체크리스트 (1건)** |

---

## 후속 체크리스트 (1건)

### Stripe Checkout 실결제 smoke test

- [ ] owner 로그인 → task 상세 → submission 선택 → checkout 진행
- [ ] Stripe test card `4242 4242 4242 4242` 사용
- [ ] `checkout.session.completed` webhook 수신 확인
  - Stripe Dashboard → Workbench → Event destinations → sophisticated-inspiration → Event deliveries
- [ ] `/orders/{sessionId}/success` 페이지 폴링 정상 완료 확인
- [ ] `orders.status = paid` DB 반영 확인
- [ ] `payouts` 레코드 생성 확인 (`status = pending`)

실패 시:
- [ ] `payment_intent.payment_failed` webhook 수신 확인
- [ ] fail 페이지 또는 대시보드 에러 표시 확인

---

## Stripe test → live 전환 체크리스트

> 이 단계는 실제 서비스 오픈 직전에 수행

- [ ] Stripe 라이브 키 발급 (`sk_live_...`)
  - Dashboard → Developers → API keys → Reveal live secret key
- [ ] Vercel env 교체
  - `STRIPE_SECRET_KEY` = `sk_live_...`
  - `STRIPE_WEBHOOK_SECRET` = (아래 webhook 재등록 후 발급값)
- [ ] Stripe Dashboard → Webhooks → Add endpoint (live mode)
  - URL: `https://agentbid.vercel.app/api/webhooks/stripe`
  - 이벤트: `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`, `account.updated`
  - 신규 `STRIPE_WEBHOOK_SECRET` Vercel env 반영
- [ ] Stripe Connect → live mode 계좌 onboarding 재검증
  - test mode Connect 계좌와 live mode는 별개
  - provider는 live 환경에서 다시 onboarding 필요
- [ ] 전환 후 라이브 smoke test 1회 (소액 실결제)
- [ ] Vercel 재배포 (env 변경 반영)

---

## Known Issues / Follow-up

| 항목 | 내용 | 우선순위 |
|---|---|---|
| Stripe Connect KR 지원 | Express 계좌 생성 시 KR 국가 지원 여부 확인 필요 | Medium |
| Edge Function `transfer-payouts` | `released` → `transferred` 자동 이체 미배포 | High |
| `adam-epiclions/agentbid` 레포 삭제 | 미사용 레포 정리 필요 | Low |
| `tsc --noEmit` CI 추가 | Vercel 빌드 전 타입 체크 자동화 | Low |
| E2E 테스트 계정 정리 | e2e_owner / e2e_provider 실서비스 전 삭제 | Medium |
| pg_cron 스케줄 확인 | `release-matured-payouts` 02:00 UTC 실행 여부 모니터링 | Medium |

---

## Edge Function `transfer-payouts` 배포 (미완)

> Supabase Edge Function — `released` 상태 payout을 Stripe Transfer로 이체

배포 방법:
```bash
cd agentbid
supabase functions deploy transfer-payouts
```

스케줄: 매일 03:00 UTC (`pg_cron`)
연결 DB 함수: `transfer_released_payouts()`

**주의:** 이 함수가 없으면 `released` 상태가 `transferred`로 전환되지 않음.  
현재는 수동 또는 cron 없이 `transferred` 상태 미반영 상태.

---

## 운영 환경 설정 현황

| 항목 | 값 |
|---|---|
| 배포 URL | `https://agentbid.vercel.app` |
| GitHub | `commongits-hub/agentbid` (private) |
| Supabase | `xlhiafqcoyltgyfezdnm` (Free tier) |
| Stripe 모드 | **Test** (live 전환 전) |
| Stripe webhook | `sophisticated-inspiration` (Active, 4 events) |
| Stripe Connect 모드 | Express / Marketplace |

---

## 계정 정보 (test only)

| 역할 | 이메일 | 비고 |
|---|---|---|
| owner (test) | `e2e_owner@agentbid.test` | smoke test 전용 |
| provider (test) | `e2e_provider@agentbid.test` | stripe account: `acct_1TAfhlQrvuZfdGVn` |

---

## 다음 우선순위 (배포 후)

1. **Edge Function `transfer-payouts` 배포** — released→transferred 자동화
2. **Stripe 결제 세션 실검증** — checkout success/fail smoke test
3. **E2E 테스트 계정 정리** — 실서비스 전 삭제
4. **live Stripe 전환** — 위 체크리스트 순서대로

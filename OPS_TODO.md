# AgentBid — 운영 TODO (live 전환 기준)

> 기준 커밋: `f61eea6` | Migration chain: 001~042 완결 (037 제외)  
> 작성일: 2026-03-16  
> **이 파일은 개발 TODO가 아니다. 환경/운영 설정만 다룬다.**

---

## 🔴 live 전환 전 필수

| # | 항목 | 현재 상태 | 액션 |
|---|---|---|---|
| L-01 | Stripe live key 주입 | `sk_test_...` 사용 중 | Adam이 Stripe Dashboard에서 비즈니스 정보 제출 → `charges_enabled=true` 확인 후 `sk_live_...` 주입 |
| L-02 | live webhook endpoint 등록 | test webhook만 등록됨 | Stripe Dashboard → `https://<prod-domain>/api/webhooks/stripe` 등록 |
| L-03 | live webhook secret 반영 | `whsec_test_...` 사용 중 | live endpoint 등록 후 `STRIPE_WEBHOOK_SECRET=whsec_live_...` 교체 |
| L-04 | Vercel env 교체 | test key 세팅 | L-01~03 완료 후 Vercel Dashboard env 일괄 교체 → auto-redeploy 확인 |
| L-05 | live Connect onboarding 1회 검증 | 미검증 | live 전환 후 신규 provider 계정으로 onboarding URL 생성 + 완료 플로우 확인 |
| L-06 | 소액 실결제 smoke test | 미수행 | live key로 실제 카드 결제 1회 → `orders.status=paid`, `payouts.status=pending` 확인 |

---

## 🟡 live 전환 후 조기 확인

| # | 항목 | 기준 |
|---|---|---|
| A-01 | CRON_SECRET 운영 주입 | Supabase Dashboard → Functions → Secrets → `CRON_SECRET=<random>` 주입 + transfer-payouts cron `x-cron-secret` 헤더 확인 |
| A-02 | payout/transfer 로그 확인 | 첫 `released → transferred` 전환 후 Edge Function 로그 확인 |
| A-03 | hold payout 해제 흐름 확인 | Connect onboarding 완료 후 `hold → released/pending` 자동 전환 확인 |
| A-04 | `reset_stale_webhook_claims()` 초기 1회 실행 | 배포 직후 Supabase SQL Editor에서 실행 (`SELECT reset_stale_webhook_claims();`) |

---

## 🟢 live 안정화 후 (낮은 우선순위 — 즉시 필요 없음)

| # | 항목 | 내용 |
|---|---|---|
| B-01 | dashboard client-side role fallback 제거 | `user_metadata.role` fallback → JWT decode 전환 (현재 DEPRECATED 주석 처리됨) |
| B-02 | requireAuth user_metadata fallback 제거 | live 안정화 후 `?? userMeta.role` 제거 |
| B-03 | `/tasks` 서버 검색/정렬 전환 | open task 100건+ 시 클라이언트 필터 → 서버 쿼리 전환 재검토 |
| B-04 | hold 누적 모니터링 | `release_matured_payouts` NOTICE 로그 외 운영 알림 강화 검토 |

---

## ❌ 포함하지 않는 항목

- 개발 TODO (새 기능, UI 개선 등)
- 이미 해결된 기술 부채 (migration 039~042로 닫힌 항목)
- 코드 리뷰 반영 완료 항목 (CR-01~04, UI-1~5)

---

*이 파일은 live 전환 완료 후 삭제하거나 OPERATIONS.md에 통합한다.*

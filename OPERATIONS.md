# AgentBid 운영 마감 문서

## 현재 상태 (2026-03-14)

### 🏷️ 태그 기준점

| 태그 | 커밋 | 내용 |
|---|---|---|
| `v0.1.0-pre-live` | `2930244` | MVP + 결제 E2E 완료 기준 |
| `v0.2.0-ui-complete` | `4aab8b5` | UI/UX 1차 마감 기준 ← **현재** |

---

### ✅ UI/UX 1차 마감 항목 (v0.2.0-ui-complete)

| 화면 | 상태 |
|---|---|
| 랜딩 | ✅ Hero + 정성형 value props + 데모 데이터 |
| 마켓 `/tasks` | ✅ 카드 그리드 + 카테고리 필터 + hover 힌트 |
| 작업 상세 `/tasks/[id]` | ✅ 2단 레이아웃 + 제출물 비교 + 원본 비공개 안내 |
| 대시보드 | ✅ owner/provider 분기 + payout 4상태 + 데모 fallback |
| Auth | ✅ emerald glow 배경 + returnUrl 복귀 |
| Stripe 온보딩 | ✅ 정산 흐름 + 수수료 안내 + 4상태 분기 |
| 공통 Nav | ✅ 모바일 햄버거 메뉴 + 이메일 truncate |

### ✅ 기술 안정성 항목

| 항목 | 상태 | migration |
|---|---|---|
| webhook atomic claim | ✅ `claim_webhook_event()` + `processing` 컬럼 | `012` |
| webhook 재실행 가드 | ✅ `paid` early return | — |
| auth hook `app_metadata.app_role` | ✅ hook에서 삽입 | `013` |
| `requireAuth()` role 원본 | ✅ `app_metadata.app_role ?? user_metadata.role` | — |
| task 404 분리 | ✅ `demo-*` → demo, UUID 실패 → 에러 화면 | — |
| 허수 통계 제거 | ✅ 정성형 value props 교체 | — |

---

---

## live Stripe 전환 체크리스트

> **블로커**: `acct_1TAQawJEx5NHulor` — `charges_enabled=false`, `details_submitted=false`  
> Adam이 [Stripe Dashboard](https://dashboard.stripe.com/account) 에서 비즈니스 정보 제출 완료 후 진행

전환 순서:
1. Stripe Dashboard → 계정 활성화 완료 (`charges_enabled=true` 확인)
2. Dashboard → Developers → API keys → Live secret key 발급 (`sk_live_...`)
3. Dashboard → Webhooks → **live mode** endpoint 추가
   - URL: `https://agentbid.vercel.app/api/webhooks/stripe`
   - 이벤트: `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`, `account.updated`
   - 신규 `whsec_live_...` 발급
4. Vercel env 교체 (재배포 자동 트리거)
   - `STRIPE_SECRET_KEY` = `sk_live_...`
   - `STRIPE_WEBHOOK_SECRET` = `whsec_live_...`
5. Stripe Connect — live mode Express 계좌는 test와 별개: provider 재onboarding 필요
6. 소액 실결제 smoke test 1회 후 확인

---

## 검증 완료 흐름 (test mode 기준)

### 결제 성공 E2E (2026-03-14)
| 항목 | 값 |
|---|---|
| card | `4242 4242 4242 4242` |
| task | `348e16b3` (Task Status E2E Test) |
| submission | `5c4a5a27` |
| order | `fff43312` → `status=paid` |
| task | → `status=completed` ✅ |
| submission | → `status=purchased` ✅ |
| payout | 자동 생성 (`status=pending`, `amount=8000`) ✅ |
| webhook | `checkout.session.completed` → DB 반영 ✅ |

### 결제 실패 E2E (2026-03-14)
| 항목 | 값 |
|---|---|
| card | `4000 0000 0000 0002` (decline) |
| order | `b0ca3910` → `status=cancelled` ✅ |
| pi | `pi_3TAiZnJEx5NHulor1tWbtGGD` |
| webhook | `payment_intent.payment_failed` → checkout_session fallback 매핑 ✅ |

### cancel E2E
- 뒤로 버튼 → `cancel_url = /tasks/{task_id}` redirect ✅

---

## cron 스케줄 현황

| job | schedule | 설명 |
|---|---|---|
| `close-expired-tasks` | `0 * * * *` (매시간) | reviewing 상태 task 마감 |
| `release-matured-payouts` | `0 2 * * *` (매일 02:00 UTC) | pending → released 전환 |
| `transfer-payouts` | `0 3 * * *` (매일 03:00 UTC) | released → Stripe Transfer → transferred |

### transfer-payouts 실행 흐름
- `pg_cron` → `pg_net.http_post` → Supabase Edge Function
- URL: `https://xlhiafqcoyltgyfezdnm.supabase.co/functions/v1/transfer-payouts`
- `verify_jwt=false` (내부 cron 전용)
- 로그 확인: Supabase Dashboard → Edge Functions → transfer-payouts → Logs
- 실패 시: 해당 payout skip (error 기록), 다음 실행(24h 후) 자동 재시도

---

## 운영 환경 설정 현황

| 항목 | 값 |
|---|---|
| 배포 URL | `https://agentbid.vercel.app` |
| GitHub | `commongits-hub/agentbid` (main) |
| Supabase | `xlhiafqcoyltgyfezdnm` |
| Stripe 모드 | **Test** (live 전환 전) |
| Stripe webhook ID | `we_1TAgezJEx5NHulorGJwyjPw6` |
| Stripe Connect | Express / Marketplace |
| NEXT_PUBLIC_APP_URL | `https://agentbid.vercel.app` |

---

## 테스트 데이터 삭제 증적 (2026-03-14)

삭제 전 DB 보유 데이터:

| 테이블 | 삭제 건수 | 대표 상태 예시 |
|---|---|---|
| tasks | 11건 | open / completed / draft |
| orders | 10건 | paid(7), cancelled(1), pending(2) |
| payouts | 6건 | pending(3), hold(1), released(1), transferred(1) |
| submissions | 11건 | purchased(6), submitted(5) |
| users (public) | 7건 | test 계정 전용 |
| agents | 2건 | stripe_onboarding_completed=false |

대표 ID 기록:
- 결제 성공 order: `fff43312-c249-4a82-b5c0-2b4509f3ce30` (paid, ₩10,000)
- 결제 실패 order: `b0ca3910-08c5-468f-b0ff-274a39e5afb7` (cancelled)
- released payout 샘플: `f4e05a70-6b55-4a94-8e28-3159b23b8779` (₩24,000)
- transferred payout 샘플: `0b30da36-daec-4180-a67b-1f177233ed3d` (₩24,000)
- Stripe Express test account: `acct_1TAfhlQrvuZfdGVn` (미완료, live 전환 시 재생성 필요)

삭제 후 최종 상태: **모든 테이블 0건** ✅

---

## Stripe Connect 주의사항

- **test mode Express 계좌** `acct_1TAfhlQrvuZfdGVn` — Stripe에 존재하나 DB 삭제됨
- live mode 전환 후 provider는 `/onboarding/stripe` 에서 **새로운 live 계좌** 생성 필요
- test / live Connect 계좌는 Stripe 내부적으로 완전 분리됨

---

## Known Issues (운영 전 잔여)

| 항목 | 내용 | 처리 |
|---|---|---|
| live Stripe 전환 | Stripe 계정 활성화 미완 | Adam이 Dashboard에서 직접 처리 |
| `adam-epiclions/agentbid` 레포 | 미사용 구 레포 | adam-epiclions 로그인 후 삭제 |
| Stripe Connect KR | live mode Express 계좌 KR 지원 여부 | live 전환 시 확인 |
| `tsc --noEmit` CI | 타입 체크 자동화 미적용 | 선택사항 |

---

## DB 보안 강화 기록 (migrations 015–021)

### 최신 커밋: `c21ad5d` (migration 021)

### 상태 전이표 (DB 코드 공식 버전 — migration 021 기준)

#### payouts
```
pending   → released  (release_matured_payouts cron)
pending   → hold      (release_matured_payouts — Stripe 미연결)
pending   → cancelled (cancel_payout_on_refund 트리거)
hold      → released  (unblock_hold_payouts_on_connect 트리거)
hold      → pending   (unblock_hold_payouts_on_connect 트리거)
hold      → cancelled (cancel_payout_on_refund 트리거)
released  → transferred (Edge Function: stripe transfer)
released  → cancelled   (cancel_payout_on_refund 트리거)
transferred → terminal (불변)
cancelled   → terminal (불변)
```
- `payouts.order_id UNIQUE` → order당 payout 최대 1개
- `transferred` payout은 환불 시에도 취소 불가 (별도 회수 프로세스 필요)

#### orders
```
pending          → paid             (webhook: checkout.session.completed)
pending          → failed           (webhook: payment_intent.payment_failed)
pending          → cancelled        (webhook: checkout.session.expired)
paid             → refund_requested (user API)
paid             → refunded         (webhook: charge.refunded 직행 허용)
refund_requested → refunded         (webhook: charge.refunded)
failed           → terminal
refunded         → terminal
cancelled        → terminal
```
- webhook 재처리 idempotency: 동일 상태 재설정 허용 (금융 컬럼 잠금은 유지)

### 알려진 한계

| 항목 | 현황 | 향후 |
|---|---|---|
| 부분환불(partial refund) | `refunded` 단일 상태 처리 (full/partial 미구분) | `partial_refunded` 상태 또는 `refund_amount` 컬럼 추가 필요 |
| payout cancel 사유 구분 | `hold_reason` 있으나 cancel 사유 없음 | `cancel_reason` 컬럼 추가 시 환불취소 vs 수동취소 구분 가능 |
| released → transferred 레이스 | 환불과 Edge Function 동시 실행 시 DB 레벨 잠금 처리. transferred는 환불 취소 불가 | Edge Function에서 payout status 선행 확인 로직 추가 권장 |
| emergency 수동 상태 수정 | trigger가 allowlist 강제. 비정상 상태 수동 수정은 migration 또는 직접 psql만 가능 | admin_override RPC 추가 가능 (별도 보안 검토 필요) |
| submissions 원문 마스킹 | API shaping 의존. DB 레벨 컬럼 마스킹 없음 | View 또는 RPC 방식으로 purchase gating 구현 필요 |
| stale JWT role | token 재발급 전까지 role 변경 미반영 (최대 1시간) | session invalidation 전략 별도 검토 필요 |

### advisory lock 상수
```
9182736455000001 → release_matured_payouts (pending payouts 전용)
9182736455000002 → unblock_hold_payouts_on_connect (hold payouts 전용)
```
두 함수는 status 기준 상호배타 row set을 처리하므로 lock 분리 안전.

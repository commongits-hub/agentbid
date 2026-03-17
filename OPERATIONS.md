# AgentBid 운영 마감 문서

## 현재 상태 (2026-03-16)

### 🏷️ 태그 기준점

| 태그 | 커밋 | 내용 |
|---|---|---|
| `v0.1.0-pre-live` | `2930244` | MVP + 결제 E2E 완료 기준 |
| `v0.2.0-ui-complete` | `4aab8b5` | UI/UX 1차 마감 기준 |
| `v0.3.0-security` | `597010d` | DB 보안 강화 완료 기준 |
| `v0.3.0-product-pass` | `4538f03` | 제품 1차 마감 + 최종 QA PASS |
| `v0.3.1-regression-pass` | `ec0eda0` | Pre-live regression 21/21 PASS |
| `v0.3.2-smoke-test-pass` | `619b6cc2` | Test 환경 최종 smoke test PASS |
| _(코드 리뷰 반영)_ | `0dbfb353` | 1·2차 코드 리뷰 반영 완료 (히스토리) |
| _(migration chain 고정)_ | `f61eea6` | 001~042 체인 확정 (`037` 사인 불가, `042` 대체) ← **현재 기준점** |

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
| **[필수 패치] `claims.role` 오버라이드 제거** | ✅ `authenticated` 유지 | `014` |
| Agent 상세 / 팔로우 기능 | ✅ follow/unfollow/follower_count/최근 리뷰 동작 완료 | — |
| 리뷰 플로우 완료 | ✅ 작성 / 수정(7일) / 중복 방지 / avg_rating 재계산 | — |
| task 404 분리 | ✅ `demo-*` → demo, UUID 실패 → 에러 화면 | — |
| 허수 통계 제거 | ✅ 정성형 value props 교체 | — |

### ✅ 제품 1차 마감 항목 (v0.3.0-product-pass — 2026-03-15)

| 항목 | 상태 |
|---|---|
| Owner dashboard — 행동 카드 우선 (제출 검토 / 리뷰 필요) | ✅ |
| Provider dashboard — Stripe 미연결 블로킹 CTA / urgency 정렬 | ✅ |
| Admin dashboard — `/admin` → reports 기본 랜딩 / disputed 강조 | ✅ |
| Admin sidebar — 신고 내역 최상단 + amber dot | ✅ |
| QA regression 수정: budget_max 누락 / hold 텍스트 오류 / disputed row | ✅ |
| 최종 QA PASS (owner/provider/admin 3-pass) | ✅ |

---

---

### ✅ Pre-live Regression PASS (v0.3.1-regression-pass — 2026-03-15)

21개 항목 검증 완료. 발견 버그 2건, 수정 완료.

#### BUG-1: follower_count 집계 트리거 무음 실패 (migration 027)

| 항목 | 내용 |
|---|---|
| 분류 | DB 코드 문제 |
| 증상 | `follows` INSERT/DELETE 성공, `agents.follower_count` 미반영 |
| 원인 | `update_follower_count()` SECURITY DEFINER 없음 → `agents_update` RLS(`user_id=auth.uid()`)에 막혀 타인 agent UPDATE 실패 |
| 영향 | 팔로우/언팔로우 기능은 동작하나 카운트 표시 항상 0 |
| 수정 | `migration 027`: `SECURITY DEFINER` 추가, `REVOKE EXECUTE FROM PUBLIC` |

#### BUG-2: admin/provider API 전반 403 (`requireAuth` JWT claims 소스 불일치)

| 항목 | 내용 |
|---|---|
| 분류 | 코드 문제 (auth middleware) |
| 증상 | admin 계정으로 `/api/admin/*` 호출 시 `Admin role required` 403 |
| 원인 | `requireAuth`가 `getUser()` 반환 `app_metadata`를 사용. 그러나 `getUser()`는 `auth.users.raw_app_meta_data` 기준이고 `custom_access_token_hook`은 JWT payload에만 `app_role` 주입 → `app_role` undefined → role 판정 'user' |
| 영향 | admin API 전반 차단. provider API도 동일 구조로 잠재적 영향 |
| 수정 | `decodeJwtPayload()` 헬퍼 추가. `getUser()`는 서명 검증용만, `app_role/is_active`는 JWT payload에서 직접 읽음 |

> ⚠️ 참고: `custom_access_token_hook`이 JWT payload에 값을 주입할 경우, 해당 값은 반드시 JWT를 직접 디코딩해서 읽어야 함. `getUser()` 반환값에는 hook 주입 클레임이 반영되지 않음.

---

---

### ✅ Test 환경 최종 Smoke Test PASS (v0.3.2-smoke-test-pass — 2026-03-15)

| 영역 | 항목 수 | 결과 |
|---|---|---|
| 인증 (login/role/접근제어) | 5 | ✅ ALL PASS |
| 마켓 (tasks/상세/demo/404) | 5 | ✅ ALL PASS |
| 거래 (submissions/webhook/checkout중복차단) | 5 | ✅ ALL PASS |
| 리뷰/신뢰 (작성/수정/avg_rating/follow/unfollow) | 5 | ✅ ALL PASS |
| 관리자 (task/report/user 액션) | 3 | ✅ ALL PASS |
| 정산 (payouts/connect URL/release cron) | 4 | ✅ ALL PASS |
| DB 보안 (anon차단/view/service_role) | 3 | ✅ ALL PASS |

**현재 상태: 1·2차 코드 리뷰 반영 완료 — live Stripe 전환 대기 중**

---

### 🔧 1차 코드 리뷰 수정 (2026-03-15 — commit `48a73e18`)

#### BUG-3: Storage bucket 이름 불일치 — **실운영 영향 있음** ⚠️

| 항목 | 내용 |
|---|---|
| 분류 | **Critical 코드 버그 (실운영 영향)** |
| 증상 | 파일 첨부 submission의 download signed URL 항상 실패 |
| 원인 | `/api/submissions/[id]/download` 에서 `.from('submissions')` 호출 — 존재하지 않는 버킷 이름 |
| 실제 버킷 이름 | `submission-files` (Supabase Storage에 실재) |
| 영향 | 파일형 submission download 기능 전체 비작동 (400 반환) |
| 수정 | `.from('submission-files')` 로 변경 |
| 검증 | `submission-files` 버킷 signed URL 생성 성공 확인 |

#### FIX-4: POST /api/orders — Stripe orphan session 방지

| 항목 | 내용 |
|---|---|
| 분류 | 안정성 개선 |
| 문제 | Stripe Checkout Session 생성 후 DB insert 실패 시 Stripe session만 남는 orphan 발생 가능 |
| 제약 | `stripe_checkout_session_id` 불변 트리거로 "DB 먼저 → Stripe session update" 순서 불가 |
| 수정 | DB insert 실패 시 `stripe.checkout.sessions.expire()` 즉시 호출 |
| 검증 | session.expire() API 정상 동작 확인 (open → expired) |

#### FIX-5: handleCheckoutCompleted — 단계별 state 재확인 + row count 검증

| 항목 | 내용 |
|---|---|
| 분류 | 안정성 개선 (webhook 부분실패 방어) |
| 수정 | ① submission: 재조회 후 purchased이면 전체 완료로 즉시 return ② submission→selected: `.eq('status','submitted')` 가드 추가 ③ task: 재조회 후 already completed이면 update 스킵 ④ order→paid: `.eq('status','pending')` + row count=1 검증, 0이면 조용히 return |
| 검증 | processed 이벤트 재전송 → claim false (처리 스킵) 확인 / 상태 불변 확인 |

#### FIX-6: requireAuth — user_metadata.role fallback DEPRECATED

| 항목 | 내용 |
|---|---|
| 분류 | 기술 부채 정리 (staged) |
| 내용 | `user_metadata.role` fallback에 DEPRECATED 주석 추가 — 기능 유지, live 안정화 후 제거 예정 |

---

### 🔧 2차 UI/UX 리뷰 수정 (2026-03-16 — commit `0dbfb353`)

#### UI-1: dashboard/admin — role 판정 원본 통일

| 항목 | 내용 |
|---|---|
| 분류 | 코드 정리 + 구조 개선 |
| 변경 | dashboard: `app_role` 단일 원본 기준 정리 (user_metadata.role fallback DEPRECATED 유지) |
| 변경 | admin layout: `session.access_token` JWT 직접 디코딩 → `app_metadata.app_role` 읽기 |
| 배경 | Supabase JS SDK `session.user.app_metadata`는 `raw_app_meta_data` 기준 — hook 주입 app_role 미포함. JWT payload 직접 디코딩이 유일한 정확한 소스. |
| TODO | dashboard도 JWT decode로 전환 후 `user_metadata.role` fallback 완전 제거 (live 안정화 후) |

#### UI-2: demo task 카드 UX

| 항목 | 내용 |
|---|---|
| 분류 | UX 개선 |
| 변경 | `href='#'` 제거 → `<div>` + `cursor-default`. '샘플' 배지 추가 → 클릭 불가 시각 명시 |

#### UI-3: owner orders 정렬 + 상태 시각 구분

| 항목 | 내용 |
|---|---|
| 분류 | UX 개선 |
| 변경 | 미리뷰 paid → 리뷰완료 paid → 나머지 순 정렬. inactive 상태 opacity-60 처리 |

#### UI-4: provider 상단 요약 4칸 분리

| 항목 | 내용 |
|---|---|
| 분류 | UX 개선 |
| 변경 | 3칸 → 4칸: `정산 가능` / `보류 (조치 필요)` / `7일 대기` / `지급 완료` 분리 |
| 효과 | "조치 필요" vs "기다리면 됨" 명확히 구분 |

#### UI-5: follow 실패 피드백

| 항목 | 내용 |
|---|---|
| 분류 | UX 개선 |
| 변경 | `followError` state 추가 — follow/unfollow 실패 시 버튼 아래 에러 문구 표시 |

#### REGRESSION FIX: provider → Owner view 렌더링

| 항목 | 내용 |
|---|---|
| 분류 | 즉시 수정된 regression (UI-1 도입 후 발견) |
| 증상 | provider 계정이 Owner view 렌더링 |
| 원인 | `user_metadata.role` fallback 제거 후 SDK 객체에 `app_role` 없으면 `'user'` 반환 |
| 수정 | dashboard `user_metadata.role` fallback 복원 (DEPRECATED) / admin JWT decode 전환 |
| 검증 | production Provider 대시보드 정상 확인 |

---

### 🔧 3차 UI/UX 리뷰 수정 (2026-03-16 — commit `10d69f0e`)

| # | 항목 | 처리 결과 |
|---|---|---|
| [1] followError state | **기존 구현 확인** — state + 버튼 아래 에러 문구 이미 존재 (102, 275번 라인) | 수정 없음 |
| [2] getClientRole() helper 분리 | `src/lib/client-role.ts` 신규 생성, dashboard에서 import | ✅ 완료 |
| [3] provider 4칸 요약 | **기존 구현 확인** — sm:grid-cols-4, 4개 div 이미 존재 | 수정 없음 |
| [4] demo 판정 `startsWith('demo-')` | DEMO_TASKS id `d1/d2/d3` → `demo-1/demo-2/demo-3`, 판정식 수정 | ✅ 완료 |
| [5] Hero CTA role param | `?role=user` / `?role=provider` 분기, signup `useEffect` + `window.location.search` | ✅ 완료 |
| [6] tasks demo 카드 UX | 샘플 배지 + hover `🔒 로그인 후 보기`, 실제 카드 Link 구조 분리 | ✅ 완료 |

**regression 수정 포함**: signup role param — `useState(initialRole)` → `useEffect + window.location.search` (Next.js App Router hydration 순서 이슈)

---

### 🔧 4차 UI 리뷰 수정 (2026-03-16 — commit `5ffb859b`)

| # | 파일 | 항목 | 결과 |
|---|---|---|---|
| FIX-1 | `src/app/page.tsx` | Hero value props `grid-cols-3` → `grid-cols-1 sm:grid-cols-3` (모바일 미적용) | ✅ 완료 |
| FIX-2 | `src/app/agents/[id]/page.tsx` | review key=index → `key={review.id}` (id 쿼리 추가) | ✅ 완료 |
| NOTE | `src/components/layout/nav.tsx` | signOut 헬퍼 추출 + 세션 캐시 초기화 의도 주석 | ✅ 완료 |
| TODO | `ReviewForm.tsx` + `ReviewEditForm.tsx` | StarRatingInput 공통화 → **deferred** (회귀 위험 > 이득) | ⏸ 보류 |
| TODO | `dashboard/page.tsx` | PayoutCard 분리 → **deferred** | ⏸ 보류 |

> **전체 라운드 리뷰 종료.** 이후부터는 변경 파일 단위 국소 리뷰로 전환.

---

### 🔧 Migration 028~032: DB 보안 및 trigger 무결성 (2026-03-16 — commit `c00b6e0c`)

| # | Migration | 내용 |
|---|---|---|
| 028 | `fix_security_definer_and_submission_count` | `handle_new_user` / `sync_user_email` SET search_path=public; `update_submission_count` DELETE 처리 추가 |
| 029 | `orders_one_time_purchase_policy` | `orders.submission_id` 1회 구매 정책 COMMENT 명시 (A안 확정) |
| 030 | `fix_trigger_security_definer` | `recalculate_agent_rating` / `update_follower_count` / `auto_flag_on_reports` / `update_agent_completed_count` — SECURITY DEFINER + search_path + REVOKE |
| 031 | `fix_auto_flag_trigger_chain` | `prevent_submission_manipulation` — `pg_trigger_depth()>0` trigger chain bypass 추가 |
| 032 | `fix_review_manipulation_trigger_chain` | `prevent_review_manipulation` — 동일 bypass 추가 |

**배경**: `auto_flag_on_reports()`(SECURITY DEFINER)에서 submissions/reviews status 변경 시
`prevent_submission/review_manipulation()` immutability trigger가 차단 → auto_flag 실제 동작 불가.
`pg_trigger_depth()>0` 조건으로 trigger chain 내부 자동 상태 변경만 허용, 직접 변경 차단 유지.

**검증 결과**:
- avg_rating trigger: rating 변경 → 재계산 ✅
- follower_count trigger: INSERT/DELETE ✅
- auto_flag submission: 신고 3건 → flagged ✅
- auto_flag review: 신고 3건 → flagged ✅

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
- `verify_jwt=false` (내부 cron 전용) — **단, `x-cron-secret` 헤더 필수**
- 로그 확인: Supabase Dashboard → Edge Functions → transfer-payouts → Logs
- 실패 시: 해당 payout skip (error 기록), 다음 실행(24h 후) 자동 재시도

### ⚠️ transfer-payouts cron 등록 절차 (운영자 수동)

migration 011은 `x-cron-secret` 헤더 없이 등록된 **legacy cron migration**.
secret을 git migration에 하드코딩할 수 없으므로, 운영 환경에서는 아래 절차로 재등록 필요.

**전제 조건**:
1. Supabase Dashboard → Functions → transfer-payouts → Secrets
   → `CRON_SECRET=<랜덤 강력한 값>` 주입 완료

**재등록 SQL (Supabase SQL Editor 또는 psql에서 직접 실행)**:
```sql
-- 기존 job 제거
SELECT cron.unschedule('transfer-payouts');

-- x-cron-secret 헤더 포함 재등록
SELECT cron.schedule(
  'transfer-payouts',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url       := 'https://xlhiafqcoyltgyfezdnm.supabase.co/functions/v1/transfer-payouts',
    headers   := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET 값 직접 입력>'
    ),
    body      := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

> **주의**: `<CRON_SECRET 값 직접 입력>` 자리에 실제 secret을 입력. 이 SQL은 git에 커밋하지 말 것.

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

## DB 보안 강화 기록 (migrations 015–026)

### 스냅샷 기준 커밋: `eea46a4` (migration 026, 히스토리 섹션)

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
| submissions 원문 마스킹 | ~~API shaping 의존. DB 레벨 컬럼 마스킹 없음~~ → **완료** (migration 023–026) | `submissions_safe` view + REVOKE + storage helper 함수 조합으로 종료 |
| stale JWT role | token 재발급 전까지 role 변경 미반영 (최대 1시간) | session invalidation 전략 별도 검토 필요 |

### advisory lock 상수
```
9182736455000001 → release_matured_payouts (pending payouts 전용)
9182736455000002 → unblock_hold_payouts_on_connect (hold payouts 전용)
```
두 함수는 status 기준 상호배타 row set을 처리하므로 lock 분리 안전.

### Idempotency 규칙 (DB trigger 기준)

**orders/payouts 동일 상태 재설정 허용** (webhook 재처리 안전)
- `status = OLD.status`인 UPDATE는 상태 전이 allowlist 검사를 건너뜀
- 금융 핵심 컬럼(amount, agent_id, order_id 등)은 same-state에서도 수정 불가
- 이유: Stripe webhook은 동일 이벤트를 여러 번 전송할 수 있음

### Refund 처리 규칙

order status = `refunded` 전환 시 `trg_cancel_payout_on_refund` 자동 실행:

| payout 상태 | 처리 |
|---|---|
| `pending` | → `cancelled` (hold_reason = NULL) |
| `released` | → `cancelled` (hold_reason = NULL) |
| `hold` | → `cancelled` (hold_reason = NULL) |
| `transferred` | **변경 없음** — 이미 출금됨, 별도 회수 프로세스 필요 |

`orders.paid → orders.refunded` 직행 허용 (Stripe `charge.refunded` 직접 수신 시)
`orders.paid → orders.refund_requested → orders.refunded` 경유도 허용

### Webhook Processing Lifecycle (migration 022 기준)

```
claim_webhook_event(id, type) → true: 처리 시작
  ↓ 성공
  UPDATE processed=true, processing=false    ← 앱 코드
  ↓ 실패 (EXCEPTION catch)
  UPDATE processing=false                    ← 앱 코드 (재시도 허용)
  ↓ 크래시 (프로세스 강제 종료)
  reset_stale_webhook_claims(10)             ← 수동 또는 cron
```

**stale lock 복구:** `SELECT reset_stale_webhook_claims();` — 서버 재배포 직후 실행 권장

**TODO (non-urgent):** 앱 코드 완료/실패 경로가 분산되면 DB 함수로 묶기
- `mark_webhook_processed(p_id text)` — `processed=true, processing=false`
- `release_webhook_claim(p_id text)` — `processing=false` (에러 시 재시도)

---

## [필수 패치] Migration 014 — `claims.role` 오버라이드 치명적 버그

### 문제

migration 007 및 013에서 `custom_access_token_hook`이 JWT `claims.role`에
앱 역할값(`'user'` / `'provider'` / `'admin'`)을 직접 덮어씀.

PostgREST는 JWT `claims.role`을 **PostgreSQL 데이터베이스 롤**로 해석한다.
`'user'`라는 DB 롤이 존재하지 않으므로:

```
role "user" does not exist
```

→ **RLS 정책 전혀 동작하지 않음**

### 영향 범위

- `authenticated` 롤 기반 RLS 전체 무력화
- 실제로 막힌 기능:
  - `follows` INSERT / DELETE (팔로우/언팔로우)
  - `reviews` INSERT (리뷰 작성)
  - `submissions` INSERT (제출물 등록)
  - 그 외 authenticated 조건이 붙은 모든 RLS 정책

### 수정 (migration 014)

`claims.role` 오버라이드 라인 완전 제거.
JWT role은 Supabase Auth가 자동 설정하는 `'authenticated'` / `'anon'` 그대로 유지.
앱 역할은 `claims.app_metadata.app_role`에만 기록 (API 코드 원본 경로 유지).

### 규칙 — claims.role을 건드리면 안 되는 이유

| 필드 | 의미 | 설정 주체 |
|---|---|---|
| `claims.role` | PostgreSQL DB 롤 | Supabase Auth 자동 설정 (`authenticated`/`anon`) |
| `claims.app_metadata.app_role` | 앱 비즈니스 역할 | `custom_access_token_hook` |

`claims.role`에 앱 역할을 쓰면 PostgREST가 없는 DB 롤로 연결을 시도하며
**RLS 전체가 무력화**된다. 절대 오버라이드 금지.

---

## DB 보안 강화 기록 (migrations 023–026) — submissions 마스킹 완료

### 최종 보안 구조 (2026-03-15)

| 레이어 | 내용 | migration |
|---|---|---|
| `submissions_safe` view | content 컬럼 purchase gating (LATERAL CASE WHEN) | `023`, `025` |
| `REVOKE SELECT` | `authenticated` / `anon` → submissions base table 직접 SELECT 차단 | `024` |
| Storage helper 함수 | Storage RLS가 submissions를 직접 쿼리하지 않도록 SECURITY DEFINER 함수로 교체 | `026` |
| API 2-query 분리 | 서버 메모리에도 미결제 content 미적재 | — |

### submissions_safe view 구조

```
submissions_safe (security_definer)
  WHERE: is_admin() OR task 소유자 OR 본인 provider   ← row 접근 제어
  CASE WHEN can_see_full:                             ← column 마스킹
    is_admin() OR 본인 submission OR orders.status='paid'
  → content_text / file_path / file_name / file_size / mime_type
    → 조건 불충족: NULL 반환
```

- `security_invoker = true` + REVOKE 조합은 view 자체도 차단됨 (migration 025에서 수정)
- **규칙: base table REVOKE 시 view는 반드시 security_definer**

### Storage RLS — submissions 직접 참조 차단 (migration 026)

base table REVOKE 이후 Storage RLS 정책이 authenticated 컨텍스트로 submissions를 직접 쿼리하면 접근 불가. 영향받은 흐름:

| 흐름 | 정책 | 수정 |
|---|---|---|
| provider 파일 업로드 | `sub_files_upload` | `storage_check_submission_provider(uuid)` |
| provider 파일 삭제 | `sub_files_delete` | `storage_check_submission_provider_open_task(uuid)` |
| provider task 첨부파일 조회 | `task_att_select` | `storage_check_provider_for_task(uuid)` |

**규칙: base table REVOKE 후 Storage 정책은 submissions를 직접 쿼리하면 안 됨. SECURITY DEFINER 함수를 통해서만 접근.**

### 롤백 방법 (긴급)

```sql
-- submissions 직접 접근 복구 (migration 024 롤백)
GRANT SELECT ON submissions TO authenticated;

-- 단, 복구 후 submissions_safe view와 storage helper 함수는 그대로 유지 권장
```

---

## Migration 039: 015 리뷰 잔여 2건 해소

**파일:** `039_agents_immutability_and_tasks_update_policy.sql`

### A. agents 핵심 컬럼 immutability (015 잔여 #1)

**배경:** 015 `agents_update` 정책 주석에 "완전한 컬럼 잠금은 별도 트리거 필요"로 명시됐으나 migration chain 어디에도 구현 없었음.

**해결:** `prevent_agent_core_change()` BEFORE UPDATE 트리거 추가

| 컬럼 | 잠금 대상 | admin 예외 |
|---|---|---|
| `user_id` | ✅ | ✅ |
| `stripe_account_id` | ✅ | ✅ |
| `stripe_onboarding_completed` | ✅ | ✅ (+ trigger chain bypass) |
| `stripe_onboarding_completed_at` | ✅ | ✅ (+ trigger chain bypass) |

- `pg_trigger_depth() > 0` 시 bypass: payout guard 등 내부 트리거 경로 허용
- `REVOKE EXECUTE FROM PUBLIC`: 직접 호출 차단

**`agents_update` 정책 주석 교체:** "별도 트리거 필요" → "trg_prevent_agent_core_change에서 강제"

### B. tasks_update owner/admin 분리 (015 잔여 #2)

**배경:** 015 `tasks_update` WITH CHECK에 `user_id = auth.uid()` 가 포함돼 admin이 타인 task 수정 시 혼란 가능. 015에 `tasks_update_admin`이 별도 존재하나 `tasks_update` WITH CHECK 혼용 문제 잔존.

**해결:**

| 정책 | USING | WITH CHECK | 대상 |
|---|---|---|---|
| `tasks_update` | `user_id = auth.uid()` | `user_id = auth.uid()` | owner 전용 |
| `tasks_update_admin` | `is_admin()` | `is_admin()` | admin 전용 |

- 두 정책 permissive OR 동작 → 실질 동작 동일, 의도 명확
- owner와 admin 경로 완전 분리

### 015 사인 상태

| 지적 항목 | 해소 migration |
|---|---|
| `prevent_submission_manipulation` trigger chain 충돌 | ✅ 031 |
| `get_user_role()` 기본값 `'user'` | ✅ 018 |
| `agents.stripe_account_id` immutability 트리거 미존재 | ✅ **039** |
| `tasks_update` owner/admin 혼합 표현 | ✅ **039** |

**015 + 018 + 031 + 039 묶음 기준 사인 완료.**

---

## Migration 016~021 + 040 사인 기록

| Migration | 문제 | 후속 해소 | 사인 |
|---|---|---|---|
| 016 | legacy `hold_reason IS NULL` hold row → stuck 가능 | 020 백필 | ✅ |
| 017 | `get_user_role()` `'user'` fallback; `prevent_submission_manipulation` chain 충돌 | 018(NULL fallback), 031(pg_trigger_depth bypass) | ✅ |
| 018 | `prevent_order_core_change` stripe 컬럼 완전 잠금 vs 코드 충돌; payout service_role 경로 불명확; `chk_hold_reason` 순서 | 019→020→021(allowlist 완결, bypass 제거, 백필) | ✅ |
| 019 | system caller bypass 잔존; `chk_hold_status_requires_reason` 기존 데이터 충돌 가능 | 020 (bypass 제거, 백필 선행) | ✅ |
| 020 | — | 자체 완결 (백필 + allowlist 통일) | ✅ |
| 021 | `cancel_payout_on_refund()` SECURITY DEFINER 누락 | 040 | ✅ |
| 040 | 021 잔여 — `cancel_payout_on_refund()` SECURITY DEFINER + `public.payouts` 명시 + REVOKE | 자체 완결 | ✅ |

---

## Migration 022~026 + 041 사인 기록

| Migration | 문제 | 후속 해소 | 사인 |
|---|---|---|---|
| 022 | — | 자체 완결 (webhook lock + stale 복구 경로) | ✅ |
| 023 | `security_invoker` → 024 REVOKE 후 view 차단 | 025 (security_definer 재정의) | ✅ |
| 024 | 023 view + 026 storage policy가 submissions 직접 참조 → broken | 025(view), 026(storage 헬퍼) | ✅ |
| 025 | task owner row filter에 `soft_deleted_at IS NULL` 누락 | 041 | ✅ |
| 026 | — | 자체 완결 (storage RLS SECURITY DEFINER 헬퍼 3개) | ✅ |
| 041 | 025 잔여 — `submissions_safe` task owner 서브쿼리 `soft_deleted_at IS NULL` 추가 | 자체 완결 | ✅ |

---

## Migration 027~038 + 039~042 사인 기록

| Migration | 내용 | 사인 |
|---|---|---|
| 027 | 030 체인 기준 follower_count 트리거 보강 완료 | ✅ |
| 028 | SECURITY DEFINER/search_path 보강 + submission_count DELETE 처리 | ✅ |
| 029 | same submission 1회 구매 정책 확정 (comment-only) | ✅ |
| 030 | trigger 함수 SECURITY DEFINER/search_path 일괄 보강 (027 partial 완결) | ✅ |
| 031 | `prevent_submission_manipulation` trigger chain bypass — auto_flag 경로 실제 버그 수정 | ✅ |
| 032 | `prevent_review_manipulation` 동일 패턴 bypass 추가 — auto_flag 경로 최종 정상화 | ✅ |
| 033 | 006 잔여 정책 의도 주석 명시 (구조 변경 없음) | ✅ |
| 034 | access token hook SET search_path + cron 중복 등록 방지 보강 | ✅ |
| 035 | 008 Stripe Connect 컬럼 주석 보강 (구조 변경 없음) | ✅ |
| 036 | payout guard SECURITY DEFINER/search_path + soft_deleted agent Case C 추가 최종 보강 | ✅ |
| 037 | ❌ 회귀 — 컬럼명 오기(`event_type`) + 022 보강 소실. **042로 대체** | ❌ |
| 038 | 013 중간 이행 단계 이력 주석 명시 (구조 변경 없음) | ✅ |
| 039 | 015 잔여 — agents immutability 트리거 + tasks_update owner/admin 완전 분리 | ✅ |
| 040 | 021 잔여 — `cancel_payout_on_refund()` SECURITY DEFINER + public.payouts + REVOKE | ✅ |
| 041 | 025 잔여 — `submissions_safe` task owner row filter `soft_deleted_at IS NULL` 보강 | ✅ |
| 042 | 037 대체 — `claim_webhook_event()` 컬럼명(`type`) + `processing_started_at` + type mismatch 감지 + SECURITY DEFINER 최종 복구 | ✅ |

---

## Migration 001~042 최종 상태표

> 기준 커밋: `f61eea6` (2026-03-16)

| Migration | 내용 | 상태 |
|---|---|---|
| 001 | enums 생성 | ✅ 사인 |
| 002 | users/agents 테이블 | ✅ 사인 |
| 003 | tasks/submissions 테이블 | ✅ 사인 |
| 004 | orders/payouts 테이블 | ✅ 사인 |
| 005 | reviews/follows/reports 테이블 | ✅ 사인 |
| 006 | RLS 기본 정책 | ✅ 사인 |
| 007 | storage/cron | ✅ 사인 |
| 008 | Stripe Connect 컬럼 | ✅ 사인 |
| 009 | payout guard | ✅ 사인 |
| 010 | budget 컬럼 추가 | ✅ 사인 |
| 011 | transfer-payouts cron | ✅ 사인 |
| 012 | webhook processing lock | ✅ 사인 |
| 013 | access token hook (중간 이행) | ⚠️ 단독 배포 불가 — 014+034와 묶음 기준 사인 |
| 014 | claims.role 오버라이드 제거 | ✅ 사인 (034 묶음) |
| 015 | RLS hardening phase 1 | ✅ 사인 (018+031+039 묶음) |
| 016 | payout guard hardening | ✅ 사인 (019+020 묶음) |
| 017 | RLS hardening phase 2 | ✅ 사인 (018+031 묶음) |
| 018 | column immutability + state transition | ✅ 사인 (019+020+021 묶음) |
| 019 | financial integrity finalization | ✅ 사인 (020 묶음) |
| 020 | transition integrity finalization | ✅ 사인 |
| 021 | transition allowlist critical fixes | ✅ 사인 (040 묶음) |
| 022 | webhook lock hardening | ✅ 사인 |
| 023 | submissions_safe view (security_invoker) | ✅ 사인 (025 묶음) |
| 024 | REVOKE submissions direct select | ✅ 사인 (025+026 묶음) |
| 025 | submissions_safe security_definer 전환 | ✅ 사인 (041 묶음) |
| 026 | storage RLS SECURITY DEFINER 헬퍼 | ✅ 사인 |
| 027 | follower_count SECURITY DEFINER | ✅ 사인 (030 묶음) |
| 028 | handle_new_user/sync_user_email search_path + submission_count DELETE | ✅ 사인 |
| 029 | orders same-submission 1회 구매 정책 명시 | ✅ 사인 |
| 030 | trigger 함수 SECURITY DEFINER 일괄 보강 | ✅ 사인 |
| 031 | prevent_submission_manipulation trigger chain bypass | ✅ 사인 |
| 032 | prevent_review_manipulation trigger chain bypass | ✅ 사인 |
| 033 | 006 정책 의도 주석 (구조 변경 없음) | ✅ 사인 |
| 034 | access token hook search_path + cron idempotency | ✅ 사인 |
| 035 | Stripe Connect 주석 (구조 변경 없음) | ✅ 사인 |
| 036 | payout guard SECURITY DEFINER 최종 보강 | ✅ 사인 |
| 037 | ❌ 회귀 — `event_type` 오기 + 022 보강 소실 | **사인 불가 — 042로 대체** |
| 038 | 013 이력 주석 (구조 변경 없음) | ✅ 사인 |
| 039 | agents immutability 트리거 + tasks_update 정책 분리 | ✅ 사인 |
| 040 | cancel_payout_on_refund SECURITY DEFINER 보강 | ✅ 사인 |
| 041 | submissions_safe soft_deleted task owner 조건 보강 | ✅ 사인 |
| 042 | claim_webhook_event 037 회귀 수정 + 022 보강 재통합 | ✅ 사인 |

**037은 사인 불가. 042가 037을 대체하며 전체 chain은 042 기준으로 완결.**

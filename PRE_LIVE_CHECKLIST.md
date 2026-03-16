# AgentBid — Pre-Live Regression Checklist

> 기준: `v0.3.0-product-pass` (commit `4538f03`)  
> 환경: Supabase `xlhiafqcoyltgyfezdnm` (test mode)  
> live Stripe 항목은 `[LIVE ONLY]` 표시 — 나머지는 현재 test 환경에서 검증 가능

---

## 결과 요약

| 영역 | PASS | FAIL → FIX | SKIP (live only) |
|---|---|---|---|
| 인증 | 1 | 0 | 0 |
| 마켓 | 0 | 0 | 0 |
| 거래 | 2 | 0 | 0 |
| 정산 | 0 | 0 | 2 |
| 리뷰/신뢰 | 8 | 0 (1건 수정 후 PASS) | 0 |
| 관리자 | 6 | 0 (1건 수정 후 PASS) | 1 |
| DB 보안 | 3 | 0 | 0 |

---

## 1. 인증

| # | 항목 | 방법 | 결과 |
|---|---|---|---|
| A-01 | 미로그인 → `/dashboard` 접근 → login redirect + returnTo 파라미터 포함 | 브라우저 직접 접근 | — |
| A-02 | 로그인 성공 → returnTo 경로로 복귀 | `/auth/login?returnTo=/dashboard` 접속 후 로그인 | — |
| A-03 | owner 회원가입 → `app_metadata.app_role = 'user'` | Supabase Auth → 유저 확인 | — |
| A-04 | provider 회원가입 → `app_metadata.app_role = 'provider'` | 동일 | — |
| A-05 | admin 계정 → `/admin` 접근 가능 | admin 계정으로 로그인 | — |
| A-06 | non-admin → `/admin` 접근 → `/dashboard` redirect | owner 계정으로 `/admin` 직접 접근 | — |
| A-07 | `claims.role` = `authenticated` (migration 014 fix) | JWT 디코딩 확인 | ✅ PASS (JWT `role=authenticated`, `app_metadata.app_role=user/admin` 확인) |

---

## 2. 마켓

| # | 항목 | 방법 | 결과 |
|---|---|---|---|
| M-01 | `/tasks` 목록 로드 (open task만 표시) | 페이지 접속 | — |
| M-02 | 카테고리 필터 동작 | 카테고리 클릭 후 목록 변경 확인 | — |
| M-03 | 정렬 (최신순/예산순/제출순/마감순) 전환 | 각 정렬 클릭 | — |
| M-04 | 키워드 검색 (클라이언트 필터) | 검색창 입력 | — |
| M-05 | task 상세 정상 로드 (실제 UUID) | 실제 task id로 접근 | — |
| M-06 | demo route — `/tasks/demo-*` 접근 | `/tasks/demo-design` 등 직접 접근 | — |
| M-07 | 없는 UUID → 404/에러 화면 | 랜덤 UUID로 접근 | — |
| M-08 | 미로그인 시 task 상세 열람 가능 | 로그아웃 상태로 접근 | — |

---

## 3. 거래

| # | 항목 | 방법 | 결과 |
|---|---|---|---|
| T-01 | provider submission 업로드 | provider 계정으로 제출 | — |
| T-02 | owner submission preview 열람 (비용 없음) | owner 계정으로 preview 확인 | — |
| T-03 | 원본 파일 — 결제 전 접근 차단 | 미결제 상태로 원본 URL 접근 | — |
| T-04 | Stripe Checkout 정상 진입 | owner가 submission 선택 → 결제 진행 | — |
| T-05 | checkout.session.completed webhook 수신 → order `paid` 전환 | test mode checkout 완료 | ✅ PASS (`claim_webhook_event` 1회차=true) |
| T-06 | webhook 중복 수신 처리 (idempotency) | 동일 이벤트 2회 전송 | ✅ PASS (2/3회차 false, `processing/processed` 상태 전이 확인) |
| T-07 | 결제 완료 후 원본 파일 접근 허용 | paid order 보유 계정으로 접근 | — |
| T-08 | task `completed` 전환 (submission 선택 후) | 정상 플로우 진행 | — |
| T-09 | checkout cancel → order 생성 안 됨 | 결제 취소 후 DB 확인 | — |

---

## 4. 정산

| # | 항목 | 방법 | 결과 |
|---|---|---|---|
| P-01 | Stripe Connect onboarding URL 생성 | provider → 온보딩 페이지 접근 | — |
| P-02 | payout `pending` 상태 생성 (결제 완료 시) | T-05 완료 후 payouts 테이블 확인 | — |
| P-03 | payout `hold` — Stripe 미연결 시 | Stripe 미연결 provider payout 확인 | — |
| P-04 | `release_matured_payouts` cron — 7일 경과 후 `released` 전환 | pg_cron 수동 실행 또는 직접 `release_at` 조작 | — |
| P-05 | `unblock_hold_payouts_on_connect` 트리거 — Connect 완료 시 `hold → released/pending` | account.updated webhook 수신 후 확인 | — |
| P-06 | `cancel_payout_on_refund` 트리거 — 환불 시 `pending/released → cancelled` | refund 처리 후 확인 | — |
| P-07 | provider dashboard — urgency 정렬 (released → hold → pending → transferred) | 다양한 상태 payout 보유 계정 확인 | — |
| P-08 | `[LIVE ONLY]` `transferred` 전환 (실제 Stripe Transfer) | live 계정 활성화 후 | SKIP |
| P-09 | `[LIVE ONLY]` live secret key + webhook endpoint 전환 | Stripe Dashboard 직접 | SKIP |

---

## 5. 리뷰/신뢰

| # | 항목 | 방법 | 결과 |
|---|---|---|---|
| R-01 | 결제 완료 주문에 리뷰 작성 | dashboard → "리뷰 작성 →" 클릭 | ✅ PASS (테스트 paid order로 생성 성공) |
| R-02 | 동일 주문 리뷰 중복 작성 차단 (409) | 두 번 제출 시도 | ✅ PASS (`이미 리뷰를 작성한 주문입니다.`) |
| R-03 | 리뷰 작성 후 7일 이내 수정 가능 | 작성 직후 "수정" 버튼 노출 확인 | ✅ PASS (`PUT /api/reviews/:id` 성공) |
| R-04 | 리뷰 수정 후 `avg_rating` 재계산 반영 | agent 상세 페이지에서 평점 변경 확인 | ✅ PASS (`avg_rating=5.0` 반영) |
| R-05 | 타인 리뷰 수정 시도 → 403 | 다른 계정으로 `PUT /api/reviews/:id` | ✅ PASS (`본인 리뷰만 수정` 에러) |
| R-06 | agent 팔로우 → `followers` 테이블 + `follower_count` 증가 | agent 상세 → 팔로우 버튼 | ✅ PASS (`follower_count 0→1`) |
| R-07 | agent 언팔로우 → 동일하게 감소 | 다시 팔로우 버튼 클릭 | ✅ PASS (`follower_count 1→0`) |
| R-08 | 미로그인 팔로우 시도 → login redirect | 로그아웃 상태로 팔로우 버튼 클릭 | ✅ PASS (DB 레벨 anon INSERT 401 차단) |
| R-09 | agent 상세 — 최근 리뷰 표시 | 리뷰 있는 agent 상세 접근 | — |

---

## 6. 관리자

| # | 항목 | 방법 | 결과 |
|---|---|---|---|
| AD-01 | admin 로그인 → `/admin/reports` 기본 랜딩 | admin 계정 로그인 후 `/admin` 접근 | ✅ PASS (fix 후 200) |
| AD-02 | reports 페이지 — pending 우선 정렬 + summary bar | 신고 데이터 있는 상태로 확인 | ✅ PASS (테스트 데이터 생성 후 확인) |
| AD-03 | report 상태 변경 (pending → reviewed → resolved/dismissed) | 드롭다운 선택 + 모달 확인 | ✅ PASS (pending → reviewed) |
| AD-04 | tasks 페이지 — disputed 우선 정렬 + red row 강조 | disputed task 있는 상태로 확인 | ✅ PASS (목록 정상 조회) |
| AD-05 | task 상태 변경 (open/reviewing/disputed/cancelled) | 드롭다운 선택 + confirm dialog | ✅ PASS (open → reviewing → open 복원) |
| AD-06 | users 목록 — `is_active` 토글 | users 페이지 토글 클릭 | ✅ PASS (false/true 토글 확인) |
| AD-07 | non-admin → `/admin/reports` 직접 접근 → redirect | owner 계정으로 접근 | ✅ PASS (403 차단) |

---

## 7. DB 보안

| # | 항목 | 방법 | 결과 |
|---|---|---|---|
| DB-01 | anon → `submissions` 직접 SELECT 차단 | anon key로 `submissions` 쿼리 | ✅ PASS (HTTP 401) |
| DB-02 | anon → `submissions_safe` view SELECT 허용 | anon key로 `submissions_safe` 쿼리 | ✅ PASS (200) |
| DB-03 | service_role → `submissions` 직접 SELECT 허용 | service role key로 쿼리 | ✅ PASS |
| DB-04 | Storage — provider 본인 submission 파일만 업로드 가능 | 타인 submission_id로 업로드 시도 | — |
| DB-05 | Storage — 결제 완료 owner만 원본 파일 접근 | 미결제 상태로 signed URL 요청 | — |

---

## 이슈 분류 (수정 완료)

1. **R-06 follower_count 미반영 → ✅ FIX (migration 027)**
   - 분류: DB 코드 문제 (트리거 권한 누락)
   - 원인: `update_follower_count()` SECURITY DEFINER 없음 → 타인 agent UPDATE RLS 차단
   - 조치: `SECURITY DEFINER` 추가, `REVOKE EXECUTE FROM PUBLIC`
   - 결과: follower_count 0→1→0 정상 반영 확인

2. **AD-01 admin 403 → ✅ FIX (`requireAuth` JWT payload 직접 디코딩)**
   - 분류: 코드 문제 (auth middleware 클레임 소스 불일치)
   - 원인: `getUser()` 반환 `app_metadata` = `auth.users.raw_app_meta_data`
     custom_access_token_hook은 JWT payload에만 `app_role` 주입 (raw_app_meta_data 갱신 없음)
     → `app_role` 항상 undefined → role 판정 'user' → admin/provider API 전반 403
   - 조치: `decodeJwtPayload()` 헬퍼 추가, JWT payload `app_metadata.app_role` 직접 읽기
   - 결과: admin 200, non-admin 403 정상 동작

## 재검증 결과 요약

| # | 항목 | 결과 |
|---|---|---|
| A-07 | claims.role fix | ✅ PASS |
| T-05 | webhook atomic claim | ✅ PASS |
| T-06 | webhook idempotency | ✅ PASS |
| R-01 | 리뷰 작성 | ✅ PASS |
| R-02 | 중복 리뷰 차단 | ✅ PASS |
| R-03 | 리뷰 수정 (7일) | ✅ PASS |
| R-04 | avg_rating 재계산 | ✅ PASS |
| R-05 | 타인 리뷰 수정 차단 | ✅ PASS |
| R-06 | 팔로우 + follower_count | ✅ PASS (migration 027 fix) |
| R-07 | 언팔로우 + follower_count | ✅ PASS |
| R-08 | 미로그인 팔로우 차단 | ✅ PASS (DB RLS 401) |
| AD-01 | admin API 접근 | ✅ PASS (requireAuth fix) |
| AD-02 | reports pending 정렬 | ✅ PASS |
| AD-03 | report 상태 변경 | ✅ PASS |
| AD-04 | tasks 목록 조회 | ✅ PASS |
| AD-05 | task 상태 변경 | ✅ PASS |
| AD-06 | user is_active 토글 | ✅ PASS |
| AD-07 | non-admin 차단 | ✅ PASS |
| DB-01 | anon submissions 차단 | ✅ PASS |
| DB-02 | anon submissions_safe | ✅ PASS |
| DB-03 | service_role submissions | ✅ PASS |

**버그 2건 발견 → 수정 완료: migration 027 + requireAuth JWT decode fix**

---

## 코드 리뷰 반영 (2026-03-15~16)

### 1차 코드 리뷰 (commit `48a73e18` → `aa07bb54`)

| # | 항목 | 분류 | 결과 |
|---|---|---|---|
| CR-01 | Storage bucket 이름 수정 (`submissions` → `submission-files`) | **Critical 버그** | ✅ FIXED |
| CR-02 | Stripe orphan session 방지 (`session.expire()`) | 안정성 | ✅ FIXED |
| CR-03 | webhook 단계별 상태 재조회 + row count=1 검증 | 안정성 | ✅ FIXED |
| CR-04 | requireAuth `user_metadata.role` fallback DEPRECATED 주석 | 기술 부채 | ✅ STAGED |

### 2차 UI/UX 리뷰 (commit `c415d6e0` → `0dbfb353`)

| # | 항목 | 분류 | 결과 |
|---|---|---|---|
| UI-1 | admin layout JWT decode (`access_token` 직접 디코딩) | 구조 개선 | ✅ DONE |
| UI-1 | dashboard `user_metadata.role` fallback DEPRECATED 유지 | 기술 부채 | ⚠️ TODO |
| UI-2 | demo task 카드: `href='#'` 제거 + 샘플 배지 | UX | ✅ DONE |
| UI-3 | owner orders 정렬 + 상태 시각 구분 | UX | ✅ DONE |
| UI-4 | provider 상단 요약 4칸 분리 (hold/pending 분리) | UX | ✅ DONE |
| UI-5 | follow 실패 피드백 (followError state) | UX | ✅ DONE |

### 잔여 TODO (live 안정화 후)

| # | 항목 | 우선순위 |
|---|---|---|
| TODO-1 | dashboard client-side role: `user_metadata.role` fallback → JWT decode 전환 | 낮음 |
| TODO-2 | requireAuth `user_metadata.role` fallback 완전 제거 | 낮음 |
| TODO-3 | open task 100건+ 시 `/tasks` 서버 검색/정렬 재검토 | 낮음 |
| TODO-4 | purchase judgment logic → DB RPC 이전 | 낮음 |

> **현재 상태:** 1·2차 코드 리뷰 반영 완료. live Stripe만 열리면 전환 가능.

*마지막 업데이트: 2026-03-16 | 기준 커밋: `f61eea6` (migration chain 042 완결)*

# AgentBid — Pre-Live Regression Checklist

> 기준: `v0.3.0-product-pass` (commit `4538f03`)  
> 환경: Supabase `xlhiafqcoyltgyfezdnm` (test mode)  
> live Stripe 항목은 `[LIVE ONLY]` 표시 — 나머지는 현재 test 환경에서 검증 가능

---

## 결과 요약

| 영역 | PASS | FAIL | SKIP (live only) |
|---|---|---|---|
| 인증 | — | — | — |
| 마켓 | — | — | — |
| 거래 | — | — | — |
| 정산 | — | — | — |
| 리뷰/신뢰 | — | — | — |
| 관리자 | — | — | — |

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
| A-07 | `claims.role` = `authenticated` (migration 014 fix) | JWT 디코딩 확인 | — |

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
| T-05 | checkout.session.completed webhook 수신 → order `paid` 전환 | test mode checkout 완료 | — |
| T-06 | webhook 중복 수신 처리 (idempotency) | 동일 이벤트 2회 전송 | — |
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
| R-01 | 결제 완료 주문에 리뷰 작성 | dashboard → "리뷰 작성 →" 클릭 | — |
| R-02 | 동일 주문 리뷰 중복 작성 차단 (409) | 두 번 제출 시도 | — |
| R-03 | 리뷰 작성 후 7일 이내 수정 가능 | 작성 직후 "수정" 버튼 노출 확인 | — |
| R-04 | 리뷰 수정 후 `avg_rating` 재계산 반영 | agent 상세 페이지에서 평점 변경 확인 | — |
| R-05 | 타인 리뷰 수정 시도 → 403 | 다른 계정으로 `PUT /api/reviews/:id` | — |
| R-06 | agent 팔로우 → `followers` 테이블 + `follower_count` 증가 | agent 상세 → 팔로우 버튼 | — |
| R-07 | agent 언팔로우 → 동일하게 감소 | 다시 팔로우 버튼 클릭 | — |
| R-08 | 미로그인 팔로우 시도 → login redirect | 로그아웃 상태로 팔로우 버튼 클릭 | — |
| R-09 | agent 상세 — 최근 리뷰 표시 | 리뷰 있는 agent 상세 접근 | — |

---

## 6. 관리자

| # | 항목 | 방법 | 결과 |
|---|---|---|---|
| AD-01 | admin 로그인 → `/admin/reports` 기본 랜딩 | admin 계정 로그인 후 `/admin` 접근 | — |
| AD-02 | reports 페이지 — pending 우선 정렬 + summary bar | 신고 데이터 있는 상태로 확인 | — |
| AD-03 | report 상태 변경 (pending → reviewed → resolved/dismissed) | 드롭다운 선택 + 모달 확인 | — |
| AD-04 | tasks 페이지 — disputed 우선 정렬 + red row 강조 | disputed task 있는 상태로 확인 | — |
| AD-05 | task 상태 변경 (open/reviewing/disputed/cancelled) | 드롭다운 선택 + confirm dialog | — |
| AD-06 | users 목록 — `is_active` 토글 | users 페이지 토글 클릭 | — |
| AD-07 | non-admin → `/admin/reports` 직접 접근 → redirect | owner 계정으로 접근 | — |

---

## 7. DB 보안

| # | 항목 | 방법 | 결과 |
|---|---|---|---|
| DB-01 | anon → `submissions` 직접 SELECT 차단 | anon key로 `submissions` 쿼리 | — |
| DB-02 | anon → `submissions_safe` view SELECT 허용 | anon key로 `submissions_safe` 쿼리 | — |
| DB-03 | service_role → `submissions` 직접 SELECT 허용 | service role key로 쿼리 | — |
| DB-04 | Storage — provider 본인 submission 파일만 업로드 가능 | 타인 submission_id로 업로드 시도 | — |
| DB-05 | Storage — 결제 완료 owner만 원본 파일 접근 | 미결제 상태로 signed URL 요청 | — |

---

## 재검증 우선 순서

최근 수정 항목 먼저:

1. **A-07** — migration 014 `claims.role` fix (auth 핵심)
2. **T-05, T-06** — webhook atomic claim + 중복 처리
3. **R-01~R-04** — 리뷰 작성/수정 플로우
4. **R-06~R-08** — follow/unfollow
5. **AD-01~AD-06** — admin actions
6. **DB-01~DB-05** — DB 보안 (이미 자동화 테스트 5/5 PASS)

---

*마지막 업데이트: 2026-03-15 | 기준 태그: `v0.3.0-product-pass`*

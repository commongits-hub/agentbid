# AgentBid

AI Agent 마켓플레이스. Task를 올리고, AI Agent provider가 제출(submission)하고, 선택 후 결제/정산.

## Stack

- **Frontend**: Next.js 16 (App Router) + Tailwind CSS
- **Backend**: Supabase (Postgres + Auth + RLS + Storage + pg_cron)
- **Payment**: Stripe Checkout + Connect Express
- **Hosting**: Vercel

## 운영 URL

- Production: `https://agentbid.vercel.app`
- Supabase: `xlhiafqcoyltgyfezdnm`

## 주요 플로우

```
Owner:    회원가입 → Task 등록 → Submission 선택 → Stripe Checkout → 결제 → 리뷰 작성
Provider: 회원가입 → Stripe Connect 온보딩 → Task 목록 → Submission 제출 → 7일 후 정산
```

## 개발 환경 실행

```bash
npm install
cp .env.example .env.local   # 환경변수 세팅
npm run dev
```

## DB 마이그레이션

```bash
supabase db push              # migration 적용
supabase db push --dry-run    # 미리 확인
```

현재 migration: `001`–`026`

## 주요 API

| 엔드포인트 | 설명 |
|---|---|
| `POST /api/tasks` | Task 등록 (owner) |
| `GET /api/tasks` | Task 목록 |
| `POST /api/submissions` | Submission 제출 (provider) |
| `GET /api/submissions?task_id=` | Submission 목록 (owner/provider 분기) |
| `GET /api/submissions/:id/download` | 파일 다운로드 signed URL 발급 (paid 확인 후) |
| `POST /api/orders` | Stripe Checkout 세션 생성 |
| `GET /api/payouts` | 정산 내역 (provider) |
| `POST /api/reviews` | 리뷰 작성 (paid order 필수) |
| `GET /api/reviews?order_id=` | 리뷰 조회 |
| `PUT /api/reviews/:id` | 리뷰 수정 (본인 + 7일 이내) |
| `POST /api/stripe/connect/onboard` | Connect 온보딩 URL 발급 |
| `GET /api/stripe/connect/status` | Connect 연결 상태 조회 |
| `POST /api/webhooks/stripe` | Stripe webhook 수신 |

## 권한 구조

| app_role | 역할 | 주요 권한 |
|---|---|---|
| `user` | 일반 사용자 | Task 등록, Submission 선택, 결제, 리뷰 작성 |
| `provider` | Agent 운영자 | Submission 제출, Connect 온보딩, 정산 조회 |
| `admin` | 관리자 | 전체 조회, 사용자/작업 관리 |

> JWT `claims.app_metadata.app_role` 기준. `claims.role`은 PostgREST DB 롤 전용 (`authenticated`/`anon`).  
> ⚠️ `claims.role`에 앱 역할을 쓰면 RLS 전체 무력화 (migration 014 참고).

## 정산 흐름

```
결제 완료
  → payout.status = pending (7일 대기)
  → release_matured_payouts() cron (매일 02:00 UTC)
      → Stripe Connect 완료 → released
      → 미완료 → hold
  → transfer-payouts Edge Function (매일 03:00 UTC)
      → released → Stripe Transfer → transferred
```

## DB 보안 구조

```
submissions 접근 제어 (migration 023–026):
  authenticated / anon → submissions 직접 SELECT 불가 (REVOKE)
  클라이언트 조회 → submissions_safe view (content 컬럼 purchase gating)
  service_role → submissions 직접 접근 유지
  Storage RLS → SECURITY DEFINER 헬퍼 함수 통해 submissions 간접 참조
```

## 완료된 기능 (2026-03-15 기준, `v0.3.0-product-pass`)

| 기능 | 상태 |
|---|---|
| Task 등록 / 마켓 목록 | ✅ |
| Submission 제출 / 조회 (preview/full 분리) | ✅ |
| Stripe Checkout 결제 E2E | ✅ |
| Stripe Connect 온보딩 / 정산 | ✅ |
| Agent 상세 / 팔로우 | ✅ |
| 리뷰 작성 / 수정 / avg_rating 재계산 | ✅ |
| DB 보안 강화 (RLS / View / REVOKE) | ✅ |
| Webhook 처리 (atomic claim / idempotency) | ✅ |
| Dashboard 행동 중심 재구성 (owner/provider/admin) | ✅ |
| Admin 대시보드 (reports/tasks/users) | ✅ |
| 제품 1차 마감 + 최종 QA PASS | ✅ |

## 운영 문서

- `DEPLOY.md` — 배포 체크리스트
- `OPERATIONS.md` — 운영 기준 문서 (상태 전이표 / Known Issues / live 전환 체크리스트 / critical bug 기록)
- `PRE_LIVE_CHECKLIST.md` — pre-live regression 검증 체크리스트

# AgentBid

AI Agent 마켓플레이스. Task를 올리고, AI Agent provider가 제출(submission)하고, 선택 후 결제/정산.

## Stack

- **Frontend**: Next.js 16 (App Router) + Tailwind CSS
- **Backend**: Supabase (Postgres + Auth + RLS + pg_cron)
- **Payment**: Stripe Checkout + Connect Express
- **Hosting**: Vercel

## 운영 URL

- Production: `https://agentbid.vercel.app`
- Supabase: `xlhiafqcoyltgyfezdnm`

## 주요 플로우

```
Owner: 회원가입 → Task 등록 → Submission 선택 → Stripe Checkout → 결제
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

현재 migration: `001`–`010`

## 주요 API

| 엔드포인트 | 설명 |
|---|---|
| `POST /api/tasks` | Task 등록 (owner) |
| `GET /api/tasks` | Task 목록 |
| `POST /api/submissions` | Submission 제출 (provider) |
| `GET /api/submissions` | Submission 목록 |
| `POST /api/orders` | Stripe Checkout 세션 생성 |
| `GET /api/payouts` | 정산 내역 (provider) |
| `POST /api/stripe/connect/onboard` | Connect 온보딩 URL 발급 (provider) |
| `GET /api/stripe/connect/status` | Connect 연결 상태 조회 |
| `POST /api/webhooks/stripe` | Stripe webhook 수신 |

## 권한 구조

- `app_role = 'owner'`: Task 등록, Submission 선택, 결제
- `app_role = 'provider'`: Submission 제출, Connect 온보딩, 정산 조회
- `user_metadata.role` → `app_metadata.app_role` 순 감지

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

## 운영 문서

- `DEPLOY.md` — 배포 체크리스트
- `OPERATIONS.md` — 운영 마감 문서 (Known Issues, live 전환 체크리스트)

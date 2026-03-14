# AgentBid 배포 준비 체크리스트

## 상태
- MVP 구현: ✅ 완료 (commit c33ce1b)
- 배포 대상: Vercel (Next.js) + Supabase (이미 운영 중)

---

## TODO — 완료 전 남은 확인 1건

- [ ] Stripe 테스트 온보딩 폼 완주
  - 계정: `acct_1TAfhlQrvuZfdGVn`
  - return_url 복귀 → `fetchStatus()` 호출
  - status API → Stripe `charges_enabled + payouts_enabled` 확인
  - DB `agents.stripe_onboarding_completed = true` 반영 확인
  - hold payout → released 전환 확인 (트리거)

---

## 1. 환경변수 — 운영값으로 교체 필요

| 변수 | 현재 (개발) | 운영값 |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | `https://agentbid.vercel.app` (배포 후 확정) |
| `STRIPE_SECRET_KEY` | `sk_test_51TAQaw...` | `sk_live_...` (라이브 키) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_a899d6...` (로컬 CLI용) | Stripe Dashboard endpoint 등록 후 발급 |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xlhiafqcoyltgyfezdnm.supabase.co` | 동일 (이미 운영 중) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 현재 값 | 동일 |
| `SUPABASE_SERVICE_ROLE_KEY` | 현재 값 | 동일 (Vercel secret으로 관리) |

**주의:**
- `.env.local`은 절대 커밋 금지 (`.gitignore`에 포함됨)
- Vercel에서는 Environment Variables 설정으로 주입
- `SUPABASE_SERVICE_ROLE_KEY`는 Vercel에서 Sensitive로 마킹

---

## 2. Stripe 운영 설정

- [ ] Stripe 라이브 키 발급 (`sk_live_...`)
- [ ] Stripe Dashboard → Webhooks → Add endpoint
  - URL: `https://<배포도메인>/api/webhooks/stripe`
  - 이벤트: `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`, `account.updated`
  - `STRIPE_WEBHOOK_SECRET` 새 값으로 교체
- [ ] Connect → Branding 설정 (플랫폼명, 로고)
- [ ] Connect → Express 계좌 국가 허용 목록 확인 (KR 포함 여부)

---

## 3. Vercel 배포 설정

- [ ] GitHub 연동 또는 `vercel deploy`
- [ ] Environment Variables 등록 (위 표 운영값 기준)
- [ ] `NEXT_PUBLIC_APP_URL` 최종 도메인으로 설정
- [ ] 도메인 연결 (커스텀 도메인 있으면 추가)
- [ ] Build 성공 확인 (`next build` 로컬 테스트 권장)

---

## 4. Supabase 운영 설정

- [ ] Auth → URL Configuration
  - Site URL: `https://<배포도메인>`
  - Redirect URLs: `https://<배포도메인>/auth/callback` 추가
- [ ] Auth → Email Templates 확인 (이메일 인증 등)
- [ ] RLS 재검토 (migration 006 기준, 이미 적용됨)
- [ ] pg_cron 스케줄 확인
  - `close-expired-tasks` (매시간)
  - `release-matured-payouts` (매일 02:00 UTC)
- [ ] Edge Function `transfer-payouts` 배포 (migration 007 주석 참고)
  - 매일 03:00 UTC 실행 → `released` 상태 payout → Stripe Transfer

---

## 5. 에러 로깅 / 모니터링

- [ ] Vercel → Functions 로그 활성화 (기본 제공)
- [ ] Sentry 또는 Logtail 연동 검토 (선택)
  - webhook handler 500 알림
  - Stripe Transfer 실패 알림
- [ ] Supabase → Logs → API/Auth/DB 이상 모니터링
- [ ] Stripe Dashboard → Webhook attempts 모니터링

---

## 6. 보안 체크

- [ ] `SUPABASE_SERVICE_ROLE_KEY` 클라이언트 노출 없음 확인
  - `NEXT_PUBLIC_` prefix 절대 금지
  - 서버 사이드 API route에서만 사용
- [ ] `stripe-signature` 검증 webhook에서 동작 확인 (이미 구현됨)
- [ ] RLS: provider가 타인 submission/order 접근 불가 확인 (이미 검증됨)
- [ ] `submission-shaper.ts`: 결제 전 `content_text`/`file_path` 필드 제거 확인

---

## 7. 빌드 전 최종 체크

```bash
cd agentbid
npm run build          # 빌드 에러 없는지 확인
npm run type-check     # TS 타입 에러 없는지 확인 (tsc --noEmit)
```

현재 상태: `tsc --noEmit` 통과 확인됨 ✅

---

## 우선순위 순서

1. **Vercel 배포 + 도메인 확정** (NEXT_PUBLIC_APP_URL 결정됨)
2. **Stripe webhook endpoint 등록** (운영 도메인 필요)
3. **env 운영값 교체** (라이브 키 포함)
4. **Supabase Auth URL 설정**
5. **Edge Function transfer-payouts 배포**
6. **모니터링 설정**

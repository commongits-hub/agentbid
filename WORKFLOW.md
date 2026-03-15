# WORKFLOW.md — 작업 역할 분리 체계

> 기준: 2026-03-15 Adam 지시

---

## 역할 분리

### Claude (실행 담당)
- 파일 수정, 테스트 실행, 빌드/배포 확인
- UI 수정, 레이아웃, 문구, 반복 작업
- 단순 CRUD / API 연결 / 페이지 조립
- 문서 반영

### Adam (리뷰/판단 담당)
- 구조 변경 판단
- auth / JWT / role
- RLS / migration / trigger
- webhook / 결제 / 정산
- signed URL / storage 접근
- admin 권한
- "이 수정이 맞는지" 최종 판단

---

## 작업 원칙

- **UI/문구/레이아웃/반복 수정** → Claude 바로 처리
- **아래 범주** → 수정 전/후 반드시 리뷰 요청

### 리뷰 필수 파일
```
src/middleware/auth.ts
src/app/api/webhooks/*
src/app/api/orders/*
src/app/api/submissions/*
src/app/api/admin/*
supabase/migrations/*
supabase/functions/transfer-payouts/index.ts
```

- **migration** → Claude가 먼저 작성 → 리뷰 후 적용 (순서 고정)
- **권한/정산/결제** → Claude 단독 결정 금지

---

## 파일 우선순위

### 1차 리뷰 우선순위
- `src/middleware/auth.ts`
- `src/app/api/webhooks/stripe/route.ts`
- `src/app/api/orders/route.ts`
- `src/app/api/submissions/*`
- `supabase/functions/transfer-payouts/index.ts`

### 2차 리뷰 우선순위
- `src/app/dashboard/page.tsx`
- `src/app/tasks/[id]/page.tsx`
- `src/app/agents/[id]/*`
- `src/app/admin/*`

### 3차 리뷰 우선순위
- `src/components/reviews/*`
- `src/components/layout/nav.tsx`
- `src/app/page.tsx`
- `src/app/tasks/page.tsx`

---

## 지시 형식 (표준)

```
목표:
- 무엇을 고칠지 1문장

범위:
- 어떤 파일만 건드릴지 명시

금지:
- 건드리면 안 되는 파일/흐름 명시
- auth / 결제 / 정산 / migration은 허락 없으면 수정 금지

완료 기준:
- 어떤 테스트/빌드/화면 확인까지 하면 끝인지 명시
```

---

## 리뷰 요청 형식

```
변경 파일 목록:
핵심 diff:
왜 수정했는지: (3줄)
테스트 결과:
남은 리스크:
```

---

*이 파일은 작업 체계 기준. 변경 시 Adam 승인 필요.*

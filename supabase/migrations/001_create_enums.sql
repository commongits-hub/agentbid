-- ============================================================
-- Migration 001: Enum 타입 정의
-- Author: commongits-hub
-- Description: 서비스 전체에서 사용하는 enum 타입 선언
-- ============================================================

-- 사용자 역할
CREATE TYPE user_role AS ENUM (
  'user',       -- 일반 유저 (task 등록, 결제)
  'provider',   -- AI Agent Provider (결과 제출)
  'admin'       -- 운영자
);

-- task 상태
CREATE TYPE task_status AS ENUM (
  'draft',      -- 작성 중 (비공개)
  'open',       -- 공개, 제출 받는 중
  'reviewing',  -- 마감 후 유저 검토 중
  'selected',   -- 제출 선택됨, 결제 대기
  'completed',  -- 결제 완료 (종단)
  'cancelled',  -- 취소됨 (종단)
  'disputed',   -- 분쟁 상태
  'expired'     -- 기한 내 미선택 만료 (종단)
);

-- submission 상태
CREATE TYPE submission_status AS ENUM (
  'submitted',    -- 제출 완료
  'selected',     -- 유저가 선택, 결제 대기
  'purchased',    -- 결제 완료, 원본 접근 허용 (종단)
  'unselected',   -- 미선택 확정 (종단)
  'flagged',      -- 신고 접수
  'removed'       -- 관리자 삭제 (종단)
);

-- order 상태
CREATE TYPE order_status AS ENUM (
  'pending',           -- 결제 대기
  'paid',              -- 결제 완료
  'failed',            -- 결제 실패
  'cancelled',         -- 주문 취소 (결제 전)
  'refund_requested',  -- 환불 요청됨
  'refunded'           -- 환불 완료 (종단)
);

-- payout 상태
CREATE TYPE payout_status AS ENUM (
  'pending',      -- 정산 대기 (7일)
  'released',     -- 정산 가능 상태
  'transferred',  -- Stripe Transfer 완료 (종단)
  'hold',         -- 관리자 보류
  'cancelled'     -- 환불로 인해 취소 (종단)
);

-- review 상태
CREATE TYPE review_status AS ENUM (
  'published',  -- 공개
  'flagged',    -- 신고됨
  'hidden'      -- 관리자 숨김
);

-- report 대상 타입
CREATE TYPE report_target_type AS ENUM (
  'task',
  'submission',
  'review',
  'user',
  'agent'
);

-- report 처리 상태
CREATE TYPE report_status AS ENUM (
  'pending',    -- 접수됨
  'reviewed',   -- 검토 중
  'resolved',   -- 처리 완료
  'dismissed'   -- 기각
);

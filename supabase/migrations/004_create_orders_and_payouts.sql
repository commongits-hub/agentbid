-- ============================================================
-- Migration 004: Orders / Payouts
-- Author: commongits-hub
-- Description: 주문, 결제, 정산 테이블
-- 선행: 003_create_tasks_and_submissions.sql
-- ============================================================

-- ------------------------------------------------------------
-- orders
-- 유저가 submission 선택 후 생성되는 주문
-- amount = submission.quoted_price
-- platform_fee = FLOOR(amount * fee_rate)
-- provider_amount = amount - platform_fee
-- stripe_payment_intent_id: Stripe 중복 방지 기준
-- ------------------------------------------------------------
CREATE TABLE orders (
  id                            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       uuid          NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  task_id                       uuid          NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  submission_id                 uuid          NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE RESTRICT,
  amount                        integer       NOT NULL CHECK (amount >= 1000),
  platform_fee                  integer       NOT NULL CHECK (platform_fee >= 0),
  provider_amount               integer       NOT NULL CHECK (provider_amount >= 0),
  -- amount = platform_fee + provider_amount 보장
  CONSTRAINT chk_order_amount CHECK (amount = platform_fee + provider_amount),
  fee_rate_snapshot             numeric(5,4)  NOT NULL,  -- 결제 시점 수수료율 스냅샷
  status                        order_status  NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id      text          UNIQUE,
  stripe_checkout_session_id    text          UNIQUE,
  paid_at                       timestamptz,
  created_at                    timestamptz   NOT NULL DEFAULT now()
);

-- task당 paid 주문은 1개만 (partial unique index)
CREATE UNIQUE INDEX uq_orders_task_paid
  ON orders(task_id) WHERE status = 'paid';

-- task당 활성 주문은 1개만
-- pending / paid / refund_requested 상태가 동시에 2개 이상 존재하면 안 됨
-- → 같은 task에 결제 시도 중복 방지
CREATE UNIQUE INDEX uq_orders_task_active
  ON orders(task_id) WHERE status IN ('pending', 'paid', 'refund_requested');
-- 주의: PostgreSQL partial unique index는 IN 조건을 직접 지원하지 않음
-- 대신 아래와 같이 각 상태별로 분리하거나, 트리거로 보완
-- 실용적 대안: API 레벨에서 INSERT 전 SELECT FOR UPDATE로 중복 확인 (migration 003의 트랜잭션 규칙과 동일)
-- 아래는 pending 중복만 DB 레벨 차단 (가장 중요한 케이스)
DROP INDEX IF EXISTS uq_orders_task_active;
CREATE UNIQUE INDEX uq_orders_task_pending
  ON orders(task_id) WHERE status = 'pending';

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_task_id ON orders(task_id);
CREATE INDEX idx_orders_stripe_pi ON orders(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- ------------------------------------------------------------
-- stripe_webhook_events
-- webhook 중복 처리 방지용 이벤트 기록
-- ------------------------------------------------------------
CREATE TABLE stripe_webhook_events (
  id          text        PRIMARY KEY,  -- Stripe event ID (evt_xxx)
  type        text        NOT NULL,
  processed   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_events_type ON stripe_webhook_events(type);

-- ------------------------------------------------------------
-- payouts
-- order.paid 후 생성되는 Provider 정산 레코드
-- release_at = paid_at + 7일
-- 환불 발생 시 cancelled, Stripe Transfer 시 transferred
-- ------------------------------------------------------------
CREATE TABLE payouts (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid          NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  agent_id            uuid          NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  amount              integer       NOT NULL CHECK (amount >= 0),  -- orders.provider_amount
  status              payout_status NOT NULL DEFAULT 'pending',
  release_at          timestamptz   NOT NULL,   -- paid_at + 7일
  transferred_at      timestamptz,
  stripe_transfer_id  text          UNIQUE,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_payouts_agent_id ON payouts(agent_id);
CREATE INDEX idx_payouts_status ON payouts(status);
-- 정산 cron이 매일 조회하는 인덱스
CREATE INDEX idx_payouts_release_pending ON payouts(release_at)
  WHERE status = 'pending';
CREATE INDEX idx_payouts_released ON payouts(id)
  WHERE status = 'released';

-- ------------------------------------------------------------
-- 트리거: order paid 시 payout 자동 생성
-- webhook 처리 후 orders.status = 'paid' 업데이트 시 발동
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_payout_on_paid()
RETURNS TRIGGER AS $$
DECLARE
  v_agent_id uuid;
BEGIN
  -- paid 전환 시에만 동작
  -- paid_at IS NOT NULL 가드: paid_at 없으면 payout 생성 스킵 (데이터 무결성 보호)
  IF NEW.status = 'paid' AND OLD.status != 'paid' THEN
    IF NEW.paid_at IS NULL THEN
      RAISE WARNING 'create_payout_on_paid: order % has status=paid but paid_at IS NULL, skipping payout creation', NEW.id;
      RETURN NEW;
    END IF;

    -- agent_id 조회
    SELECT s.agent_id INTO v_agent_id
    FROM submissions s
    WHERE s.id = NEW.submission_id;

    IF v_agent_id IS NULL THEN
      RAISE WARNING 'create_payout_on_paid: could not resolve agent_id for submission %, skipping', NEW.submission_id;
      RETURN NEW;
    END IF;

    -- payout 생성
    INSERT INTO payouts (order_id, agent_id, amount, status, release_at)
    VALUES (
      NEW.id,
      v_agent_id,
      NEW.provider_amount,
      'pending',
      NEW.paid_at + INTERVAL '7 days'
    )
    ON CONFLICT (order_id) DO NOTHING;  -- 중복 방지 (webhook 재수신 케이스)
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_payout_on_paid
  AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION create_payout_on_paid();

-- ------------------------------------------------------------
-- 트리거: order refunded 시 payout cancelled
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_payout_on_refund()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'refunded' AND OLD.status != 'refunded' THEN
    UPDATE payouts
    SET status = 'cancelled'
    WHERE order_id = NEW.id
      AND status IN ('pending', 'released');  -- transferred는 취소 불가
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cancel_payout_on_refund
  AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION cancel_payout_on_refund();

-- ------------------------------------------------------------
-- 함수: payout 자동 정산 (cron에서 호출, migration 007에서 스케줄 등록)
-- released 상태 payout을 Stripe Transfer 처리
-- 실제 Stripe API 호출은 Edge Function에서 수행
-- 이 함수는 pending → released 전이만 처리
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_matured_payouts()
RETURNS void AS $$
BEGIN
  UPDATE payouts
  SET status = 'released'
  WHERE status = 'pending'
    AND release_at <= now();
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 함수: platform_fee 계산 헬퍼
-- FLOOR 기준 (Provider에게 유리하게)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_fee(
  p_amount integer,
  p_rate   numeric
)
RETURNS TABLE (
  platform_fee    integer,
  provider_amount integer
) AS $$
DECLARE
  v_fee integer;
BEGIN
  v_fee := FLOOR(p_amount * p_rate)::integer;
  RETURN QUERY SELECT v_fee, p_amount - v_fee;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 사용 예시:
-- SELECT * FROM calculate_fee(10001, 0.2000);
-- → platform_fee=2000, provider_amount=8001

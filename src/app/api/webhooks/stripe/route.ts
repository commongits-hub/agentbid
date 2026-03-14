// src/app/api/webhooks/stripe/route.ts
// Stripe webhook 수신 처리
// 처리 이벤트: checkout.session.completed, payment_intent.payment_failed,
//              charge.refunded, account.updated (Connect Express)
//
// ⚠️ 보안:
//   - stripe-signature 헤더 검증 필수
//   - 모든 DB 업데이트는 supabaseAdmin (service_role) 사용
//   - stripe_webhook_events 테이블로 중복 처리 방지

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  // 1. Stripe 서명 검증
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err: any) {
    console.error('Stripe webhook signature verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // 2. 중복 처리 방지 (stripe_webhook_events 테이블)
  const { data: existingEvent } = await supabaseAdmin
    .from('stripe_webhook_events')
    .select('id, processed')
    .eq('id', event.id)
    .single()

  if (existingEvent?.processed) {
    // 이미 처리된 이벤트 → 200 반환 (Stripe 재전송 방지)
    return NextResponse.json({ received: true, duplicate: true })
  }

  // 3. 이벤트 기록 (처리 시작)
  await supabaseAdmin.from('stripe_webhook_events').upsert({
    id: event.id,
    type: event.type,
    processed: false,
  })

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break
      }
      case 'payment_intent.payment_failed': {
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent)
        break
      }
      case 'charge.refunded': {
        await handleRefunded(event.data.object as Stripe.Charge)
        break
      }
      case 'account.updated': {
        await handleAccountUpdated(event.data.object as Stripe.Account)
        break
      }
      default:
        // 처리하지 않는 이벤트 타입 → 무시
        break
    }

    // 4. 처리 완료 표시
    await supabaseAdmin
      .from('stripe_webhook_events')
      .update({ processed: true })
      .eq('id', event.id)

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error(`Webhook handler error [${event.type}]:`, err.message)
    // processed = false 유지 → 재시도 허용
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}

/**
 * checkout.session.completed
 * Stripe 결제 완료 → orders.status = 'paid', submission.status = 'purchased'
 * payout 생성은 DB 트리거(trg_create_payout_on_paid)가 처리
 *
 * 매칭 순서:
 *   1차) stripe_checkout_session_id = session.id
 *   2차) submission_id + status='pending' (session ID 불일치 fallback)
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const { task_id, submission_id, user_id } = session.metadata ?? {}

  if (!task_id || !submission_id || !user_id) {
    throw new Error('Missing metadata in checkout session')
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent as Stripe.PaymentIntent | null)?.id

  if (!paymentIntentId) {
    throw new Error('No payment_intent in checkout session')
  }

  // ── 1. order 조회 (session ID 우선, fallback: submission_id) ──────────────
  let orderId: string | null = null

  const { data: orderBySession } = await supabaseAdmin
    .from('orders')
    .select('id')
    .eq('stripe_checkout_session_id', session.id)
    .eq('status', 'pending')
    .maybeSingle()

  orderId = orderBySession?.id ?? null

  if (!orderId) {
    // Fallback: submission_id 기준 매칭 (UNIQUE 보장됨)
    const { data: orderBySubmission } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('submission_id', submission_id)
      .eq('status', 'pending')
      .maybeSingle()

    orderId = orderBySubmission?.id ?? null

    // session ID 정규화 (이후 중복 처리 방지용)
    if (orderId) {
      await supabaseAdmin
        .from('orders')
        .update({ stripe_checkout_session_id: session.id })
        .eq('id', orderId)
    }
  }

  if (!orderId) {
    throw new Error(
      `No pending order found — session: ${session.id}, submission: ${submission_id}`,
    )
  }

  // ── 2. submission: submitted → selected ────────────────────────────────────
  // ⚠️ tasks.selected_submission_id 제약이 status='selected' 체크하므로 먼저 실행
  const { error: subError } = await supabaseAdmin
    .from('submissions')
    .update({ status: 'selected' })
    .eq('id', submission_id)

  if (subError) throw new Error(`Failed to update submission to selected: ${subError.message}`)

  // ── 3. tasks.selected_submission_id 설정 ────────────────────────────────────
  const { error: taskError } = await supabaseAdmin
    .from('tasks')
    .update({ selected_submission_id: submission_id })
    .eq('id', task_id)

  if (taskError) throw new Error(`Failed to update task: ${taskError.message}`)

  // ── 4. orders: pending → paid (트리거 trg_create_payout_on_paid 발동) ──────
  const { error: orderError } = await supabaseAdmin
    .from('orders')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: session.id,
    })
    .eq('id', orderId)

  if (orderError) throw new Error(`Failed to update order to paid: ${orderError.message}`)

  // ── 5. submission: selected → purchased (원본 공개) ─────────────────────────
  const { error: purchaseError } = await supabaseAdmin
    .from('submissions')
    .update({ status: 'purchased' })
    .eq('id', submission_id)

  if (purchaseError) throw new Error(`Failed to mark submission as purchased: ${purchaseError.message}`)
}

/**
 * payment_intent.payment_failed
 * 결제 실패 → orders.status = 'cancelled'
 */
async function handlePaymentFailed(pi: Stripe.PaymentIntent) {
  await supabaseAdmin
    .from('orders')
    .update({ status: 'cancelled' })
    .eq('stripe_payment_intent_id', pi.id)
    .eq('status', 'pending')
}

/**
 * charge.refunded
 * 환불 처리 → orders.status = 'refunded'
 * trg_cancel_payout_on_refund 트리거가 payouts.status = 'cancelled'로 처리
 */
async function handleRefunded(charge: Stripe.Charge) {
  const paymentIntentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id

  if (!paymentIntentId) return

  await supabaseAdmin
    .from('orders')
    .update({ status: 'refunded' })
    .eq('stripe_payment_intent_id', paymentIntentId)
    .in('status', ['paid', 'refund_requested'])
}

/**
 * account.updated (Stripe Connect Express)
 * provider 계좌 onboarding 완료 여부 업데이트
 * charges_enabled + payouts_enabled 모두 true면 onboarding 완료로 처리
 */
async function handleAccountUpdated(account: Stripe.Account) {
  const { id, charges_enabled, payouts_enabled } = account
  const fullyConnected = charges_enabled && payouts_enabled

  const { data: agent } = await supabaseAdmin
    .from('agents')
    .select('id, stripe_onboarding_completed')
    .eq('stripe_account_id', id)
    .is('soft_deleted_at', null)
    .maybeSingle()

  if (!agent) return // 알 수 없는 account — 무시

  // 상태 변경이 있을 때만 업데이트
  if (fullyConnected && !agent.stripe_onboarding_completed) {
    await supabaseAdmin
      .from('agents')
      .update({
        stripe_onboarding_completed:    true,
        stripe_onboarding_completed_at: new Date().toISOString(),
      })
      .eq('id', agent.id)
  } else if (!fullyConnected && agent.stripe_onboarding_completed) {
    // 계좌 정지/취소 등으로 비활성화된 경우
    await supabaseAdmin
      .from('agents')
      .update({ stripe_onboarding_completed: false })
      .eq('id', agent.id)
  }
}

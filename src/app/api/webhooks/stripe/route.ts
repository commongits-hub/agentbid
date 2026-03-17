// src/app/api/webhooks/stripe/route.ts
// Stripe webhook 수신 처리
// 처리 이벤트: checkout.session.completed, payment_intent.payment_failed,
//              charge.refunded, account.updated (Connect Express)
//
// ⚠️ 보안:
//   - stripe-signature 헤더 검증 필수
//   - 모든 DB 업데이트는 supabaseAdmin (service_role) 사용
//   - claim_webhook_event() RPC로 atomic 중복 처리 방지 (processing 플래그 기반)

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

export async function POST(req: NextRequest) {
  const body      = await req.text()
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

  // 2. Atomic event claim (race condition 방지)
  //    claim_webhook_event():
  //      - 신규 이벤트          → INSERT + processing=true  → true
  //      - 재시도 (processed=false, processing=false) → UPDATE → true
  //      - 동시 처리 중          → processing=true         → false (skip)
  //      - 이미 완료            → processed=true           → false (skip)
  const { data: claimed, error: claimError } = await supabaseAdmin
    .rpc('claim_webhook_event', { p_id: event.id, p_type: event.type })

  if (claimError) {
    console.error('claim_webhook_event failed:', claimError.message)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  if (!claimed) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  // 3. 이벤트 처리
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
        break
    }

    // 4. 처리 완료 표시 (processed=true, processing=false, processing_started_at 정리)
    await supabaseAdmin
      .from('stripe_webhook_events')
      .update({ processed: true, processing: false, processing_started_at: null })
      .eq('id', event.id)

    return NextResponse.json({ received: true })

  } catch (err: any) {
    console.error(`Webhook handler error [${event.type}]:`, err.message)
    // processing=false + processing_started_at 정리 → Stripe 재전송 시 재시도 허용
    await supabaseAdmin
      .from('stripe_webhook_events')
      .update({ processing: false, processing_started_at: null })
      .eq('id', event.id)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}

/**
 * checkout.session.completed
 *
 * 멱등성 보장: 각 단계 전 현재 상태를 재조회하여 이미 처리된 경우 조용히 종료.
 * 순서:
 *   1. order 조회 (session ID 우선, fallback: submission_id)
 *   2. submission 상태 재확인 → submitted이면 selected로
 *   3. task 상태 재확인 → completed 아닌 경우만 update
 *   4. order → paid (trg_create_payout_on_paid 트리거) + row count=1 검증
 *   5. submission → purchased (원본 공개)
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

  // ── 1. order 조회 ──────────────────────────────────────────────────────────
  let orderId: string | null = null

  const { data: orderBySession } = await supabaseAdmin
    .from('orders')
    .select('id, status')
    .eq('stripe_checkout_session_id', session.id)
    .maybeSingle()

  // 재실행 가드: 이미 paid이면 중복 처리 없이 종료
  if (orderBySession?.status === 'paid') {
    console.log(`[webhook] already paid — order ${orderBySession.id}`)
    return
  }

  orderId = orderBySession?.status === 'pending' ? orderBySession.id : null

  if (!orderId) {
    // fallback: session_id 매칭 실패 시 아직 처리 안 된 pending order 탐색
    // submission당 1회 구매 정책 — pending 상태 주문만 대상 (paid 혼입 없음)
    const { data: pendingOrders } = await supabaseAdmin
      .from('orders')
      .select('id, status')
      .eq('submission_id', submission_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)

    const orderBySubmission = pendingOrders?.[0] ?? null

    orderId = orderBySubmission?.id ?? null

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

  // ── 2. submission 상태 재확인 → selected ────────────────────────────────────
  // ⚠️ tasks.selected_submission_id FK 제약이 status='selected' 체크하므로 먼저 실행
  const { data: subCurrent, error: subFetchErr } = await supabaseAdmin
    .from('submissions')
    .select('status')
    .eq('id', submission_id)
    .single()

  if (subFetchErr || !subCurrent) {
    throw new Error(`Failed to fetch submission: ${subFetchErr?.message}`)
  }

  // purchased = 전체 플로우 이미 완료 → 조용히 종료 (완전 멱등)
  if (subCurrent.status === 'purchased') {
    console.log(`[webhook] submission already purchased — ${submission_id}, skipping`)
    return
  }

  // submitted → selected 전환
  if (subCurrent.status === 'submitted') {
    const { error: subToSelectedErr } = await supabaseAdmin
      .from('submissions')
      .update({ status: 'selected' })
      .eq('id', submission_id)
      .eq('status', 'submitted')       // 상태 재확인: 동시 처리 가드
    if (subToSelectedErr) throw new Error(`Failed to update submission to selected: ${subToSelectedErr.message}`)
  }
  // status === 'selected' → 이미 선택됨, 계속 진행

  // ── 3. task 상태 재확인 → completed ─────────────────────────────────────────
  const { data: taskCurrent, error: taskFetchErr } = await supabaseAdmin
    .from('tasks')
    .select('status, selected_submission_id')
    .eq('id', task_id)
    .single()

  if (taskFetchErr || !taskCurrent) {
    throw new Error(`Failed to fetch task: ${taskFetchErr?.message}`)
  }

  // 이미 completed + 올바른 submission이면 진행 허용 (재실행 복구)
  if (taskCurrent.status !== 'completed') {
    const { error: taskError } = await supabaseAdmin
      .from('tasks')
      .update({ selected_submission_id: submission_id, status: 'completed' })
      .eq('id', task_id)
    if (taskError) throw new Error(`Failed to update task: ${taskError.message}`)
  }

  // ── 4. order → paid (trg_create_payout_on_paid 트리거) ─────────────────────
  // row count = 1 검증: 0이면 이미 paid이거나 다른 상태 — 처리 불필요
  const { data: paidRows, error: orderError } = await supabaseAdmin
    .from('orders')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: session.id,
    })
    .eq('id', orderId)
    .eq('status', 'pending')           // 상태 재확인: pending인 경우에만 update
    .select('id')

  if (orderError) throw new Error(`Failed to update order to paid: ${orderError.message}`)

  if (!paidRows || paidRows.length === 0) {
    // 이미 paid 처리됨 (동시 webhook 재전송) → 조용히 종료
    console.log(`[webhook] order already processed — orderId: ${orderId}`)
    return
  }

  if (paidRows.length !== 1) {
    throw new Error(`Unexpected order update count: ${paidRows.length} (expected 1)`)
  }

  // ── 5. submission → purchased (원본 공개) ──────────────────────────────────
  // 상태 가드: selected 상태인 경우에만 update (step 2에서 selected로 전환됨)
  const { error: purchaseError } = await supabaseAdmin
    .from('submissions')
    .update({ status: 'purchased' })
    .eq('id', submission_id)
    .eq('status', 'selected')   // selected → purchased 전이만 허용
  if (purchaseError) throw new Error(`Failed to mark submission as purchased: ${purchaseError.message}`)
}

/**
 * payment_intent.payment_failed
 * 결제 실패 → orders.status = 'cancelled'
 */
async function handlePaymentFailed(pi: Stripe.PaymentIntent) {
  const { data: matchedByPi } = await supabaseAdmin
    .from('orders')
    .update({ status: 'cancelled' })
    .eq('stripe_payment_intent_id', pi.id)
    .eq('status', 'pending')
    .select('id')

  if (matchedByPi && matchedByPi.length > 0) return

  try {
    const sessions = await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 })
    const sessionId = sessions.data[0]?.id
    if (!sessionId) return

    await supabaseAdmin
      .from('orders')
      .update({ status: 'cancelled', stripe_payment_intent_id: pi.id })
      .eq('stripe_checkout_session_id', sessionId)
      .eq('status', 'pending')
  } catch {
    // Stripe 조회 실패 → 다음 재전송에서 재시도
  }
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
 * charges_enabled + payouts_enabled 모두 true → onboarding 완료
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

  if (!agent) return

  if (fullyConnected && !agent.stripe_onboarding_completed) {
    await supabaseAdmin
      .from('agents')
      .update({
        stripe_onboarding_completed:    true,
        stripe_onboarding_completed_at: new Date().toISOString(),
      })
      .eq('id', agent.id)
  } else if (!fullyConnected && agent.stripe_onboarding_completed) {
    await supabaseAdmin
      .from('agents')
      .update({ stripe_onboarding_completed: false })
      .eq('id', agent.id)
  }
}

// src/app/api/orders/route.ts
// POST /api/orders - 주문 생성 (task owner가 submission 선택 후 결제 시작)
// GET  /api/orders - 본인 주문 목록 조회
//
// 정책: 같은 submission은 평생 1회 구매만 허용 (submission_id UNIQUE 제약)
//   cancelled/refunded 후 재주문은 지원하지 않음
//
// ⚠️ 결제 생성 순서 (Stripe-first + DB 실패 시 session expire)
//   1. 검증 (task owner, submission 상태, 중복 주문 확인)
//   2. Stripe Checkout Session 생성
//   3. DB orders 레코드 insert (pending)
//   4. DB insert 실패 → Stripe session.expire() 즉시 호출 (orphan session 제거)
//
//   stripe_checkout_session_id 컬럼에 immutability trigger가 걸려 있어
//   "DB pending first → Stripe → update session_id" 순서가 불가하므로
//   현재 순서를 유지하되 실패 시 세션을 정리하는 방식으로 orphan 방지.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { requireAuth } from '@/middleware/auth'
import { supabaseAdmin, createServerClientWithAuth } from '@/lib/supabase/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})

// GET /api/orders
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('error' in auth) return auth.error

  // Bearer 있으면 JWT 기반 client, 없으면 cookie 기반 client (SSR 세션)
  const bearerToken = req.headers.get('authorization')?.replace('Bearer ', '')
  let supabase
  if (bearerToken) {
    supabase = createServerClientWithAuth(bearerToken)
  } else {
    const cookieStore = await cookies()
    supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cs) { cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) },
        },
      },
    )
  }

  const { data, error } = await supabase
    .from('orders')
    .select('id, task_id, submission_id, amount, platform_fee, provider_amount, status, paid_at, stripe_checkout_session_id, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

// POST /api/orders
// body: { task_id, submission_id }
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('error' in auth) return auth.error

  // provider는 주문 불가
  if (auth.user.role !== 'user') {
    return NextResponse.json({ error: 'Only users can create orders' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { task_id, submission_id } = body

  if (!task_id || !submission_id) {
    return NextResponse.json(
      { error: 'task_id and submission_id are required' },
      { status: 400 },
    )
  }

  // service_role로 검증 (RLS 우회하여 정확한 상태 확인)
  const { data: task, error: taskError } = await supabaseAdmin
    .from('tasks')
    .select('id, user_id, status')
    .eq('id', task_id)
    .single()

  if (taskError || !task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  if (task.user_id !== auth.user.id) {
    return NextResponse.json({ error: 'You do not own this task' }, { status: 403 })
  }

  if (!['open', 'reviewing'].includes(task.status)) {
    // 구매 허용 상태: 'open'(제안 수락 중) + 'reviewing'(선택 검토 중)
    // 'reviewing' 포함 이유: submission.status='submitted'인 제안을 선택하는 단계이므로 결제 진입 허용
    // 단, selected/completed/expired 전이 후에는 이 조건으로 차단됨
    return NextResponse.json(
      { error: 'Task is not in a selectable state' },
      { status: 422 },
    )
  }

  // submission 존재 + 이 task 소속 확인
  const { data: submission, error: subError } = await supabaseAdmin
    .from('submissions')
    .select('id, task_id, agent_id, quoted_price, status')
    .eq('id', submission_id)
    .eq('task_id', task_id)
    .is('soft_deleted_at', null)
    .single()

  if (subError || !submission) {
    return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
  }

  if (submission.status !== 'submitted') {
    return NextResponse.json(
      { error: 'Submission is not in submitted state' },
      { status: 422 },
    )
  }

  // 현재 유효 수수료율 조회
  const { data: feePolicy } = await supabaseAdmin
    .from('fee_policies')
    .select('rate')
    .lte('effective_from', new Date().toISOString())
    .order('effective_from', { ascending: false })
    .limit(1)
    .single()

  const feeRate = feePolicy?.rate ?? 0.2
  const amount = submission.quoted_price
  const platformFee = Math.floor(amount * feeRate)
  const providerAmount = amount - platformFee

  // 중복 주문 확인 (submission_id UNIQUE 제약 보조)
  // 정책: 같은 submission은 평생 1회 구매. pending/paid 활성 주문 존재 시 차단.
  const { data: existingOrders } = await supabaseAdmin
    .from('orders')
    .select('id, status')
    .eq('submission_id', submission_id)
    .in('status', ['pending', 'paid'])
    .order('created_at', { ascending: false })
    .limit(1)

  const existingOrder = existingOrders?.[0] ?? null

  if (existingOrder) {
    if (existingOrder.status === 'paid') {
      return NextResponse.json(
        { error: 'Duplicate order detected' },
        { status: 409 },
      )
    }
    if (existingOrder.status === 'pending') {
      return NextResponse.json(
        { error: 'A pending order already exists for this submission', order_id: existingOrder.id },
        { status: 409 },
      )
    }
  }

  // ── Stripe Checkout Session 생성 ──────────────────────────────────────────
  // ⚠️ stripe_checkout_session_id 컬럼에 immutability trigger가 있어
  //    "pending order 먼저 → session_id update" 순서가 차단됨.
  //    Stripe를 먼저 생성하되, DB insert 실패 시 즉시 session.expire() 호출.
  let checkoutSession: Stripe.Checkout.Session
  try {
    checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'krw',
            unit_amount: amount,
            product_data: {
              name: `AgentBid Task Payment`,
              description: `Task ID: ${task_id}`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        task_id,
        submission_id,
        user_id: auth.user.id,
      },
      // success_url은 `/orders/[sessionId]/success` 라우트와 1:1 결합.
      // URL 구조 변경 시 이 값도 함께 수정 필요.
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/orders/{CHECKOUT_SESSION_ID}/success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/tasks/${task_id}`,
    })
  } catch (stripeErr: any) {
    console.error('Stripe checkout session create failed:', stripeErr.message)
    return NextResponse.json({ error: 'Failed to create payment session' }, { status: 502 })
  }

  // ── DB orders 레코드 생성 (pending) ──────────────────────────────────────
  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .insert({
      user_id: auth.user.id,
      task_id,
      submission_id,
      amount,
      platform_fee: platformFee,
      provider_amount: providerAmount,
      fee_rate_snapshot: feeRate,
      status: 'pending',
      stripe_checkout_session_id: checkoutSession.id,
    })
    .select('id, status, amount, stripe_checkout_session_id')
    .single()

  if (orderError) {
    // DB insert 실패 → orphan Stripe session 즉시 expire (정리)
    console.error('Order DB insert failed, expiring Stripe session:', orderError.message)
    try {
      await stripe.checkout.sessions.expire(checkoutSession.id)
    } catch (expireErr: any) {
      // expire 실패는 로그만 — 24h 후 Stripe가 자동 만료
      console.error('Failed to expire Stripe session:', expireErr.message)
    }

    if (orderError.code === '23505') {
      return NextResponse.json(
        { error: 'Duplicate order detected' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: orderError.message }, { status: 500 })
  }

  return NextResponse.json(
    {
      data: {
        order_id: order.id,
        checkout_url: checkoutSession.url,
        amount,
      },
    },
    { status: 201 },
  )
}

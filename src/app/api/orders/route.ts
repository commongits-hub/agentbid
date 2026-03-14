// src/app/api/orders/route.ts
// POST /api/orders - 주문 생성 (task owner가 submission 선택 후 결제 시작)
// GET  /api/orders - 본인 주문 목록 조회

import { NextRequest, NextResponse } from 'next/server'
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

  const supabase = createServerClientWithAuth(
    req.headers.get('authorization')?.replace('Bearer ', '') ?? '',
  )

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
  if (auth.user.role === 'provider') {
    return NextResponse.json({ error: 'Providers cannot create orders' }, { status: 403 })
  }

  const body = await req.json()
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

  // pending 중복 방지 확인
  const { data: existingOrder } = await supabaseAdmin
    .from('orders')
    .select('id, status')
    .eq('task_id', task_id)
    .eq('status', 'pending')
    .single()

  if (existingOrder) {
    return NextResponse.json(
      { error: 'A pending order already exists for this task', order_id: existingOrder.id },
      { status: 409 },
    )
  }

  // Stripe Checkout Session 생성
  const checkoutSession = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'krw',
          unit_amount: amount,
          product_data: {
            name: `AgentBid 작업 결제`,
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
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/orders/{CHECKOUT_SESSION_ID}/success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/tasks/${task_id}`,
  })

  // orders 레코드 생성 (pending)
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
    // 중복 주문 에러
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

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/middleware/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

// GET /api/reviews?order_id=xxx — 리뷰 존재 여부 확인
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req)
  if ('error' in authResult) return authResult.error
  const { user } = authResult

  const orderId = req.nextUrl.searchParams.get('order_id')
  if (!orderId) return NextResponse.json({ error: 'order_id required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('reviews')
    .select('id, rating, content, created_at, status')
    .eq('order_id', orderId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}

// POST /api/reviews — 리뷰 작성
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req)
  if ('error' in authResult) return authResult.error
  const { user } = authResult

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { order_id, rating, content } = body as {
    order_id: string
    rating: number
    content: string
  }

  // 필수 필드 검증
  if (!order_id || !rating || !content) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }
  if (typeof rating !== 'number' || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be between 1 and 5.' }, { status: 400 })
  }
  if (typeof content !== 'string' || content.trim().length < 10) {
    return NextResponse.json({ error: 'Review must be at least 10 characters.' }, { status: 400 })
  }

  // 주문 확인 — 현재 유저 소유 + paid 상태
  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .select('id, user_id, task_id, submission_id, status')
    .eq('id', order_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
  if (order.status !== 'paid') {
    return NextResponse.json({ error: 'Reviews can only be submitted for paid orders.' }, { status: 400 })
  }

  // agent_id 조회 (submissions 통해)
  const { data: submission, error: subErr } = await supabaseAdmin
    .from('submissions')
    .select('agent_id')
    .eq('id', order.submission_id)
    .maybeSingle()

  if (subErr || !submission) {
    return NextResponse.json({ error: 'Failed to retrieve agent information.' }, { status: 500 })
  }

  // 중복 방지: order_id UNIQUE — DB 레벨에서도 막지만 API에서 먼저 확인
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('reviews')
    .select('id')
    .eq('order_id', order_id)
    .maybeSingle()

  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 })
  if (existing) {
    return NextResponse.json({ error: 'You have already submitted a review for this order.' }, { status: 409 })
  }

  // 리뷰 INSERT
  const { data: review, error: insertErr } = await supabaseAdmin
    .from('reviews')
    .insert({
      order_id,
      user_id: user.id,
      agent_id: submission.agent_id,
      rating,
      content: content.trim(),
      status: 'published',
    })
    .select('id, rating, content, created_at')
    .single()

  if (insertErr) {
    // DB UNIQUE 위반 (order_id) — 경쟁 상태
    if (insertErr.code === '23505') {
      return NextResponse.json({ error: 'You have already submitted a review for this order.' }, { status: 409 })
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ data: review }, { status: 201 })
}

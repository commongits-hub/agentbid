// src/app/api/reviews/[id]/route.ts
// PUT /api/reviews/:id — 리뷰 수정
//
// 제약:
//   - 본인 작성 리뷰만 수정 가능 (user_id = auth.user.id)
//   - 작성 후 7일 이내만 허용
//   - rating / content 수정 가능
//   - content 최소 10자 유지
//   - avg_rating 재계산: DB trigger (trg_recalculate_rating) 자동 처리

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/middleware/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

const EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7일

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req)
  if ('error' in auth) return auth.error

  const { id: reviewId } = await params

  // ── 1. 리뷰 조회 (소유권 확인) ──────────────────────────────────────────
  const { data: review, error: fetchErr } = await supabaseAdmin
    .from('reviews')
    .select('id, user_id, rating, content, created_at, status')
    .eq('id', reviewId)
    .maybeSingle()

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!review)  return NextResponse.json({ error: 'Review not found.' }, { status: 404 })

  if (review.user_id !== auth.user.id) {
    return NextResponse.json({ error: 'You can only edit your own reviews.' }, { status: 403 })
  }

  if (review.status !== 'published') {
    return NextResponse.json({ error: 'This review cannot be edited.' }, { status: 422 })
  }

  // ── 2. 7일 편집 창 확인 ──────────────────────────────────────────────────
  const createdAt = new Date(review.created_at).getTime()
  if (Date.now() - createdAt > EDIT_WINDOW_MS) {
    return NextResponse.json(
      { error: 'Reviews can no longer be edited after 7 days.' },
      { status: 403 },
    )
  }

  // ── 3. 요청 파싱 + 검증 ──────────────────────────────────────────────────
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { rating, content } = body

  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be an integer between 1 and 5.' }, { status: 400 })
  }

  if (typeof content !== 'string' || content.trim().length < 10) {
    return NextResponse.json({ error: 'Review must be at least 10 characters.' }, { status: 400 })
  }

  const trimmedContent = content.trim()

  // ── 4. 변경 없으면 early return ──────────────────────────────────────────
  if (rating === review.rating && trimmedContent === review.content.trim()) {
    return NextResponse.json({ data: review })
  }

  // ── 5. 업데이트 — user_id + status 조건으로 스코프 좁힘 (race condition 방어)
  // updated_at: trg_reviews_updated_at 트리거 자동 처리
  // avg_rating: trg_recalculate_rating 트리거 자동 재계산
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('reviews')
    .update({ rating, content: trimmedContent })
    .eq('id', reviewId)
    .eq('user_id', auth.user.id)
    .eq('status', 'published')
    .select('id, rating, content, created_at, updated_at')
    .maybeSingle()

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'Review not found or no longer editable.' }, { status: 404 })

  return NextResponse.json({ data: updated })
}

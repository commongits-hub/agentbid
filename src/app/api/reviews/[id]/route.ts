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
  if (!review)  return NextResponse.json({ error: '리뷰를 찾을 수 없습니다.' }, { status: 404 })

  // 본인 리뷰가 아닌 경우
  if (review.user_id !== auth.user.id) {
    return NextResponse.json({ error: '본인 리뷰만 수정할 수 있습니다.' }, { status: 403 })
  }

  // flagged / 삭제된 리뷰는 수정 불가
  if (review.status !== 'published') {
    return NextResponse.json({ error: '수정할 수 없는 상태의 리뷰입니다.' }, { status: 422 })
  }

  // ── 2. 7일 편집 창 확인 ──────────────────────────────────────────────────
  const createdAt = new Date(review.created_at).getTime()
  if (Date.now() - createdAt > EDIT_WINDOW_MS) {
    return NextResponse.json(
      { error: '리뷰 작성 후 7일이 지나면 수정할 수 없습니다.' },
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
    return NextResponse.json({ error: '별점은 1~5 정수여야 합니다.' }, { status: 400 })
  }

  if (typeof content !== 'string' || content.trim().length < 10) {
    return NextResponse.json({ error: '리뷰는 최소 10자 이상 작성해주세요.' }, { status: 400 })
  }

  const trimmedContent = content.trim()

  // ── 4. 변경 없으면 early return ──────────────────────────────────────────
  if (rating === review.rating && trimmedContent === review.content.trim()) {
    return NextResponse.json({ data: review })
  }

  // ── 5. 업데이트 ──────────────────────────────────────────────────────────
  // updated_at: trg_reviews_updated_at 트리거 자동 처리
  // avg_rating: trg_recalculate_rating 트리거 자동 재계산
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('reviews')
    .update({ rating, content: trimmedContent })
    .eq('id', reviewId)
    .select('id, rating, content, created_at, updated_at')
    .single()

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ data: updated })
}

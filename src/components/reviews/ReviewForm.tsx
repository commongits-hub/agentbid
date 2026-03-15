// src/components/reviews/ReviewForm.tsx
// TODO: StarRatingInput 공통 컴포넌트 분리 예정
//   ReviewForm + ReviewEditForm의 별점 UI (star map, hover, label, char count) 중복 구현 상태
//   다음 리팩토링 라운드에서 StarRatingInput.tsx로 추출 — 현재는 기능 안정성 우선으로 보류
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  orderId: string
  onSuccess?: () => void
}

export function ReviewForm({ orderId, onSuccess }: Props) {
  const [rating, setRating]   = useState(0)
  const [hover, setHover]     = useState(0)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (rating === 0) { setError('별점을 선택해주세요.'); return }
    if (content.trim().length < 10) { setError('리뷰는 최소 10자 이상 작성해주세요.'); return }

    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setError('로그인이 필요합니다.'); setLoading(false); return }

    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ order_id: orderId, rating, content }),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? '리뷰 작성 중 오류가 발생했습니다.')
      return
    }

    setDone(true)
    onSuccess?.()
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-800/50 bg-emerald-950/20 p-6 text-center">
        <p className="text-2xl">⭐</p>
        <p className="mt-2 text-sm font-semibold text-emerald-400">리뷰 작성 완료</p>
        <p className="mt-1 text-xs text-gray-500">소중한 리뷰가 에이전트 개선에 도움이 됩니다.</p>
        <div className="mt-3 flex justify-center gap-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className={`text-lg ${i < rating ? 'text-amber-400' : 'text-gray-700'}`}>★</span>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-400 italic">"{content}"</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
      <h3 className="text-sm font-semibold text-gray-200">리뷰 작성</h3>
      <p className="mt-0.5 text-xs text-gray-600">구매한 결과물에 대한 솔직한 평가를 남겨주세요.</p>

      {/* 별점 */}
      <div className="mt-4">
        <p className="text-xs text-gray-500 mb-2">별점</p>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map(star => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHover(star)}
              onMouseLeave={() => setHover(0)}
              className="text-2xl transition-transform hover:scale-110 focus:outline-none"
            >
              <span className={star <= (hover || rating) ? 'text-amber-400' : 'text-gray-700'}>
                ★
              </span>
            </button>
          ))}
          {(hover || rating) > 0 && (
            <span className="ml-2 self-center text-xs text-gray-500">
              {['', '별로예요', '아쉬워요', '보통이에요', '좋아요', '최고예요'][hover || rating]}
            </span>
          )}
        </div>
      </div>

      {/* 내용 */}
      <div className="mt-4">
        <p className="text-xs text-gray-500 mb-2">리뷰 내용 <span className="text-gray-700">(최소 10자)</span></p>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="결과물의 품질, 커뮤니케이션, 납기 등에 대한 경험을 공유해주세요."
          rows={4}
          className="w-full rounded-xl border border-gray-800 bg-gray-950/50 px-4 py-3 text-sm text-gray-200 placeholder-gray-600 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none"
        />
        <p className={`mt-1 text-right text-xs ${content.trim().length < 10 ? 'text-gray-700' : 'text-gray-500'}`}>
          {content.trim().length}자
        </p>
      </div>

      {/* 에러 */}
      {error && (
        <p className="mt-2 rounded-xl border border-red-800 bg-red-950/50 px-4 py-2.5 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* 제출 */}
      <button
        type="submit"
        disabled={loading || rating === 0 || content.trim().length < 10}
        className="mt-4 w-full rounded-2xl bg-emerald-500 py-2.5 text-sm font-semibold text-gray-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? '제출 중...' : '리뷰 작성하기'}
      </button>
    </form>
  )
}

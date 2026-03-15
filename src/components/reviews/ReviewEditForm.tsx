'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  reviewId:       string
  initialRating:  number
  initialContent: string
  onSuccess?: (updated: { rating: number; content: string }) => void
  onCancel?: () => void
}

export function ReviewEditForm({
  reviewId,
  initialRating,
  initialContent,
  onSuccess,
  onCancel,
}: Props) {
  const [rating,  setRating]  = useState(initialRating)
  const [hover,   setHover]   = useState(0)
  const [content, setContent] = useState(initialContent)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (rating === 0)                  { setError('별점을 선택해주세요.'); return }
    if (content.trim().length < 10)    { setError('리뷰는 최소 10자 이상 작성해주세요.'); return }

    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setError('로그인이 필요합니다.'); setLoading(false); return }

    const res = await fetch(`/api/reviews/${reviewId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ rating, content }),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? '리뷰 수정 중 오류가 발생했습니다.')
      return
    }

    onSuccess?.({ rating, content: content.trim() })
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-200">리뷰 수정</h3>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            취소
          </button>
        )}
      </div>
      <p className="text-xs text-gray-600 mb-4">작성 후 7일 이내까지 수정 가능합니다.</p>

      {/* 별점 */}
      <div>
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
              <span className={star <= (hover || rating) ? 'text-amber-400' : 'text-gray-700'}>★</span>
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
          rows={4}
          className="w-full rounded-xl border border-gray-800 bg-gray-950/50 px-4 py-3 text-sm text-gray-200 placeholder-gray-600 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none"
        />
        <p className={`mt-1 text-right text-xs ${content.trim().length < 10 ? 'text-gray-700' : 'text-gray-500'}`}>
          {content.trim().length}자
        </p>
      </div>

      {error && (
        <p className="mt-2 rounded-xl border border-red-800 bg-red-950/50 px-4 py-2.5 text-sm text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading || rating === 0 || content.trim().length < 10}
        className="mt-4 w-full rounded-2xl bg-emerald-500 py-2.5 text-sm font-semibold text-gray-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? '저장 중...' : '수정 저장'}
      </button>
    </form>
  )
}

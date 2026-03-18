// src/components/reviews/ReviewForm.tsx
// TODO: Extract StarRatingInput shared component
//   ReviewForm + ReviewEditForm share duplicate star UI — defer to next refactor round
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  orderId: string
  onSuccess?: () => void
}

const RATING_LABELS = ['', 'Poor', 'Below average', 'Average', 'Good', 'Excellent']

export function ReviewForm({ orderId, onSuccess }: Props) {
  const [rating, setRating]   = useState(0)
  const [hover, setHover]     = useState(0)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (rating === 0) { setError('Please select a rating.'); return }
    if (content.trim().length < 10) { setError('Review must be at least 10 characters.'); return }

    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setError('Please log in to submit a review.'); setLoading(false); return }

    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ order_id: orderId, rating, content }),
    })

    let data: any = null
    try { data = await res.json() } catch {}
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? 'Failed to submit review.')
      return
    }

    setDone(true)
    onSuccess?.()
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-800/50 bg-emerald-950/20 p-6 text-center">
        <p className="text-2xl">⭐</p>
        <p className="mt-2 text-sm font-semibold text-emerald-400">Review submitted</p>
        <p className="mt-1 text-xs text-gray-500">Your feedback helps improve the agent.</p>
        <div className="mt-3 flex justify-center gap-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className={`text-lg ${i < rating ? 'text-amber-400' : 'text-gray-700'}`}>★</span>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-400 italic line-clamp-2">
          "{content.length > 120 ? content.slice(0, 120) + '…' : content}"
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
      <h3 className="text-sm font-semibold text-gray-200">Leave a Review</h3>
      <p className="mt-0.5 text-xs text-gray-600">Share your honest feedback on the deliverable.</p>

      {/* Rating */}
      <div className="mt-4">
        <p className="text-xs text-gray-500 mb-2">Rating</p>
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
              {RATING_LABELS[hover || rating]}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="mt-4">
        <p className="text-xs text-gray-500 mb-2">Review <span className="text-gray-700">(min. 10 characters)</span></p>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Share your experience with quality, communication, and delivery."
          rows={4}
          className="w-full rounded-xl border border-gray-800 bg-gray-950/50 px-4 py-3 text-sm text-gray-200 placeholder-gray-600 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none"
        />
        <p className={`mt-1 text-right text-xs ${content.trim().length < 10 ? 'text-gray-700' : 'text-gray-500'}`}>
          {content.trim().length} chars
        </p>
      </div>

      {/* Error */}
      {error && (
        <p className="mt-2 rounded-xl border border-red-800 bg-red-950/50 px-4 py-2.5 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading || rating === 0 || content.trim().length < 10}
        className="mt-4 w-full rounded-2xl bg-emerald-500 py-2.5 text-sm font-semibold text-gray-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? 'Submitting...' : 'Submit Review'}
      </button>
    </form>
  )
}

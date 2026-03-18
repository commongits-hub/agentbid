'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Nav } from '@/components/layout/nav'

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────
type Agent = {
  id: string
  name: string
  description: string | null
  avg_rating: number | null
  completed_count: number
  follower_count: number
}

type Review = {
  id: string
  rating: number
  content: string
  created_at: string
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function StarRating({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <span className="text-amber-400" aria-label={`${rating} stars`}>
      {Array.from({ length: max }).map((_, i) => (
        <span key={i}>{i < Math.round(rating) ? '★' : '☆'}</span>
      ))}
    </span>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// ────────────────────────────────────────────────────────────
// Skeleton
// ────────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="min-h-screen bg-[#030712]">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-10 space-y-6">
        {/* Header skeleton */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-gray-800" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-40 rounded bg-gray-800" />
              <div className="h-3 w-56 rounded bg-gray-800" />
            </div>
            <div className="h-9 w-24 rounded-2xl bg-gray-800" />
          </div>
          <div className="mt-4 h-3 w-3/4 rounded bg-gray-800" />
          <div className="mt-2 h-3 w-1/2 rounded bg-gray-800" />
        </div>
        {/* Stats skeleton */}
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-2xl border border-gray-800 bg-gray-900 animate-pulse" />
          ))}
        </div>
        {/* Reviews skeleton */}
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-2xl border border-gray-800 bg-gray-900 animate-pulse" />
          ))}
        </div>
      </main>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────
export default function AgentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const agentId = params.id as string

  const [agent, setAgent] = useState<Agent | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Follow state
  const [userId, setUserId] = useState<string | null>(null)   // auth user id (= public.users.id)
  const [isFollowing, setIsFollowing] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [followError, setFollowError] = useState<string | null>(null)

  // ── Initial data load ──────────────────────────────────────
  useEffect(() => {
    if (!agentId) return
    const supabase = createClient()
    let cancelled = false

    async function load() {
      // 1. Agent
      const { data: agentData, error: agentError } = await supabase
        .from('agents')
        .select('id, name, description, avg_rating, completed_count, follower_count')
        .eq('id', agentId)
        .is('soft_deleted_at', null)
        .single()

      if (cancelled) return

      if (agentError || !agentData) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setAgent(agentData as Agent)

      // 2. Reviews (published, latest 5)
      const { data: reviewData } = await supabase
        .from('reviews')
        .select('id, rating, content, created_at')
        .eq('agent_id', agentId)
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(5)

      if (cancelled) return
      setReviews((reviewData as Review[]) ?? [])

      // 3. Auth session → follow check
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const uid = session.user.id   // public.users.id === auth.users.id
        setUserId(uid)

        const { data: followRow } = await supabase
          .from('follows')
          .select('id')
          .eq('agent_id', agentId)
          .eq('follower_id', uid)
          .maybeSingle()

        if (cancelled) return
        setIsFollowing(!!followRow)
      }

      if (cancelled) return
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [agentId])

  // ── Follow toggle ──────────────────────────────────────────
  const handleFollowToggle = useCallback(async () => {
    if (!userId || !agent) return
    setFollowLoading(true)
    setFollowError(null)

    const supabase = createClient()

    if (isFollowing) {
      // Unfollow
      const { error } = await supabase
        .from('follows')
        .delete()
        .eq('agent_id', agent.id)
        .eq('follower_id', userId)

      if (!error) {
        setIsFollowing(false)
        setAgent(prev => prev ? { ...prev, follower_count: Math.max(0, prev.follower_count - 1) } : prev)
      } else {
        setFollowError('Failed to unfollow. Please try again.')
      }
    } else {
      // Follow
      const { error } = await supabase
        .from('follows')
        .insert({ agent_id: agent.id, follower_id: userId })

      if (!error) {
        setIsFollowing(true)
        setAgent(prev => prev ? { ...prev, follower_count: prev.follower_count + 1 } : prev)
      } else {
        setFollowError('Failed to follow. Please try again.')
      }
    }

    setFollowLoading(false)
  }, [userId, agent, isFollowing])

  // ── Render states ──────────────────────────────────────────
  if (loading) return <Skeleton />

  if (notFound) {
    return (
      <div className="min-h-screen bg-[#030712]">
        <Nav />
        <main className="mx-auto max-w-3xl px-4 py-20 text-center">
          <p className="text-4xl">🤖</p>
          <h1 className="mt-4 text-xl font-bold text-gray-50">Agent not found</h1>
          <p className="mt-2 text-sm text-gray-500">This agent has been deleted or does not exist.</p>
          <button
            onClick={() => router.back()}
            className="mt-6 rounded-2xl border border-gray-700 px-5 py-2.5 text-sm text-gray-300 hover:border-gray-500 hover:text-gray-100 transition-colors"
          >
            ← 뒤로가기
          </button>
        </main>
      </div>
    )
  }

  if (!agent) return null

  const ratingDisplay = agent.avg_rating != null
    ? Number(agent.avg_rating).toFixed(1)
    : null

  return (
    <div className="min-h-screen bg-[#030712]">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-10 space-y-6">

        {/* ── Header card ────────────────────────────────────── */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gray-800 text-3xl"
              aria-hidden="true"
            >
              🤖
            </div>

            {/* Name + meta */}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-50 truncate">{agent.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-400">
                {ratingDisplay ? (
                  <span className="flex items-center gap-1">
                    <span className="text-amber-400">★</span>
                    <span className="font-medium text-gray-200">{ratingDisplay}</span>
                  </span>
                ) : (
                  <span className="text-gray-600 text-xs">평점 없음</span>
                )}
                <span className="text-gray-700">|</span>
                <span>
                  <span className="font-medium text-gray-200">{agent.completed_count.toLocaleString()}</span>
                  <span className="text-gray-500">tasks done</span>
                </span>
              </div>
            </div>

            {/* Follow button */}
            {userId ? (
              <div className="flex shrink-0 flex-col items-end gap-1">
                <button
                  onClick={handleFollowToggle}
                  disabled={followLoading}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold transition-all disabled:opacity-50 ${
                    isFollowing
                      ? 'bg-emerald-500 text-gray-950 hover:bg-emerald-400'
                      : 'border border-gray-700 text-gray-300 hover:border-emerald-500 hover:text-emerald-400'
                  }`}
                >
                  {followLoading ? '...' : isFollowing ? 'Following' : 'Follow'}
                </button>
                {followError && (
                  <p className="text-xs text-red-400">{followError}</p>
                )}
              </div>
            ) : (
              <button
                onClick={() => router.push('/auth/login')}
                className="shrink-0 rounded-2xl border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:border-gray-500 transition-colors"
              >
                팔로우
              </button>
            )}
          </div>

          {/* Bio */}
          <p className={`mt-4 text-sm leading-relaxed ${agent.description ? 'text-gray-300' : 'text-gray-600'}`}>
            {agent.description || 'No bio available.'}
          </p>
        </div>

        {/* ── Trust metrics grid ─────────────────────────────── */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5 text-center">
            <p className="text-xs text-gray-500">Total Completed</p>
            <p className="mt-1 text-2xl font-bold text-gray-50">
              {agent.completed_count.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-gray-600">건</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5 text-center">
            <p className="text-xs text-gray-500">Avg. Rating</p>
            <p className="mt-1 text-2xl font-bold text-emerald-400">
              {ratingDisplay ?? '—'}
            </p>
            <p className="mt-0.5 text-xs text-gray-600">{ratingDisplay ? '/ 5.0' : 'No reviews'}</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5 text-center">
            <p className="text-xs text-gray-500">Followers</p>
            <p className="mt-1 text-2xl font-bold text-gray-50">
              {agent.follower_count.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-gray-600">명</p>
          </div>
        </div>

        {/* ── Reviews section ────────────────────────────────── */}
        <section>
          <h2 className="text-base font-semibold text-gray-50 mb-4">Recent Reviews</h2>
          {reviews.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-800 p-10 text-center">
              <p className="text-sm text-gray-600">No reviews yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map(review => (
                <div
                  key={review.id}
                  className="rounded-2xl border border-gray-800 bg-gray-900 p-5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <StarRating rating={review.rating} />
                    <span className="text-xs text-gray-600">{formatDate(review.created_at)}</span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-gray-300">{review.content}</p>
                </div>
              ))}
            </div>
          )}
        </section>

      </main>
    </div>
  )
}

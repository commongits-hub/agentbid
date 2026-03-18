'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Nav } from '@/components/layout/nav'
import { StatusBadge } from '@/components/ui/badge'

type Task = {
  id: string; title: string; description: string; status: string
  budget_min: number | null; budget_max: number | null; user_id: string
  submission_count: number; created_at: string
}

type Submission = {
  id: string; agent_id: string; status: string
  quoted_price: number
  preview_text: string | null; preview_thumbnail_url: string | null
  content_text?: string | null; file_path?: string | null
}

type AgentSummary = {
  id: string
  name: string
  avg_rating: number | null
  completed_count: number
  recentReviews: { rating: number; content: string; created_at: string }[]
}

// Demo agent summaries
const DEMO_AGENTS: Record<string, AgentSummary> = {
  a1: { id: 'a1', name: 'LogoCraft AI',   avg_rating: 4.9, completed_count: 128, recentReviews: [{ rating: 5, content: 'Quality exceeded expectations. Would request again.', created_at: new Date(Date.now()-86400000).toISOString() }] },
  a2: { id: 'a2', name: 'DesignBot Pro',  avg_rating: 4.7, completed_count: 94,  recentReviews: [{ rating: 5, content: 'All 3 variations were polished. Highly recommended.', created_at: new Date(Date.now()-172800000).toISOString() }] },
  a3: { id: 'a3', name: 'IconFactory',    avg_rating: 4.6, completed_count: 61,  recentReviews: [{ rating: 4, content: 'Fast delivery and requirements were accurately reflected.', created_at: new Date(Date.now()-259200000).toISOString() }] },
}

// Demo submissions shown to logged-out visitors
const DEMO_SUBMISSIONS: Submission[] = [
  { id: 'ds1', agent_id: 'a1', status: 'submitted', quoted_price: 65000, preview_text: 'Minimal icon using brand colors and symbol. Built to iOS Human Interface Guidelines. SVG + PNG 1024px delivery available.', preview_thumbnail_url: null },
  { id: 'ds2', agent_id: 'a2', status: 'submitted', quoted_price: 72000, preview_text: 'Dynamic design expressing energy and motion. Includes 3 color variants and a dark mode version.', preview_thumbnail_url: null },
  { id: 'ds3', agent_id: 'a3', status: 'submitted', quoted_price: 55000, preview_text: 'Clean, highly recognizable icon. Fully compliant with Google Play and App Store guidelines. Vector source included.', preview_thumbnail_url: null },
]

const DEMO_TASK: Task = {
  id: 'demo', title: 'Mobile App Icon Design (iOS + Android)', status: 'open',
  description: 'Need icons for a new fitness app. Clean and minimal style.\n\nRequirements:\n- SVG + PNG 1024px delivery\n- Dark mode support\n- Google Play / App Store guideline compliance\n- 3 color variants',
  budget_min: 50000, budget_max: 80000, user_id: 'demo-user',
  submission_count: 3, created_at: new Date(Date.now()-3600000).toISOString()
}

const AGENT_NAMES: Record<string, string> = {
  a1: 'LogoCraft AI', a2: 'DesignBot Pro', a3: 'IconFactory',
}

export default function TaskDetailPage() {
  const { id: taskId } = useParams<{ id: string }>()
  const router = useRouter()
  const [task, setTask]           = useState<Task | null>(null)
  const [submissions, setSubs]    = useState<Submission[]>([])
  const [agents, setAgents]       = useState<Record<string, AgentSummary>>({})
  const [myUserId, setMyUserId]   = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [selecting, setSelecting] = useState<string | null>(null)
  const [isDemo, setIsDemo]       = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

  const [taskError, setTaskError] = useState<'not_found' | 'server_error' | null>(null)
  const [submissionsError, setSubmissionsError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      setMyUserId(session?.user.id ?? null)

      // demo-* route: 명시적 데모 ID → 실제 DB 조회 없이 데모 데이터 표시
      if (taskId.startsWith('demo')) {
        setTask(DEMO_TASK); setSubs(DEMO_SUBMISSIONS); setAgents(DEMO_AGENTS); setIsDemo(true); setLoading(false)
        return
      }

      const { data: t, error: fetchError } = await supabase
        .from('tasks')
        .select('id,title,description,status,budget_min,budget_max,user_id,submission_count,created_at')
        .eq('id', taskId).single()

      if (fetchError || !t) {
        // 404 or network error → 에러 상태 표시 (데모 데이터 아님)
        const code = fetchError?.code
        setTaskError(code === 'PGRST116' ? 'not_found' : 'server_error')
        setLoading(false)
        return
      }
      setTask(t as Task)

      if (session) {
        const res = await fetch(`/api/submissions?task_id=${taskId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const data = await res.json().catch(() => null)

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            setTaskError('server_error')
            setLoading(false)
            return
          }
          setSubmissionsError(data?.error ?? `Failed to load submissions (${res.status}).`)
        } else {
          const subs: Submission[] = data?.data ?? []
          setSubs(subs)

          // agent 요약 (평점 + 완료수 + 최근 리뷰) 조회
          const agentIds = [...new Set(subs.map(s => s.agent_id))].filter(Boolean)
          if (agentIds.length > 0) {
            const { data: agentRows } = await supabase
              .from('agents')
              .select('id, name, avg_rating, completed_count')
              .in('id', agentIds)

            const agentMap: Record<string, AgentSummary> = {}
            for (const a of agentRows ?? []) {
              agentMap[a.id] = { id: a.id, name: a.name, avg_rating: a.avg_rating, completed_count: a.completed_count, recentReviews: [] }
            }

            // 최근 리뷰 일괄 조회
            // TODO: agent별 최근 2개 보장 불가 — 첫 agent 리뷰가 많으면 뒤 agent는 0개로 보일 수 있음
            // 정확히 하려면 agent별 개별 조회 또는 RPC/view 필요
            const { data: reviewRows } = await supabase
              .from('reviews')
              .select('agent_id, rating, content, created_at')
              .in('agent_id', agentIds)
              .eq('status', 'published')
              .order('created_at', { ascending: false })
              .limit(agentIds.length * 2)

            for (const r of reviewRows ?? []) {
              if (agentMap[r.agent_id] && agentMap[r.agent_id].recentReviews.length < 2) {
                agentMap[r.agent_id].recentReviews.push({ rating: r.rating, content: r.content, created_at: r.created_at })
              }
            }
            setAgents(agentMap)
          }
        }
      }
      setLoading(false)
    }
    load()
  }, [taskId])

  async function handleCheckout(submissionId: string) {
    setCheckoutError(null)

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) { router.push('/auth/login'); return }

    setSelecting(submissionId)

    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ task_id: taskId, submission_id: submissionId }),
    })
    const data = await res.json().catch(() => null)

    if (data?.data?.checkout_url) {
      window.location.href = data.data.checkout_url
      return
    }

    setCheckoutError(data?.error ?? 'Failed to create checkout URL.')
    setSelecting(null)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030712]">
        <Nav />
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="h-8 w-48 animate-pulse rounded-xl bg-gray-900" />
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
            <div className="space-y-4">
              {[1,2,3].map(i => <div key={i} className="h-32 animate-pulse rounded-2xl bg-gray-900" />)}
            </div>
            <div className="space-y-4">
              {[1,2].map(i => <div key={i} className="h-48 animate-pulse rounded-2xl bg-gray-900" />)}
            </div>
          </div>
        </div>
      </div>
    )
  }
  if (taskError) {
    return (
      <div className="min-h-screen bg-[#030712]">
        <Nav />
        <div className="mx-auto max-w-lg px-4 py-20 text-center">
          <p className="text-4xl">{taskError === 'not_found' ? '🔍' : '⚠️'}</p>
          <h1 className="mt-4 text-xl font-bold text-gray-50">
            {taskError === 'not_found' ? 'Task not found' : 'Something went wrong'}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            {taskError === 'not_found'
              ? 'This task has been deleted or does not exist.'
              : 'Please try again later.'}
          </p>
          <Link href="/tasks" className="mt-6 inline-block rounded-2xl bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-gray-950 hover:bg-emerald-400 transition-colors">
            마켓으로 돌아가기
          </Link>
        </div>
      </div>
    )
  }

  if (!task) return null
  const isOwner    = myUserId === task.user_id
  const isLoggedIn = !!myUserId
  // canBuy: orders/route.ts 정책과 일치 — open + reviewing 모두 허용
  const canBuy     = isOwner && ['open', 'reviewing'].includes(task.status)

  const submittedSubs  = submissions.filter(s => s.status === 'submitted')
  const purchasedSub   = submissions.find(s => s.status === 'purchased')

  return (
    <div className="min-h-screen bg-[#030712]">
      <Nav />

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Breadcrumb */}
        <Link href="/tasks" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors">
          ← Back to Market
        </Link>

        {isDemo && (
          <div className="mt-4 rounded-2xl border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-400">
            Sample data — real tasks and AI agent submissions will appear here in production.
          </div>
        )}

        {/* Task header */}
        <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={task.status} />
                {(task.budget_min || task.budget_max) && (
                  <span className="rounded-full border border-emerald-800 bg-emerald-950/50 px-3 py-0.5 text-xs font-medium text-emerald-400">
                    ₩{task.budget_min?.toLocaleString()}{task.budget_max ? ` ~ ₩${task.budget_max.toLocaleString()}` : ' ~'}
                  </span>
                )}
                <span className="rounded-full border border-gray-700 bg-gray-800 px-3 py-0.5 text-xs text-gray-400">
                  {task.submission_count} submission{task.submission_count !== 1 ? 's' : ''}
                </span>
              </div>
              <h1 className="mt-3 text-xl font-bold leading-snug text-gray-50 sm:text-2xl">
                {task.title}
              </h1>
            </div>
          </div>
        </div>

        {/* 2-column layout */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_400px]">

          {/* LEFT — Task description */}
          <div className="space-y-6">
            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Task Description</h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-gray-300">
                {task.description}
              </p>
            </section>

            {/* Privacy notice */}
            <section className="rounded-2xl border border-gray-800 bg-gray-900/50 p-5">
              <div className="flex items-start gap-3">
                <span className="text-lg">🔒</span>
                <div>
                  <p className="text-sm font-medium text-gray-300">Full files unlocked after purchase</p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">
                    Preview shows a partial view. Complete payment to unlock full access to the original files.
                    Select a submission and complete checkout.
                  </p>
                </div>
              </div>
            </section>

            {/* Purchased result (owner only, after payment) */}
            {purchasedSub && isOwner && (
              <section className="rounded-2xl border border-emerald-800/50 bg-emerald-950/20 p-6">
                <div className="flex items-center gap-2 text-emerald-400">
                  <span>✓</span>
                  <h2 className="text-sm font-semibold">Purchase Complete — Full Deliverable</h2>
                </div>
                {purchasedSub.content_text && (
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-gray-300">
                    {purchasedSub.content_text}
                  </p>
                )}
                {purchasedSub.file_path && (
                  <a
                    href={`/api/submissions/${purchasedSub.id}/download`}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-800 bg-emerald-950/50 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-900/50 transition-colors"
                  >
                    📦 파일 다운로드
                  </a>
                )}
              </section>
            )}
          </div>

          {/* RIGHT — Submissions panel */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-50">
                AI 에이전트 제출물
                <span className="ml-2 text-gray-500">
                  ({isDemo ? DEMO_SUBMISSIONS.length : submittedSubs.length})
                </span>
              </h2>
              {!isLoggedIn && (
                <Link href="/auth/login" className="text-xs text-emerald-400 hover:underline">
                  로그인 후 구매 →
                </Link>
              )}
            </div>

            {checkoutError && (
              <div className="rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
                {checkoutError}
              </div>
            )}

            {submissionsError && (
              <div className="rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
                {submissionsError}
              </div>
            )}

            {/* Empty state */}
            {submissions.length === 0 && !isDemo && (
              <div className="rounded-2xl border border-dashed border-gray-800 p-10 text-center">
                <p className="text-2xl">🤖</p>
                <p className="mt-3 text-sm font-medium text-gray-400">No submissions yet</p>
                <p className="mt-1 text-xs text-gray-600">AI agents are reviewing the task.</p>
              </div>
            )}

            {/* Submission cards */}
            {(isDemo ? DEMO_SUBMISSIONS : submissions).map((sub, idx) => {
              const agentInfo   = agents[sub.agent_id]
              const agentName   = agentInfo?.name ?? (isDemo ? AGENT_NAMES[sub.agent_id] : null) ?? `Agent ${idx + 1}`
              const avgRating   = agentInfo?.avg_rating
              const completedCt = agentInfo?.completed_count ?? 0
              const reviews     = agentInfo?.recentReviews ?? []
              const isPurchased = sub.status === 'purchased'
              const isSelected  = sub.status === 'selected'

              return (
                <div
                  key={sub.id}
                  className={`rounded-2xl border p-5 transition-colors ${
                    isPurchased
                      ? 'border-emerald-800/50 bg-emerald-950/20'
                      : 'border-gray-800 bg-gray-900 hover:border-gray-700'
                  }`}
                >
                  {/* Agent info */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gray-800 text-sm">
                        🤖
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-200">{agentName}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {avgRating != null ? (
                            <span className="text-xs text-amber-400">
                              ★ {avgRating.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-600">No rating</span>
                          )}
                          {completedCt > 0 && (
                            <span className="text-xs text-gray-600">· {completedCt} completed</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <StatusBadge status={sub.status} />
                  </div>

                  {/* Recent reviews */}
                  {reviews.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {reviews.map((rv, ri) => (
                        <div key={ri} className="rounded-xl border border-gray-800/50 bg-gray-950/30 px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-amber-400">{'★'.repeat(rv.rating)}{'☆'.repeat(5-rv.rating)}</span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500 line-clamp-2">{rv.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {!agentInfo && !isDemo && (
                    <p className="mt-2 text-xs text-gray-700">No reviews</p>
                  )}

                  {/* Thumbnail */}
                  {sub.preview_thumbnail_url && (
                    <div className="mt-3 overflow-hidden rounded-xl">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={sub.preview_thumbnail_url} alt="preview" className="w-full object-cover" />
                    </div>
                  )}

                  {/* Preview text */}
                  <div className="mt-3 rounded-xl border border-gray-800 bg-gray-950/50 p-3">
                    <p className="text-xs leading-relaxed text-gray-400 line-clamp-4">
                      {sub.preview_text ?? '(No preview)'}
                    </p>
                    {!isPurchased && (
                      <p className="mt-2 flex items-center gap-1 text-xs text-gray-600">
                        <span>🔒</span> Full result unlocked after purchase
                      </p>
                    )}
                  </div>

                  {/* Price + CTA */}
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-base font-bold text-gray-50">
                      ₩{sub.quoted_price.toLocaleString()}
                    </p>
                    <div>
                      {isPurchased && (
                        <span className="text-xs font-semibold text-emerald-400">✓ Purchased</span>
                      )}
                      {isSelected && (
                        <span className="text-xs font-semibold text-blue-400">Payment in progress</span>
                      )}
                      {canBuy && sub.status === 'submitted' && !isDemo && (
                        <button
                          onClick={() => handleCheckout(sub.id)}
                          disabled={!!selecting}
                          className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-gray-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
                        >
                          {selecting === sub.id ? 'Processing...' : 'Select & Pay'}
                        </button>
                      )}
                      {isDemo && (
                        <span className="text-xs text-amber-400">Sample submission</span>
                      )}
                      {!isOwner && !isPurchased && isLoggedIn && sub.status === 'submitted' && (
                        <span className="text-xs text-gray-600">Comparing</span>
                      )}
                      {!isLoggedIn && sub.status === 'submitted' && (
                        <Link href="/auth/login" className="rounded-xl border border-gray-700 bg-gray-800 px-4 py-2 text-xs text-gray-300 hover:bg-gray-700 transition-colors">
                          Sign in to buy
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Not owner notice */}
            {task.status === 'completed' && !isOwner && (
              <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-4 text-center">
                <p className="text-xs text-gray-500">This task has already been completed.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

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
  a1: { id: 'a1', name: 'LogoCraft AI',   avg_rating: 4.9, completed_count: 128, recentReviews: [{ rating: 5, content: '퀄리티가 예상보다 훨씬 높았습니다. 재요청 의사 있습니다.', created_at: new Date(Date.now()-86400000).toISOString() }] },
  a2: { id: 'a2', name: 'DesignBot Pro',  avg_rating: 4.7, completed_count: 94,  recentReviews: [{ rating: 5, content: '변형안 3개 모두 완성도 높았습니다. 추천합니다.', created_at: new Date(Date.now()-172800000).toISOString() }] },
  a3: { id: 'a3', name: 'IconFactory',    avg_rating: 4.6, completed_count: 61,  recentReviews: [{ rating: 4, content: '전달 속도가 빠르고 요구사항 반영이 정확했습니다.', created_at: new Date(Date.now()-259200000).toISOString() }] },
}

// Demo submissions shown to logged-out visitors
const DEMO_SUBMISSIONS: Submission[] = [
  { id: 'ds1', agent_id: 'a1', status: 'submitted', quoted_price: 65000, preview_text: '브랜드 컬러와 심볼을 활용한 미니멀 아이콘입니다. iOS Human Interface Guidelines 기준으로 제작했으며 SVG, PNG 1024px 납품 가능합니다.', preview_thumbnail_url: null },
  { id: 'ds2', agent_id: 'a2', status: 'submitted', quoted_price: 72000, preview_text: '활동성과 에너지를 표현한 역동적인 디자인입니다. 3가지 컬러 변형본과 다크모드 버전 포함하여 납품합니다.', preview_thumbnail_url: null },
  { id: 'ds3', agent_id: 'a3', status: 'submitted', quoted_price: 55000, preview_text: '심플하고 인식률 높은 아이콘입니다. 구글 플레이 및 앱스토어 가이드라인 완벽 준수, 벡터 원본 포함됩니다.', preview_thumbnail_url: null },
]

const DEMO_TASK: Task = {
  id: 'demo', title: '모바일 앱 아이콘 디자인 (iOS + Android)', status: 'open',
  description: '신규 피트니스 앱의 아이콘이 필요합니다. 활동적이고 미니멀한 느낌으로 제작해주세요.\n\n요구사항:\n- SVG + PNG 1024px 납품\n- 다크모드 대응\n- 구글 플레이 / 앱스토어 가이드라인 준수\n- 3가지 컬러 변형안 포함',
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
        const data = await res.json()
        const subs: Submission[] = data.data ?? []
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
      setLoading(false)
    }
    load()
  }, [taskId])

  async function handleCheckout(submissionId: string) {
    setSelecting(submissionId)
    setCheckoutError(null)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/auth/login'); return }

    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ task_id: taskId, submission_id: submissionId }),
    })
    const data = await res.json()

    if (data.data?.checkout_url) {
      window.location.href = data.data.checkout_url
    } else {
      setCheckoutError(data.error ?? '결제 URL 생성에 실패했습니다.')
      setSelecting(null)
    }
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
            {taskError === 'not_found' ? '작업을 찾을 수 없습니다' : '오류가 발생했습니다'}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            {taskError === 'not_found'
              ? '삭제됐거나 존재하지 않는 작업입니다.'
              : '잠시 후 다시 시도해주세요.'}
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
  const canBuy     = isOwner && task.status === 'open'

  const submittedSubs  = submissions.filter(s => s.status === 'submitted')
  const purchasedSub   = submissions.find(s => s.status === 'purchased')

  return (
    <div className="min-h-screen bg-[#030712]">
      <Nav />

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Breadcrumb */}
        <Link href="/tasks" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors">
          ← 마켓으로
        </Link>

        {isDemo && (
          <div className="mt-4 rounded-2xl border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-400">
            샘플 데이터입니다. 실제 서비스에서는 등록된 작업과 AI 에이전트 제출물이 표시됩니다.
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
                  제출 {task.submission_count}건
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
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">작업 설명</h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-gray-300">
                {task.description}
              </p>
            </section>

            {/* Privacy notice */}
            <section className="rounded-2xl border border-gray-800 bg-gray-900/50 p-5">
              <div className="flex items-start gap-3">
                <span className="text-lg">🔒</span>
                <div>
                  <p className="text-sm font-medium text-gray-300">원본 파일은 구매 후 공개됩니다</p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">
                    미리보기는 결과물의 일부만 노출합니다. 구매를 완료하면 원본 파일 전체에 접근할 수 있습니다.
                    마음에 드는 제출물을 선택하고 결제를 완료하세요.
                  </p>
                </div>
              </div>
            </section>

            {/* Purchased result (owner only, after payment) */}
            {purchasedSub && isOwner && (
              <section className="rounded-2xl border border-emerald-800/50 bg-emerald-950/20 p-6">
                <div className="flex items-center gap-2 text-emerald-400">
                  <span>✓</span>
                  <h2 className="text-sm font-semibold">구매 완료 — 전체 결과물</h2>
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
                  ({isDemo ? DEMO_SUBMISSIONS.length : submittedSubs.length}건)
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

            {/* Empty state */}
            {submissions.length === 0 && !isDemo && (
              <div className="rounded-2xl border border-dashed border-gray-800 p-10 text-center">
                <p className="text-2xl">🤖</p>
                <p className="mt-3 text-sm font-medium text-gray-400">아직 제출된 결과물이 없습니다</p>
                <p className="mt-1 text-xs text-gray-600">AI 에이전트들이 작업을 검토 중입니다.</p>
              </div>
            )}

            {/* Submission cards */}
            {(isDemo ? DEMO_SUBMISSIONS : submissions).map((sub, idx) => {
              const agentInfo   = agents[sub.agent_id]
              const agentName   = agentInfo?.name ?? (isDemo ? AGENT_NAMES[sub.agent_id] : null) ?? `에이전트 ${idx + 1}`
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
                            <span className="text-xs text-gray-600">평점 없음</span>
                          )}
                          {completedCt > 0 && (
                            <span className="text-xs text-gray-600">· {completedCt}건 완료</span>
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
                    <p className="mt-2 text-xs text-gray-700">리뷰 정보 없음</p>
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
                      {sub.preview_text ?? '(미리보기 없음)'}
                    </p>
                    {!isPurchased && (
                      <p className="mt-2 flex items-center gap-1 text-xs text-gray-600">
                        <span>🔒</span> 구매 후 전체 결과물 확인 가능
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
                        <span className="text-xs font-semibold text-emerald-400">✓ 구매 완료</span>
                      )}
                      {isSelected && (
                        <span className="text-xs font-semibold text-blue-400">결제 진행 중</span>
                      )}
                      {canBuy && sub.status === 'submitted' && !isDemo && (
                        <button
                          onClick={() => handleCheckout(sub.id)}
                          disabled={!!selecting}
                          className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-gray-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
                        >
                          {selecting === sub.id ? '처리 중...' : '선택 · 결제'}
                        </button>
                      )}
                      {canBuy && sub.status === 'submitted' && isDemo && (
                        <Link href="/auth/signup" className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-gray-950 hover:bg-emerald-400 transition-colors">
                          로그인 후 구매
                        </Link>
                      )}
                      {!isOwner && !isPurchased && isLoggedIn && sub.status === 'submitted' && (
                        <span className="text-xs text-gray-600">비교 중</span>
                      )}
                      {!isLoggedIn && sub.status === 'submitted' && (
                        <Link href="/auth/login" className="rounded-xl border border-gray-700 bg-gray-800 px-4 py-2 text-xs text-gray-300 hover:bg-gray-700 transition-colors">
                          로그인 후 구매
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
                <p className="text-xs text-gray-500">이 작업은 이미 완료되었습니다.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

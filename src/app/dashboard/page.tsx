'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Nav } from '@/components/layout/nav'
import { StatusBadge } from '@/components/ui/badge'
import { ReviewForm } from '@/components/reviews/ReviewForm'
import { ReviewEditForm } from '@/components/reviews/ReviewEditForm'

const EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7일

type ReviewData = { id: string; rating: number; content: string; created_at: string }

type MyTask = {
  id: string; title: string; status: string
  budget_min: number | null; budget_max: number | null
  submission_count: number; created_at: string
}
type MyOrder = {
  id: string; task_id: string; amount: number
  status: string; paid_at: string | null; created_at: string
}
type Payout = {
  id: string; amount: number
  status: 'pending' | 'hold' | 'released' | 'transferred' | 'cancelled'
  release_at: string; transferred_at: string | null
  orders: { amount: number; paid_at: string | null; tasks: { title: string } | null } | null
}

const DEMO_TASKS: MyTask[] = [
  { id: 'd1', title: '모바일 앱 아이콘 디자인', status: 'open', budget_min: 50000, budget_max: 80000, submission_count: 4, created_at: new Date(Date.now()-3600000).toISOString() },
  { id: 'd2', title: '신제품 론칭 보도자료 작성', status: 'completed', budget_min: 80000, budget_max: null, submission_count: 7, created_at: new Date(Date.now()-86400000).toISOString() },
  { id: 'd3', title: '월간 매출 데이터 시각화', status: 'reviewing', budget_min: 100000, budget_max: 150000, submission_count: 2, created_at: new Date(Date.now()-172800000).toISOString() },
]
const DEMO_PAYOUTS: Payout[] = [
  { id: 'p1', amount: 80000, status: 'transferred', release_at: '', transferred_at: new Date(Date.now()-86400000).toISOString(), orders: { amount: 100000, paid_at: new Date(Date.now()-86400000).toISOString(), tasks: { title: '앱 아이콘 디자인' } } },
  { id: 'p2', amount: 48000, status: 'released', release_at: '', transferred_at: null, orders: { amount: 60000, paid_at: new Date(Date.now()-3600000).toISOString(), tasks: { title: '보도자료 작성' } } },
  { id: 'p3', amount: 32000, status: 'pending', release_at: new Date(Date.now()+86400000*5).toISOString(), transferred_at: null, orders: { amount: 40000, paid_at: new Date().toISOString(), tasks: { title: '마케팅 카피 세트' } } },
]

// payout 우선순위 정렬: released/hold → pending → transferred/cancelled
const PAYOUT_SORT: Record<string, number> = { released: 0, hold: 1, pending: 2, transferred: 3, cancelled: 4 }

function timeAgo(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000)
  if (h < 1) return '방금'; if (h < 24) return `${h}시간 전`
  return `${Math.floor(h/24)}일 전`
}

export default function DashboardPage() {
  const router = useRouter()
  const [appRole, setAppRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [myTasks, setMyTasks]   = useState<MyTask[]>([])
  const [myOrders, setMyOrders] = useState<MyOrder[]>([])
  const [payouts, setPayouts]   = useState<Payout[]>([])
  const [stripeConnected, setStripeConnected] = useState(false)
  const [isDemo, setIsDemo] = useState(false)
  const [reviewMap, setReviewMap]             = useState<Map<string, ReviewData>>(new Map())
  const [reviewingOrderId, setReviewingOrderId] = useState<string | null>(null)
  const [editingOrderId, setEditingOrderId]     = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/auth/login?returnTo=/dashboard'); return }

      const meta = session.user.app_metadata ?? {}
      const role = (meta.app_role ?? session.user.user_metadata?.app_role ?? session.user.user_metadata?.role ?? 'user') as string
      setAppRole(role)

      if (role === 'provider') {
        const res = await fetch('/api/payouts', { headers: { Authorization: `Bearer ${session.access_token}` } })
        const data = await res.json()
        const list = data.data ?? []
        setPayouts(list); setStripeConnected(data.meta?.stripe_connected ?? false)
        if (list.length === 0) { setPayouts(DEMO_PAYOUTS); setIsDemo(true) }
      } else {
        const { data: tasks } = await supabase
          .from('tasks')
          .select('id,title,status,budget_min,budget_max,submission_count,created_at')
          .eq('user_id', session.user.id)
          .is('soft_deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(20)
        const { data: orders } = await supabase
          .from('orders')
          .select('id,task_id,amount,status,paid_at,created_at')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(10)
        const taskList  = (tasks  as MyTask[])  ?? []
        const orderList = (orders as MyOrder[]) ?? []
        setMyTasks(taskList); setMyOrders(orderList)
        if (taskList.length === 0) { setMyTasks(DEMO_TASKS); setIsDemo(true) }

        const paidOrders = orderList.filter(o => o.status === 'paid')
        if (paidOrders.length > 0) {
          const reviewChecks = await Promise.all(
            paidOrders.map(o =>
              fetch(`/api/reviews?order_id=${o.id}`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
              }).then(r => r.json()).then(d => ({ orderId: o.id, review: d.data ?? null }))
            )
          )
          const map = new Map<string, ReviewData>()
          for (const { orderId, review } of reviewChecks) {
            if (review) map.set(orderId, review)
          }
          setReviewMap(map)
        }
      }
      setLoading(false)
    }
    init()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030712]">
        <Nav />
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="grid gap-4 sm:grid-cols-2">
            {[1,2].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-900" />)}
          </div>
        </div>
      </div>
    )
  }

  /* ── OWNER VIEW ──────────────────────────────────────────── */
  if (appRole !== 'provider') {
    const tasksNeedingReview  = myTasks.filter(t => t.status === 'open' && t.submission_count > 0)
    const ordersNeedingReview = myOrders.filter(o => o.status === 'paid' && !reviewMap.has(o.id))
    const paidTotal           = myOrders.filter(o => o.status === 'paid').reduce((s, o) => s + o.amount, 0)

    // 주문 정렬: 리뷰 미작성 우선
    const sortedOrders = [...myOrders].sort((a, b) => {
      const aNeeds = a.status === 'paid' && !reviewMap.has(a.id) ? 0 : 1
      const bNeeds = b.status === 'paid' && !reviewMap.has(b.id) ? 0 : 1
      return aNeeds - bNeeds
    })

    return (
      <div className="min-h-screen bg-[#030712]">
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-10">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-50">대시보드</h1>
            <Link
              href="/tasks/new"
              className="rounded-2xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-gray-950 hover:bg-emerald-400 transition-colors"
            >
              + 작업 등록
            </Link>
          </div>

          {isDemo && (
            <div className="mt-4 rounded-2xl border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-400">
              샘플 데이터 표시 중 — 작업을 등록하면 실제 데이터가 표시됩니다.
            </div>
          )}

          {/* 지금 해야 할 일 */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Link
              href="/tasks"
              className={`group rounded-2xl border p-5 transition-colors ${
                tasksNeedingReview.length > 0
                  ? 'border-blue-800/60 bg-blue-950/20 hover:border-blue-700'
                  : 'border-gray-800 bg-gray-900 hover:border-gray-700'
              }`}
            >
              <p className="text-xs text-gray-500">제출 검토 필요</p>
              <p className={`mt-1 text-2xl font-bold ${tasksNeedingReview.length > 0 ? 'text-blue-400' : 'text-gray-50'}`}>
                {tasksNeedingReview.length}건
              </p>
              <p className="mt-1 text-xs text-gray-600 group-hover:text-gray-500 transition-colors">
                {tasksNeedingReview.length > 0 ? '제출물을 확인하고 선택하세요 →' : '아직 제출물이 없습니다'}
              </p>
            </Link>

            <div className={`rounded-2xl border p-5 ${
              ordersNeedingReview.length > 0
                ? 'border-amber-800/60 bg-amber-950/20'
                : 'border-gray-800 bg-gray-900'
            }`}>
              <p className="text-xs text-gray-500">리뷰 작성 필요</p>
              <p className={`mt-1 text-2xl font-bold ${ordersNeedingReview.length > 0 ? 'text-amber-400' : 'text-gray-50'}`}>
                {ordersNeedingReview.length}건
              </p>
              <p className="mt-1 text-xs text-gray-600">
                {paidTotal > 0 ? `총 결제 ₩${paidTotal.toLocaleString()}` : '아직 결제 완료 주문 없음'}
              </p>
            </div>
          </div>

          {/* Tasks */}
          <section className="mt-10">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-50">내 작업</h2>
              <Link href="/tasks" className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors">마켓 보기 →</Link>
            </div>
            {myTasks.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-gray-800 p-10 text-center">
                <p className="text-sm text-gray-500">아직 등록한 작업이 없습니다.</p>
                <Link href="/tasks/new" className="mt-3 inline-block text-sm text-emerald-400 hover:underline">
                  첫 작업 등록하기 →
                </Link>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {myTasks.map(t => {
                  const needsAttention = t.status === 'open' && t.submission_count > 0
                  return (
                    <Link
                      key={t.id}
                      href={t.id.startsWith('d') ? '#' : `/tasks/${t.id}`}
                      className={`flex items-center justify-between gap-4 rounded-2xl border p-4 transition-colors ${
                        needsAttention
                          ? 'border-blue-800/50 bg-blue-950/10 hover:border-blue-700'
                          : 'border-gray-800 bg-gray-900 hover:border-gray-700 hover:bg-gray-800/80'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-50">{t.title}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {timeAgo(t.created_at)} · 제출{' '}
                          <span className={`font-medium ${needsAttention ? 'text-blue-400' : 'text-gray-400'}`}>
                            {t.submission_count}
                          </span>건
                          {needsAttention && <span className="ml-2 text-blue-500">검토 필요</span>}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {t.budget_min && (
                          <span className="text-xs text-gray-500">
                            ₩{t.budget_min.toLocaleString()}{t.budget_max ? `~` : '~'}
                          </span>
                        )}
                        <StatusBadge status={t.status} />
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </section>

          {/* Orders — 리뷰 필요 우선 */}
          {myOrders.length > 0 && (
            <section className="mt-10">
              <h2 className="text-lg font-semibold text-gray-50">최근 주문</h2>
              <div className="mt-4 space-y-3">
                {sortedOrders.map(o => {
                  const needsReview = o.status === 'paid' && !reviewMap.has(o.id)
                  return (
                    <div
                      key={o.id}
                      className={`rounded-2xl border p-4 ${
                        needsReview
                          ? 'border-amber-800/40 bg-amber-950/10'
                          : 'border-gray-800 bg-gray-900'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-50">₩{o.amount.toLocaleString()}</p>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {o.paid_at ? `결제 완료 · ${timeAgo(o.paid_at)}` : timeAgo(o.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {o.status === 'paid' && !reviewMap.has(o.id) && reviewingOrderId !== o.id && (
                            <button
                              onClick={() => setReviewingOrderId(o.id)}
                              className="rounded-xl border border-amber-800/60 bg-amber-950/30 px-3 py-1 text-xs font-medium text-amber-400 hover:border-amber-700 transition-colors"
                            >
                              리뷰 작성 →
                            </button>
                          )}
                          {o.status === 'paid' && reviewMap.has(o.id) && editingOrderId !== o.id && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600">리뷰 완료 ✓</span>
                              {Date.now() - new Date(reviewMap.get(o.id)!.created_at).getTime() < EDIT_WINDOW_MS && (
                                <button
                                  onClick={() => setEditingOrderId(o.id)}
                                  className="rounded-xl border border-gray-700 px-3 py-1 text-xs text-gray-400 hover:border-gray-600 hover:text-gray-300 transition-colors"
                                >
                                  수정
                                </button>
                              )}
                            </div>
                          )}
                          <StatusBadge status={o.status} />
                        </div>
                      </div>

                      {reviewingOrderId === o.id && (
                        <div className="mt-4">
                          <ReviewForm
                            orderId={o.id}
                            onSuccess={() => {
                              const supabase = createClient()
                              supabase.auth.getSession().then(({ data: { session } }) => {
                                if (!session) return
                                fetch(`/api/reviews?order_id=${o.id}`, {
                                  headers: { Authorization: `Bearer ${session.access_token}` },
                                }).then(r => r.json()).then(d => {
                                  if (d.data) setReviewMap(prev => new Map(prev).set(o.id, d.data))
                                })
                              })
                              setReviewingOrderId(null)
                            }}
                          />
                        </div>
                      )}
                      {editingOrderId === o.id && reviewMap.has(o.id) && (
                        <div className="mt-4">
                          <ReviewEditForm
                            reviewId={reviewMap.get(o.id)!.id}
                            initialRating={reviewMap.get(o.id)!.rating}
                            initialContent={reviewMap.get(o.id)!.content}
                            onSuccess={({ rating, content }) => {
                              setReviewMap(prev => {
                                const next = new Map(prev)
                                next.set(o.id, { ...next.get(o.id)!, rating, content })
                                return next
                              })
                              setEditingOrderId(null)
                            }}
                            onCancel={() => setEditingOrderId(null)}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </main>
      </div>
    )
  }

  /* ── PROVIDER VIEW ───────────────────────────────────────── */
  const holdPayouts     = payouts.filter(p => p.status === 'hold')
  const releasedPayouts = payouts.filter(p => p.status === 'released')
  const totalReleased   = releasedPayouts.reduce((s, p) => s + p.amount, 0)
  const totalHold       = holdPayouts.reduce((s, p) => s + p.amount, 0)
  const totalPending    = payouts.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0)
  const totalTransferred = payouts.filter(p => p.status === 'transferred').reduce((s, p) => s + p.amount, 0)

  const sortedPayouts = [...payouts].sort(
    (a, b) => (PAYOUT_SORT[a.status] ?? 9) - (PAYOUT_SORT[b.status] ?? 9)
  )

  const payoutStatusMeta: Record<string, { label: string; cls: string }> = {
    pending:     { label: '정산 대기 중 (7일 후 처리)', cls: 'text-amber-400' },
    hold:        { label: '보류 — Stripe 계좌 연결 필요', cls: 'text-orange-400' },
    released:    { label: '정산 가능 — 지급 처리 중',    cls: 'text-blue-400' },
    transferred: { label: '지급 완료',                   cls: 'text-emerald-400' },
    cancelled:   { label: '환불로 인해 취소됨',           cls: 'text-gray-500' },
  }

  // Stripe 미연결: 행동 유도 최우선
  if (!stripeConnected) {
    return (
      <div className="min-h-screen bg-[#030712]">
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-10">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-50">Provider 대시보드</h1>
            <Link href="/tasks" className="text-sm text-gray-400 hover:text-gray-300 transition-colors">
              작업 탐색 →
            </Link>
          </div>

          {/* Stripe 연결 CTA — 블로킹 */}
          <div className="mt-6 rounded-2xl border border-amber-700/60 bg-amber-950/30 p-8">
            <div className="flex items-start gap-4">
              <div className="shrink-0 rounded-xl border border-amber-800 bg-amber-950/50 p-3">
                <span className="text-2xl">💳</span>
              </div>
              <div className="flex-1">
                <p className="text-base font-semibold text-amber-400">Stripe 계좌 연결이 필요합니다</p>
                <p className="mt-1 text-sm text-amber-600">
                  정산 가능 상태가 되어도 Stripe 계좌 없이는 지급이 보류됩니다.
                  {totalHold > 0 && (
                    <span className="ml-1 font-medium text-orange-400">
                      현재 ₩{totalHold.toLocaleString()} 보류 중
                    </span>
                  )}
                </p>
                <Link
                  href="/onboarding/stripe"
                  className="mt-4 inline-block rounded-2xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-gray-950 hover:bg-amber-400 transition-colors"
                >
                  지금 Stripe 연결하기 →
                </Link>
              </div>
            </div>
          </div>

          {isDemo && (
            <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-900/50 px-4 py-3 text-sm text-gray-500">
              샘플 데이터 표시 중 — 작업을 완료하면 실제 정산 내역이 표시됩니다.
            </div>
          )}

          {/* 정산 내역 (연결 전에도 확인 가능) */}
          {sortedPayouts.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-gray-50">정산 내역</h2>
              <div className="mt-4 space-y-3">
                {sortedPayouts.map(p => (
                  <PayoutCard key={p.id} p={p} meta={payoutStatusMeta} />
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    )
  }

  // Stripe 연결 완료
  return (
    <div className="min-h-screen bg-[#030712]">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-10">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-50">Provider 대시보드</h1>
            <div className="mt-1 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs text-emerald-400">Stripe 연결됨</span>
            </div>
          </div>
          <Link
            href="/tasks"
            className="rounded-2xl border border-gray-700 px-5 py-2.5 text-sm text-gray-300 hover:border-gray-500 hover:text-gray-50 transition-colors"
          >
            새 작업 탐색 →
          </Link>
        </div>

        {isDemo && (
          <div className="mt-4 rounded-2xl border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-400">
            샘플 데이터 표시 중 — 작업을 완료하면 실제 정산 내역이 표시됩니다.
          </div>
        )}

        {/* Stats — 행동 필요 우선 */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className={`rounded-2xl border p-5 ${
            totalReleased > 0 ? 'border-blue-800/60 bg-blue-950/20' : 'border-gray-800 bg-gray-900'
          }`}>
            <p className="text-xs text-gray-500">정산 가능</p>
            <p className={`mt-1 text-2xl font-bold ${totalReleased > 0 ? 'text-blue-400' : 'text-gray-50'}`}>
              ₩{totalReleased.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-gray-600">
              {totalReleased > 0 ? '지급 처리 진행 중' : '아직 정산 가능 금액 없음'}
            </p>
          </div>

          <div className={`rounded-2xl border p-5 ${
            totalHold > 0 ? 'border-orange-800/60 bg-orange-950/20' : 'border-gray-800 bg-gray-900'
          }`}>
            <p className="text-xs text-gray-500">대기 중</p>
            <p className={`mt-1 text-2xl font-bold ${totalPending > 0 || totalHold > 0 ? 'text-amber-400' : 'text-gray-50'}`}>
              ₩{(totalPending + totalHold).toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-gray-600">
              {totalHold > 0 ? `₩${totalHold.toLocaleString()} 보류 포함` : '구매 후 7일 대기'}
            </p>
          </div>

          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
            <p className="text-xs text-gray-500">지급 완료</p>
            <p className="mt-1 text-2xl font-bold text-emerald-400">
              ₩{totalTransferred.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-gray-600">누적 수령액</p>
          </div>
        </div>

        {/* Payout list — urgency 정렬 */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-gray-50">정산 내역</h2>
          {sortedPayouts.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-gray-800 p-10 text-center">
              <p className="text-sm text-gray-500">아직 정산 내역이 없습니다.</p>
              <Link href="/tasks" className="mt-3 inline-block text-sm text-emerald-400 hover:underline">
                작업 탐색하기 →
              </Link>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {sortedPayouts.map(p => (
                <PayoutCard key={p.id} p={p} meta={payoutStatusMeta} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function PayoutCard({
  p,
  meta,
}: {
  p: Payout
  meta: Record<string, { label: string; cls: string }>
}) {
  const isUrgent = p.status === 'released' || p.status === 'hold'
  return (
    <div className={`rounded-2xl border p-5 ${
      p.status === 'released' ? 'border-blue-800/40 bg-blue-950/10' :
      p.status === 'hold'     ? 'border-orange-800/40 bg-orange-950/10' :
      'border-gray-800 bg-gray-900'
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-50">
            {p.orders?.tasks?.title ?? '(작업 없음)'}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            총 결제액 ₩{(p.orders?.amount ?? 0).toLocaleString()} →{' '}
            <span className="font-medium text-gray-300">정산액 ₩{p.amount.toLocaleString()}</span>
            <span className="ml-1 text-gray-600">(수수료 20%)</span>
          </p>
          <p className={`mt-1 text-xs ${meta[p.status]?.cls ?? 'text-gray-500'}`}>
            {p.status === 'pending' && p.release_at
              ? `정산 가능일: ${new Date(p.release_at).toLocaleDateString('ko-KR')}`
              : meta[p.status]?.label}
            {p.status === 'transferred' && p.transferred_at
              ? ` · ${new Date(p.transferred_at).toLocaleDateString('ko-KR')}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={p.status} />
          {isUrgent && (
            <span className="text-[10px] text-gray-600">처리 중</span>
          )}
        </div>
      </div>
    </div>
  )
}

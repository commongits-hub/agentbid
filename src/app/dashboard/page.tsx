'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Nav } from '@/components/layout/nav'
import { StatusBadge } from '@/components/ui/badge'
import { ReviewForm } from '@/components/reviews/ReviewForm'

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

// Demo data for empty states
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

function timeAgo(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000)
  if (h < 1) return '방금'; if (h < 24) return `${h}시간 전`
  return `${Math.floor(h/24)}일 전`
}

function StatCard({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent ? 'text-emerald-400' : 'text-gray-50'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-600">{sub}</p>}
    </div>
  )
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
  const [reviewedOrderIds, setReviewedOrderIds] = useState<Set<string>>(new Set())
  const [reviewingOrderId, setReviewingOrderId] = useState<string | null>(null)

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
        const { data: tasks } = await supabase.from('tasks').select('id,title,status,budget_min,budget_max,submission_count,created_at').eq('user_id', session.user.id).is('soft_deleted_at', null).order('created_at',{ascending:false}).limit(20)
        const { data: orders } = await supabase.from('orders').select('id,task_id,amount,status,paid_at,created_at').eq('user_id', session.user.id).order('created_at',{ascending:false}).limit(10)
        const taskList = (tasks as MyTask[]) ?? []
        const orderList = (orders as MyOrder[]) ?? []
        setMyTasks(taskList); setMyOrders(orderList)
        if (taskList.length === 0) { setMyTasks(DEMO_TASKS); setIsDemo(true) }

        // paid 주문에 대한 리뷰 존재 여부 일괄 확인
        const paidOrders = orderList.filter(o => o.status === 'paid')
        if (paidOrders.length > 0) {
          const reviewChecks = await Promise.all(
            paidOrders.map(o =>
              fetch(`/api/reviews?order_id=${o.id}`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
              }).then(r => r.json()).then(d => ({ id: o.id, hasReview: !!d.data }))
            )
          )
          const reviewed = new Set(reviewChecks.filter(r => r.hasReview).map(r => r.id))
          setReviewedOrderIds(reviewed)
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
          <div className="grid gap-4 sm:grid-cols-3">
            {[1,2,3].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-900" />)}
          </div>
        </div>
      </div>
    )
  }

  /* ── OWNER VIEW ──────────────────────────────────────────── */
  if (appRole !== 'provider') {
    const openCount = myTasks.filter(t => t.status === 'open').length
    const doneCount = myTasks.filter(t => t.status === 'completed').length
    const paidTotal = myOrders.filter(o => o.status === 'paid').reduce((s, o) => s + o.amount, 0)

    return (
      <div className="min-h-screen bg-[#030712]">
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-10">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-50">대시보드</h1>
              <p className="mt-0.5 text-sm text-gray-500">내 작업 현황을 확인하세요</p>
            </div>
            <Link href="/tasks/new" className="rounded-2xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-gray-950 hover:bg-emerald-400 transition-colors">
              + 작업 등록
            </Link>
          </div>

          {isDemo && (
            <div className="mt-4 rounded-2xl border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-400">
              샘플 데이터로 표시 중입니다. 작업을 등록하면 실제 데이터가 표시됩니다.
            </div>
          )}

          {/* Stats */}
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <StatCard label="진행 중 작업" value={`${openCount}건`} />
            <StatCard label="완료된 작업" value={`${doneCount}건`} accent />
            <StatCard label="총 결제 금액" value={`₩${paidTotal.toLocaleString()}`} sub="플랫폼 수수료 20% 포함" />
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
                <Link href="/tasks/new" className="mt-3 inline-block text-sm text-emerald-400 hover:underline">첫 작업 등록하기 →</Link>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {myTasks.map(t => (
                  <Link
                    key={t.id}
                    href={t.id.startsWith('d') ? '#' : `/tasks/${t.id}`}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-4 transition-colors hover:border-gray-700 hover:bg-gray-800/80"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-50">{t.title}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {timeAgo(t.created_at)} · 제출 <span className="text-blue-400 font-medium">{t.submission_count}</span>건
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {t.budget_min && (
                        <span className="text-xs text-gray-400">₩{t.budget_min.toLocaleString()}{t.budget_max ? `~${t.budget_max.toLocaleString()}` : '~'}</span>
                      )}
                      <StatusBadge status={t.status} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Orders */}
          {myOrders.length > 0 && (
            <section className="mt-10">
              <h2 className="text-lg font-semibold text-gray-50">최근 주문</h2>
              <div className="mt-4 space-y-3">
                {myOrders.map(o => (
                  <div key={o.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-50">₩{o.amount.toLocaleString()}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {o.paid_at ? `결제 완료 · ${timeAgo(o.paid_at)}` : timeAgo(o.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {o.status === 'paid' && !reviewedOrderIds.has(o.id) && reviewingOrderId !== o.id && (
                          <button
                            onClick={() => setReviewingOrderId(o.id)}
                            className="rounded-xl border border-amber-800/60 bg-amber-950/30 px-3 py-1 text-xs text-amber-400 hover:border-amber-700 transition-colors"
                          >
                            리뷰 작성
                          </button>
                        )}
                        {o.status === 'paid' && reviewedOrderIds.has(o.id) && (
                          <span className="text-xs text-gray-600">리뷰 완료 ✓</span>
                        )}
                        <StatusBadge status={o.status} />
                      </div>
                    </div>

                    {/* 인라인 리뷰 폼 */}
                    {reviewingOrderId === o.id && (
                      <div className="mt-4">
                        <ReviewForm
                          orderId={o.id}
                          onSuccess={() => {
                            setReviewedOrderIds(prev => new Set([...prev, o.id]))
                            setReviewingOrderId(null)
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    )
  }

  /* ── PROVIDER VIEW ───────────────────────────────────────── */
  const totalPending    = payouts.filter(p=>p.status==='pending').reduce((s,p)=>s+p.amount,0)
  const totalReleased   = payouts.filter(p=>p.status==='released').reduce((s,p)=>s+p.amount,0)
  const totalTransferred = payouts.filter(p=>p.status==='transferred').reduce((s,p)=>s+p.amount,0)

  const payoutStatusMeta: Record<string, { label: string; cls: string }> = {
    pending:     { label: `대기 중 (${new Date().toLocaleDateString('ko-KR')} 기준 7일 후)`, cls: 'text-amber-400' },
    hold:        { label: '보류 — Stripe 계좌 연결 필요',  cls: 'text-orange-400' },
    released:    { label: '정산 가능 — 지급 대기 중',       cls: 'text-blue-400' },
    transferred: { label: '지급 완료',                      cls: 'text-emerald-400' },
    cancelled:   { label: '환불로 인해 취소됨',              cls: 'text-gray-500' },
  }

  return (
    <div className="min-h-screen bg-[#030712]">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-10">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-50">Provider 대시보드</h1>
            <p className="mt-0.5 text-sm text-gray-500">정산 및 수익 현황</p>
          </div>
          {stripeConnected ? (
            <span className="flex items-center gap-2 rounded-2xl border border-emerald-800 bg-emerald-950/50 px-4 py-2 text-sm text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Stripe 연결됨
            </span>
          ) : (
            <Link href="/onboarding/stripe" className="rounded-2xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-gray-950 hover:bg-amber-400 transition-colors">
              Stripe 연결하기
            </Link>
          )}
        </div>

        {!stripeConnected && (
          <div className="mt-4 rounded-2xl border border-amber-800/50 bg-amber-950/30 px-5 py-4">
            <p className="text-sm font-medium text-amber-400">Stripe 계좌 미연결</p>
            <p className="mt-1 text-xs text-amber-600">정산 가능 상태가 되어도 지급이 보류됩니다. 지금 바로 Stripe 계좌를 연결하세요.</p>
          </div>
        )}

        {isDemo && (
          <div className="mt-4 rounded-2xl border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-400">
            샘플 데이터로 표시 중입니다. 작업을 완료하면 실제 정산 내역이 표시됩니다.
          </div>
        )}

        {/* Stats */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <StatCard label="대기 중" value={`₩${totalPending.toLocaleString()}`} sub="구매 후 7일 정산 대기" />
          <StatCard label="정산 가능" value={`₩${totalReleased.toLocaleString()}`} sub="지급 처리 대기 중" />
          <StatCard label="지급 완료" value={`₩${totalTransferred.toLocaleString()}`} sub="계좌 이체 완료" accent />
        </div>

        {/* Payout list */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-gray-50">정산 내역</h2>
          {payouts.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-gray-800 p-10 text-center">
              <p className="text-sm text-gray-500">아직 정산 내역이 없습니다.</p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {payouts.map(p => (
                <div key={p.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-50">
                        {p.orders?.tasks?.title ?? '(작업 없음)'}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        총 결제액 ₩{(p.orders?.amount ?? 0).toLocaleString()} →{' '}
                        <span className="font-medium text-gray-300">정산액 ₩{p.amount.toLocaleString()}</span>
                        <span className="ml-1 text-gray-600">(플랫폼 수수료 20%)</span>
                      </p>
                      <p className={`mt-1 text-xs ${payoutStatusMeta[p.status]?.cls ?? 'text-gray-500'}`}>
                        {p.status === 'pending' && `정산 가능일: ${new Date(p.release_at).toLocaleDateString('ko-KR')}`}
                        {p.status !== 'pending' && payoutStatusMeta[p.status]?.label}
                        {p.status === 'transferred' && p.transferred_at && ` · ${new Date(p.transferred_at).toLocaleDateString('ko-KR')}`}
                      </p>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

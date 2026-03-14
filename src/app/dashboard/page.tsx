'use client'

// src/app/dashboard/page.tsx
// Dashboard — app_role 기준으로 owner/provider 뷰 분기
//
// [owner (user role)]
//   - 내 Task 목록 (전체 status)
//   - 최근 주문 내역
//
// [provider]
//   - Stripe Connect 연결 상태
//   - Payout 목록 (pending / hold / released / transferred / cancelled)

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// ─── Types ────────────────────────────────────────────────

type MyTask = {
  id: string
  title: string
  status: string
  budget_min: number | null
  budget_max: number | null
  submission_count: number
  created_at: string
}

type MyOrder = {
  id: string
  task_id: string
  submission_id: string
  amount: number
  status: string
  paid_at: string | null
  created_at: string
}

type Payout = {
  id: string
  amount: number
  status: 'pending' | 'hold' | 'released' | 'transferred' | 'cancelled'
  release_at: string
  transferred_at: string | null
  stripe_transfer_id: string | null
  created_at: string
  orders: {
    id: string
    amount: number
    paid_at: string | null
    tasks: { id: string; title: string } | null
  } | null
}

// ─── Status badge helpers ──────────────────────────────────

const TASK_STATUS_STYLE: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-500',
  open:      'bg-green-100 text-green-700',
  reviewing: 'bg-yellow-100 text-yellow-700',
  selected:  'bg-blue-100 text-blue-700',
  completed: 'bg-violet-100 text-violet-700',
  cancelled: 'bg-red-100 text-red-500',
  expired:   'bg-red-50 text-red-400',
  disputed:  'bg-orange-100 text-orange-600',
}

const PAYOUT_STATUS_STYLE: Record<string, string> = {
  pending:     'bg-yellow-100 text-yellow-700',
  hold:        'bg-orange-100 text-orange-600',
  released:    'bg-blue-100 text-blue-700',
  transferred: 'bg-green-100 text-green-700',
  cancelled:   'bg-gray-100 text-gray-500',
}

const PAYOUT_STATUS_LABEL: Record<string, string> = {
  pending:     '대기중 (7일)',
  hold:        '보류',
  released:    '정산 가능',
  transferred: '지급 완료',
  cancelled:   '취소됨',
}

const ORDER_STATUS_STYLE: Record<string, string> = {
  pending:          'bg-yellow-100 text-yellow-700',
  paid:             'bg-green-100 text-green-700',
  failed:           'bg-red-100 text-red-500',
  cancelled:        'bg-gray-100 text-gray-500',
  refund_requested: 'bg-orange-100 text-orange-600',
  refunded:         'bg-red-50 text-red-400',
}

// ─── Component ─────────────────────────────────────────────

export default function DashboardPage() {
  const router  = useRouter()
  const [appRole, setAppRole]   = useState<string | null>(null)
  const [token, setToken]       = useState<string | null>(null)
  const [userId, setUserId]     = useState<string | null>(null)
  const [loading, setLoading]   = useState(true)

  // owner state
  const [myTasks, setMyTasks]     = useState<MyTask[]>([])
  const [myOrders, setMyOrders]   = useState<MyOrder[]>([])

  // provider state
  const [payouts, setPayouts]           = useState<Payout[]>([])
  const [stripeConnected, setStripeConnected] = useState<boolean>(false)

  useEffect(() => {
    const supabase = createClient()

    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/auth/login'); return }

      const meta  = session.user.app_metadata ?? session.user.user_metadata ?? {}
      const role  = (meta.app_role ?? session.user.user_metadata?.app_role ?? session.user.user_metadata?.role ?? 'user') as string

      setToken(session.access_token)
      setUserId(session.user.id)
      setAppRole(role)

      if (role === 'provider') {
        await loadProviderData(session.access_token)
      } else {
        await loadOwnerData(session.user.id, supabase)
      }

      setLoading(false)
    }

    init()
  }, [])

  // ── owner data ─────────────────────────────────────────────
  async function loadOwnerData(uid: string, supabase: ReturnType<typeof createClient>) {
    // 내 task 목록 (전체 상태)
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, status, budget_min, budget_max, submission_count, created_at')
      .eq('user_id', uid)
      .is('soft_deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20)

    setMyTasks((tasks as MyTask[]) ?? [])

    // 최근 주문 내역
    const { data: orders } = await supabase
      .from('orders')
      .select('id, task_id, submission_id, amount, status, paid_at, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(10)

    setMyOrders((orders as MyOrder[]) ?? [])
  }

  // ── provider data ──────────────────────────────────────────
  async function loadProviderData(accessToken: string) {
    const res = await fetch('/api/payouts', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await res.json()

    if (res.ok) {
      setPayouts(data.data ?? [])
      setStripeConnected(data.meta?.stripe_connected ?? false)
    }
  }

  if (loading) return <main className="p-8"><p>불러오는 중...</p></main>

  // ──────────────────────────────────────────────────────────
  // OWNER VIEW
  // ──────────────────────────────────────────────────────────
  if (appRole !== 'provider') {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">대시보드</h1>
          <Link
            href="/tasks/new"
            className="rounded bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700"
          >
            + Task 등록
          </Link>
        </div>

        {/* 내 Task 목록 */}
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold">내 Task</h2>

          {myTasks.length === 0 ? (
            <p className="text-sm text-gray-500">등록한 Task가 없습니다.</p>
          ) : (
            <ul className="space-y-3">
              {myTasks.map(t => (
                <li key={t.id} className="rounded border p-4 hover:bg-gray-50">
                  <Link href={`/tasks/${t.id}`} className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium">{t.title}</p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {new Date(t.created_at).toLocaleDateString('ko-KR')}
                        {' · '}제출 {t.submission_count}건
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {(t.budget_min || t.budget_max) && (
                        <span className="text-sm text-violet-600">
                          {t.budget_min?.toLocaleString()}원~
                        </span>
                      )}
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${TASK_STATUS_STYLE[t.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {t.status}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 주문 내역 */}
        <section>
          <h2 className="mb-3 text-lg font-semibold">최근 주문</h2>

          {myOrders.length === 0 ? (
            <p className="text-sm text-gray-500">주문 내역이 없습니다.</p>
          ) : (
            <ul className="space-y-3">
              {myOrders.map(o => (
                <li key={o.id} className="rounded border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-700">
                        {o.amount.toLocaleString()}원
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {o.paid_at
                          ? `결제 완료 · ${new Date(o.paid_at).toLocaleDateString('ko-KR')}`
                          : new Date(o.created_at).toLocaleDateString('ko-KR')}
                      </p>
                    </div>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_STYLE[o.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {o.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    )
  }

  // ──────────────────────────────────────────────────────────
  // PROVIDER VIEW
  // ──────────────────────────────────────────────────────────
  const totalPending    = payouts.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0)
  const totalReleased   = payouts.filter(p => p.status === 'released').reduce((s, p) => s + p.amount, 0)
  const totalTransferred = payouts.filter(p => p.status === 'transferred').reduce((s, p) => s + p.amount, 0)

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Provider 대시보드</h1>
        {!stripeConnected && (
          <Link
            href="/onboarding/stripe"
            className="rounded bg-orange-500 px-4 py-2 text-sm text-white hover:bg-orange-600"
          >
            Stripe 연결하기
          </Link>
        )}
        {stripeConnected && (
          <span className="rounded bg-green-100 px-3 py-1.5 text-sm text-green-700">
            ✓ Stripe 연결됨
          </span>
        )}
      </div>

      {/* Stripe 미연결 경고 */}
      {!stripeConnected && (
        <div className="mb-6 rounded border border-orange-200 bg-orange-50 p-4 text-sm text-orange-700">
          <p className="font-medium">Stripe 계좌가 연결되지 않았습니다.</p>
          <p className="mt-1">정산 가능 상태가 되어도 지급이 보류됩니다. Stripe 계좌를 연결해주세요.</p>
        </div>
      )}

      {/* 요약 카드 */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        <div className="rounded border p-4 text-center">
          <p className="text-xs text-gray-500">대기중</p>
          <p className="mt-1 text-lg font-bold text-yellow-600">{totalPending.toLocaleString()}원</p>
        </div>
        <div className="rounded border p-4 text-center">
          <p className="text-xs text-gray-500">정산 가능</p>
          <p className="mt-1 text-lg font-bold text-blue-600">{totalReleased.toLocaleString()}원</p>
        </div>
        <div className="rounded border p-4 text-center">
          <p className="text-xs text-gray-500">지급 완료</p>
          <p className="mt-1 text-lg font-bold text-green-600">{totalTransferred.toLocaleString()}원</p>
        </div>
      </div>

      {/* Payout 목록 */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">정산 내역</h2>

        {payouts.length === 0 ? (
          <p className="text-sm text-gray-500">정산 내역이 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {payouts.map(p => {
              const taskTitle = p.orders?.tasks?.title ?? '(작업 없음)'
              const paidAt    = p.orders?.paid_at
              const grossAmt  = p.orders?.amount ?? 0

              return (
                <li key={p.id} className="rounded border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium">{taskTitle}</p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        총 결제액 {grossAmt.toLocaleString()}원
                        {' · '}정산액 <span className="font-medium text-gray-600">{p.amount.toLocaleString()}원</span>
                      </p>
                      <div className="mt-1 text-xs text-gray-400">
                        {p.status === 'pending' && (
                          <span>정산 가능일: {new Date(p.release_at).toLocaleDateString('ko-KR')}</span>
                        )}
                        {p.status === 'hold' && (
                          <span className="text-orange-600">보류 — Stripe 계좌 연결 필요</span>
                        )}
                        {p.status === 'released' && (
                          <span className="text-blue-600">지급 대기 중</span>
                        )}
                        {p.status === 'transferred' && p.transferred_at && (
                          <span>지급일: {new Date(p.transferred_at).toLocaleDateString('ko-KR')}</span>
                        )}
                        {p.status === 'cancelled' && (
                          <span className="text-gray-400">환불로 인해 취소됨</span>
                        )}
                      </div>
                    </div>

                    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${PAYOUT_STATUS_STYLE[p.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {PAYOUT_STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}

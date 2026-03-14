'use client'

// src/app/orders/[sessionId]/success/page.tsx
// Stripe Checkout 완료 후 리다이렉트되는 성공 페이지
// URL: /orders/{CHECKOUT_SESSION_ID}/success
//
// - 주문 상태를 orders API로 확인 (session_id로 매칭)
// - webhook 처리 지연 대비: 최대 3회 폴링 (2초 간격)
// - 성공 확인 후 /dashboard 또는 /tasks로 이동 안내

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type OrderStatus = 'checking' | 'paid' | 'pending' | 'error'

export default function CheckoutSuccessPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const router = useRouter()
  const [status, setStatus]   = useState<OrderStatus>('checking')
  const [amount, setAmount]   = useState<number | null>(null)
  const [taskId, setTaskId]   = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)

  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout>

    async function check(attempt: number) {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/auth/login'); return }

      // orders를 session 토큰으로 조회
      const res = await fetch('/api/orders', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()

      if (!res.ok) {
        setStatus('error')
        return
      }

      // stripe_checkout_session_id로 매칭
      const orders: any[] = data.data ?? []
      const matched = orders.find(
        (o: any) => o.stripe_checkout_session_id === sessionId,
      )

      if (matched) {
        if (matched.status === 'paid') {
          setStatus('paid')
          setAmount(matched.amount)
          setTaskId(matched.task_id)
          return
        }
        // pending — webhook 처리 중
        if (matched.status === 'pending' && attempt < 3) {
          setAttempts(attempt + 1)
          timer = setTimeout(() => check(attempt + 1), 2000)
          return
        }
      } else if (attempt < 3) {
        // order가 아직 없음 (극히 드문 경우) → 재시도
        setAttempts(attempt + 1)
        timer = setTimeout(() => check(attempt + 1), 2000)
        return
      }

      // 3회 이후에도 paid 미확인 → pending 표시 (webhook 처리 중)
      setStatus('pending')
    }

    check(0)
    return () => clearTimeout(timer)
  }, [sessionId])

  return (
    <main className="mx-auto max-w-md px-8 py-20 text-center">
      {status === 'checking' && (
        <>
          <div className="mb-4 text-4xl">⏳</div>
          <h1 className="text-xl font-bold">결제 확인 중...</h1>
          <p className="mt-2 text-sm text-gray-500">
            {attempts > 0 ? `재확인 중 (${attempts}/3)` : '잠시만 기다려주세요.'}
          </p>
        </>
      )}

      {status === 'paid' && (
        <>
          <div className="mb-4 text-5xl">✅</div>
          <h1 className="text-2xl font-bold text-green-700">결제 완료!</h1>
          {amount && (
            <p className="mt-2 text-lg font-medium text-gray-700">
              {amount.toLocaleString()}원
            </p>
          )}
          <p className="mt-2 text-sm text-gray-500">
            제출물 원본 접근이 활성화되었습니다.
          </p>

          <div className="mt-8 flex flex-col items-center gap-3">
            {taskId && (
              <Link
                href={`/tasks/${taskId}`}
                className="w-full rounded bg-violet-600 py-2.5 text-sm font-medium text-white hover:bg-violet-700"
              >
                제출물 보기
              </Link>
            )}
            <Link
              href="/dashboard"
              className="w-full rounded border py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              대시보드로 이동
            </Link>
          </div>
        </>
      )}

      {status === 'pending' && (
        <>
          <div className="mb-4 text-4xl">🔄</div>
          <h1 className="text-xl font-bold">결제 처리 중</h1>
          <p className="mt-2 text-sm text-gray-500">
            결제가 접수되었습니다. 처리 완료까지 수 분이 걸릴 수 있습니다.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            대시보드에서 주문 상태를 확인해주세요.
          </p>
          <div className="mt-8">
            <Link
              href="/dashboard"
              className="rounded bg-violet-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-700"
            >
              대시보드로 이동
            </Link>
          </div>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="mb-4 text-4xl">⚠️</div>
          <h1 className="text-xl font-bold text-red-600">확인 실패</h1>
          <p className="mt-2 text-sm text-gray-500">
            결제 상태를 확인할 수 없습니다. 대시보드에서 주문 내역을 확인해주세요.
          </p>
          <div className="mt-8">
            <Link
              href="/dashboard"
              className="rounded bg-violet-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-700"
            >
              대시보드로 이동
            </Link>
          </div>
        </>
      )}
    </main>
  )
}

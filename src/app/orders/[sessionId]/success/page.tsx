'use client'

// src/app/orders/[sessionId]/success/page.tsx
// Stripe Checkout redirect target after successful payment
// Polls order status and shows review flow once confirmed

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Nav } from '@/components/layout/nav'
import { ReviewForm } from '@/components/reviews/ReviewForm'

type OrderStatus = 'checking' | 'paid' | 'pending' | 'error'

export default function CheckoutSuccessPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const router = useRouter()
  const [status, setStatus]     = useState<OrderStatus>('checking')
  const [amount, setAmount]     = useState<number | null>(null)
  const [taskId, setTaskId]     = useState<string | null>(null)
  const [orderId, setOrderId]   = useState<string | null>(null)
  const [hasReview, setHasReview] = useState(false)
  const [attempts, setAttempts] = useState(0)

  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout>

    async function check(attempt: number) {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/auth/login'); return }

      const res = await fetch('/api/orders', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()

      if (!res.ok) { setStatus('error'); return }

      const orders: {
        id: string
        stripe_checkout_session_id: string | null
        status: string
        amount: number
        task_id: string
      }[] = data.data ?? []

      const matched = orders.find(o => o.stripe_checkout_session_id === sessionId)

      if (!matched) {
        if (attempt < 3) {
          setAttempts(attempt)
          timer = setTimeout(() => check(attempt + 1), 2000)
        } else {
          setStatus('pending')
        }
        return
      }

      if (matched.status === 'paid') {
        setStatus('paid')
        setAmount(matched.amount)
        setTaskId(matched.task_id)
        setOrderId(matched.id)

        const rvRes = await fetch(`/api/reviews?order_id=${matched.id}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const rvData = await rvRes.json()
        if (rvData.data) setHasReview(true)
      } else {
        if (attempt < 3) {
          setAttempts(attempt)
          timer = setTimeout(() => check(attempt + 1), 2000)
        } else {
          setStatus('pending')
        }
      }
    }

    check(0)
    return () => clearTimeout(timer)
  }, [sessionId, router])

  return (
    <div className="min-h-screen bg-[#030712]">
      <Nav />

      <main className="mx-auto max-w-lg px-4 py-16 text-center">

        {status === 'checking' && (
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-10">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-gray-700 border-t-emerald-500" />
            <h1 className="mt-6 text-lg font-semibold text-gray-200">Confirming payment...</h1>
            <p className="mt-2 text-sm text-gray-500">
              {attempts > 0 ? `Retrying (${attempts}/3)` : 'Please wait a moment.'}
            </p>
          </div>
        )}

        {status === 'paid' && (
          <div className="space-y-5">
            {/* Payment confirmed card */}
            <div className="rounded-2xl border border-emerald-800/50 bg-emerald-950/20 p-8">
              <p className="text-5xl">✅</p>
              <h1 className="mt-4 text-2xl font-bold text-gray-50">Payment Complete</h1>
              {amount && (
                <p className="mt-1 text-base font-semibold text-emerald-400">
                  ₩{amount.toLocaleString()}
                </p>
              )}
              <p className="mt-3 text-sm text-gray-400">
                Full access to the submission has been unlocked.
              </p>

              <div className="mt-6 flex flex-col gap-3">
                {taskId && (
                  <Link
                    href={`/tasks/${taskId}`}
                    className="w-full rounded-2xl bg-emerald-500 py-2.5 text-sm font-semibold text-gray-950 hover:bg-emerald-400 transition-colors"
                  >
                    View Deliverable
                  </Link>
                )}
                <Link
                  href="/dashboard"
                  className="w-full rounded-2xl border border-gray-700 py-2.5 text-sm text-gray-300 hover:border-gray-500 transition-colors"
                >
                  Go to Dashboard
                </Link>
              </div>
            </div>

            {/* Review section */}
            {orderId && !hasReview && (
              <ReviewForm
                orderId={orderId}
                onSuccess={() => setHasReview(true)}
              />
            )}

            {hasReview && (
              <div className="rounded-2xl border border-gray-800 bg-gray-900/50 px-6 py-4">
                <p className="text-sm text-gray-500">✓ Review submitted.</p>
              </div>
            )}
          </div>
        )}

        {status === 'pending' && (
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-10">
            <p className="text-4xl">🔄</p>
            <h1 className="mt-4 text-xl font-semibold text-gray-200">Payment Processing</h1>
            <p className="mt-2 text-sm text-gray-500">
              Your payment has been received. It may take a few minutes to fully process.
            </p>
            <div className="mt-8">
              <Link
                href="/dashboard"
                className="rounded-2xl bg-emerald-500 px-8 py-2.5 text-sm font-semibold text-gray-950 hover:bg-emerald-400 transition-colors"
              >
                Check in Dashboard
              </Link>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-10">
            <p className="text-4xl">⚠️</p>
            <h1 className="mt-4 text-xl font-semibold text-gray-200">Confirmation Failed</h1>
            <p className="mt-2 text-sm text-gray-500">
              Unable to verify payment status. Please check your order history in the dashboard.
            </p>
            <div className="mt-8">
              <Link
                href="/dashboard"
                className="rounded-2xl bg-emerald-500 px-8 py-2.5 text-sm font-semibold text-gray-950 hover:bg-emerald-400 transition-colors"
              >
                Go to Dashboard
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

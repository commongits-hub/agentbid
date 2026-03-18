'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Nav } from '@/components/layout/nav'

type Status = 'loading' | 'connected' | 'pending' | 'error'

const PAYOUT_STEPS = [
  { icon: '🎯', title: 'Task Completed', desc: 'A buyer selects your submission and completes payment.' },
  { icon: '⏳', title: '7-Day Hold', desc: 'The payout is held during the platform protection period.' },
  { icon: '💸', title: 'Auto Transfer', desc: 'After 7 days, funds are automatically sent to your account.' },
]

export default function StripeOnboardingContent() {
  const router  = useRouter()
  const params  = useSearchParams()
  const [status, setStatus]   = useState<Status>('loading')
  const [errorMsg, setError]  = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function fetchStatus() {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/auth/login'); return }

    const res  = await fetch('/api/stripe/connect/status', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await res.json()
    setStatus(data.connected ? 'connected' : 'pending')
  }

  async function startOnboarding() {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/auth/login'); return }

    const res  = await fetch('/api/stripe/connect/onboard', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await res.json()

    if (data.url) {
      window.location.href = data.url
    } else if (res.status === 409) {
      setStatus('connected')
    } else {
      setError(data.error ?? 'An error occurred while connecting.')
      setStatus('error')
    }
    setLoading(false)
  }

  useEffect(() => {
    const success = params.get('success')
    const refresh = params.get('refresh')
    if (success) fetchStatus()
    else if (refresh) startOnboarding()
    else fetchStatus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── LOADING ─────────────────────────────────────────────── */
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#030712]">
        <Nav />
        <div className="mx-auto max-w-lg px-4 py-20 text-center">
          <div className="mx-auto h-12 w-12 animate-pulse rounded-2xl bg-gray-800" />
          <p className="mt-4 text-sm text-gray-500">Checking account connection status...</p>
        </div>
      </div>
    )
  }

  /* ── CONNECTED ───────────────────────────────────────────── */
  if (status === 'connected') {
    return (
      <div className="min-h-screen bg-[#030712]">
        <Nav />
        <div className="mx-auto max-w-lg px-4 py-20">
          <div className="rounded-2xl border border-emerald-800/50 bg-emerald-950/20 p-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-800 bg-emerald-950 text-3xl">
              ✓
            </div>
            <h1 className="mt-5 text-2xl font-bold text-gray-50">Stripe Account Connected</h1>
            <p className="mt-2 text-sm text-gray-400">
              Your payout account is connected. Earnings will be automatically transferred 7 days after task completion.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3 text-center">
              {[
                { label: 'Payout cycle', value: '7 days' },
                { label: 'Platform fee', value: '20%' },
                { label: 'Transfer', value: 'Auto' },
              ].map(item => (
                <div key={item.label} className="rounded-xl border border-emerald-900/50 bg-emerald-950/30 p-3">
                  <p className="text-xs text-gray-500">{item.label}</p>
                  <p className="mt-0.5 text-sm font-bold text-emerald-400">{item.value}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => router.push('/dashboard')}
              className="mt-8 w-full rounded-2xl bg-emerald-500 py-3 text-sm font-semibold text-gray-950 transition hover:bg-emerald-400"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ── ERROR ───────────────────────────────────────────────── */
  if (status === 'error') {
    return (
      <div className="min-h-screen bg-[#030712]">
        <Nav />
        <div className="mx-auto max-w-lg px-4 py-20">
          <div className="rounded-2xl border border-red-800/50 bg-red-950/20 p-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-red-800 bg-red-950 text-3xl">
              ⚠️
            </div>
            <h1 className="mt-5 text-xl font-bold text-gray-50">Connection Failed</h1>
            <p className="mt-2 text-sm text-red-400">{errorMsg}</p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                onClick={startOnboarding}
                disabled={loading}
                className="w-full rounded-2xl bg-emerald-500 py-3 text-sm font-semibold text-gray-950 transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {loading ? 'Processing...' : 'Try Again'}
              </button>
              <button
                onClick={() => router.push('/dashboard')}
                className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  /* ── PENDING (main onboarding page) ──────────────────────── */
  return (
    <div className="min-h-screen bg-[#030712]">
      <Nav />
      <main className="mx-auto max-w-2xl px-4 py-12">

        {/* Header */}
        <div className="text-center">
          <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-700 bg-gray-900 text-3xl">
            💳
          </div>
          <h1 className="mt-5 text-2xl font-bold text-gray-50 sm:text-3xl">Connect Payout Account</h1>
          <p className="mt-2 text-sm text-gray-400">
            Connect your account via Stripe Connect to start receiving earnings.
          </p>
        </div>

        {/* Payout flow */}
        <div className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">How Payouts Work</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {PAYOUT_STEPS.map((step, idx) => (
              <div key={step.title} className="relative rounded-2xl border border-gray-800 bg-gray-900 p-5">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{step.icon}</span>
                  <span className="font-mono text-xs text-gray-600">0{idx+1}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-gray-200">{step.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Warning */}
        <div className="mt-8 rounded-2xl border border-amber-800/40 bg-amber-950/20 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-lg">⚠️</span>
            <div>
              <p className="text-sm font-medium text-amber-400">Payouts on hold without a connected account</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                Without a Stripe account, payouts will remain in <strong className="text-amber-600">hold</strong> even after task completion.
                Connecting releases all held funds immediately.
              </p>
            </div>
          </div>
        </div>

        {/* Benefits */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {[
            { icon: '🔒', title: 'Secure Payment Processing', desc: 'Handled by Stripe\'s PCI DSS-compliant infrastructure.' },
            { icon: '⚡', title: 'Automatic Payouts', desc: 'Auto-transferred 7 days after purchase. No manual request needed.' },
            { icon: '🌍', title: 'Global Support', desc: 'Bank accounts in 50+ countries supported.' },
            { icon: '📊', title: 'Payout Tracking', desc: 'Monitor your payout status in real time from the dashboard.' },
          ].map(b => (
            <div key={b.title} className="flex items-start gap-3 rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <span className="text-lg">{b.icon}</span>
              <div>
                <p className="text-xs font-semibold text-gray-200">{b.title}</p>
                <p className="mt-0.5 text-xs text-gray-500">{b.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Fee info */}
        <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Fee Structure</h3>
          <div className="mt-3 grid grid-cols-3 gap-4 text-center">
            {[
              { label: 'Platform fee', value: '20%' },
              { label: 'Agent earnings', value: '80%' },
              { label: 'Payout cycle', value: '7 days' },
            ].map(item => (
              <div key={item.label}>
                <p className="text-xs text-gray-500">{item.label}</p>
                <p className="mt-0.5 text-lg font-bold text-gray-50">{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="mt-8 flex flex-col gap-3">
          <button
            onClick={startOnboarding}
            disabled={loading}
            className="w-full rounded-2xl bg-emerald-500 py-3.5 text-base font-semibold text-gray-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Connect Stripe Account →'}
          </button>
          <Link
            href="/dashboard"
            className="w-full rounded-2xl border border-gray-800 py-3 text-center text-sm text-gray-500 transition hover:border-gray-700 hover:text-gray-300"
          >
            Do this later
          </Link>
        </div>

        <p className="mt-4 text-center text-xs text-gray-600">
          You will be redirected to Stripe&apos;s secure page. AgentBid does not store your financial information.
        </p>
      </main>
    </div>
  )
}

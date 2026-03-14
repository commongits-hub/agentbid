'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Nav } from '@/components/layout/nav'

type Status = 'loading' | 'connected' | 'pending' | 'error'

const PAYOUT_STEPS = [
  { icon: '🎯', title: '작업 완료', desc: '구매자가 결과물을 선택하고 결제를 완료합니다.' },
  { icon: '⏳', title: '7일 대기', desc: '플랫폼 보호 기간 동안 정산액이 보류됩니다.' },
  { icon: '💸', title: '자동 정산', desc: '7일 후 연결된 계좌로 자동 이체됩니다.' },
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
      setError(data.error ?? '연결 중 오류가 발생했습니다.')
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
          <p className="mt-4 text-sm text-gray-500">계좌 연결 상태를 확인하는 중입니다...</p>
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
            <h1 className="mt-5 text-2xl font-bold text-gray-50">Stripe 계좌 연결 완료</h1>
            <p className="mt-2 text-sm text-gray-400">
              정산 계좌가 연결되었습니다. 작업을 완료하면 7일 후 자동으로 수익이 입금됩니다.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3 text-center">
              {[
                { label: '정산 주기', value: '7일' },
                { label: '플랫폼 수수료', value: '20%' },
                { label: '정산 방식', value: '자동' },
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
              대시보드로 이동
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
            <h1 className="mt-5 text-xl font-bold text-gray-50">연결 중 오류가 발생했습니다</h1>
            <p className="mt-2 text-sm text-red-400">{errorMsg}</p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                onClick={startOnboarding}
                disabled={loading}
                className="w-full rounded-2xl bg-emerald-500 py-3 text-sm font-semibold text-gray-950 transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {loading ? '처리 중...' : '다시 시도'}
              </button>
              <button
                onClick={() => router.push('/dashboard')}
                className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                대시보드로 돌아가기
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
          <h1 className="mt-5 text-2xl font-bold text-gray-50 sm:text-3xl">정산 계좌 연결</h1>
          <p className="mt-2 text-sm text-gray-400">
            Stripe Connect를 통해 정산 계좌를 연결하면 작업 수익을 받을 수 있습니다.
          </p>
        </div>

        {/* Payout flow */}
        <div className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">정산 흐름</h2>
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

        {/* Why connect */}
        <div className="mt-8 rounded-2xl border border-amber-800/40 bg-amber-950/20 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-lg">⚠️</span>
            <div>
              <p className="text-sm font-medium text-amber-400">계좌 미연결 시 정산 보류</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                Stripe 계좌가 연결되지 않으면 작업이 완료되어도 정산금이 <strong className="text-amber-600">보류(hold)</strong> 상태로 묶입니다.
                계좌 연결 즉시 보류된 금액이 자동으로 정산 가능 상태로 전환됩니다.
              </p>
            </div>
          </div>
        </div>

        {/* Benefits */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {[
            { icon: '🔒', title: '안전한 결제 처리', desc: 'Stripe의 PCI DSS 준수 인프라로 처리됩니다.' },
            { icon: '⚡', title: '자동 정산', desc: '7일 후 연결 계좌로 자동 이체, 별도 신청 불필요.' },
            { icon: '🌍', title: '글로벌 지원', desc: '50개국 이상 은행 계좌 지원.' },
            { icon: '📊', title: '정산 내역 추적', desc: '대시보드에서 정산 상태를 실시간으로 확인합니다.' },
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
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">수수료 안내</h3>
          <div className="mt-3 grid grid-cols-3 gap-4 text-center">
            {[
              { label: '플랫폼 수수료', value: '20%' },
              { label: '에이전트 수익', value: '80%' },
              { label: '정산 주기', value: '7일' },
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
            {loading ? '처리 중...' : 'Stripe 계좌 연결하기 →'}
          </button>
          <Link
            href="/dashboard"
            className="w-full rounded-2xl border border-gray-800 py-3 text-center text-sm text-gray-500 transition hover:border-gray-700 hover:text-gray-300"
          >
            나중에 하기
          </Link>
        </div>

        <p className="mt-4 text-center text-xs text-gray-600">
          Stripe의 보안 페이지로 이동합니다. AgentBid는 금융 정보를 직접 저장하지 않습니다.
        </p>
      </main>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Status = 'loading' | 'connected' | 'pending' | 'error'

export default function StripeOnboardingContent() {
  const router       = useRouter()
  const params       = useSearchParams()
  const [status, setStatus]   = useState<Status>('loading')
  const [onboardUrl, setUrl]  = useState<string | null>(null)
  const [errorMsg, setError]  = useState<string | null>(null)

  async function fetchStatus() {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/auth/login'); return }

    const res = await fetch('/api/stripe/connect/status', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await res.json()

    if (data.connected) {
      setStatus('connected')
    } else {
      setStatus('pending')
    }
  }

  async function startOnboarding() {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/auth/login'); return }

    const res = await fetch('/api/stripe/connect/onboard', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await res.json()

    if (data.url) {
      window.location.href = data.url
    } else if (res.status === 409) {
      setStatus('connected')
    } else {
      setError(data.error ?? 'Unknown error')
      setStatus('error')
    }
  }

  useEffect(() => {
    const success = params.get('success')
    const refresh = params.get('refresh')

    if (success) {
      fetchStatus()
    } else if (refresh) {
      startOnboarding()
    } else {
      fetchStatus()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (status === 'loading') {
    return <main className="flex min-h-screen items-center justify-center"><p>확인 중...</p></main>
  }

  if (status === 'connected') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">✅ Stripe 계좌 연결 완료</h1>
        <p className="text-gray-600">수익 정산 계좌가 정상적으로 연결되었습니다.</p>
        <button
          onClick={() => router.push('/dashboard')}
          className="rounded bg-black px-6 py-2 text-white"
        >
          대시보드로 이동
        </button>
      </main>
    )
  }

  if (status === 'error') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-xl font-bold text-red-500">오류 발생</h1>
        <p className="text-gray-600">{errorMsg}</p>
        <button
          onClick={startOnboarding}
          className="rounded bg-black px-6 py-2 text-white"
        >
          다시 시도
        </button>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-2xl font-bold">정산 계좌 연결</h1>
      <p className="max-w-md text-center text-gray-600">
        수익을 받으려면 Stripe Connect를 통해 정산 계좌를 연결해야 합니다.
        <br />
        연결 후 수익이 발생하면 7일 후 자동으로 정산됩니다.
      </p>
      <button
        onClick={startOnboarding}
        className="rounded bg-violet-600 px-8 py-3 font-semibold text-white hover:bg-violet-700"
      >
        Stripe 계좌 연결하기
      </button>
      <button
        onClick={() => router.push('/dashboard')}
        className="text-sm text-gray-400 underline"
      >
        나중에 하기
      </button>
    </main>
  )
}

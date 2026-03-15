'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const router = useRouter()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [role, setRole]         = useState<'user' | 'provider'>('user')

  // window.location.search에서 직접 읽어야 hydration 전 초기화 이슈 없음
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('role') === 'provider') setRole('provider')
  }, [])
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await createClient().auth.signUp({
      email, password,
      options: { data: { role, nickname } },
    })
    if (error) { setError(error.message); setLoading(false) }
    else router.push(role === 'provider' ? '/onboarding/stripe' : '/dashboard')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#030712] px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          <Link href="/" className="text-xl font-bold text-gray-50">
            Agent<span className="text-emerald-400">Bid</span>
          </Link>
          <p className="mt-2 text-sm text-gray-500">새 계정을 만드세요</p>
        </div>

        {/* Role selector */}
        <div className="mb-5 grid grid-cols-2 gap-3">
          {(['user', 'provider'] as const).map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`rounded-2xl border p-4 text-left transition-all ${
                role === r
                  ? 'border-emerald-500 bg-emerald-950/30'
                  : 'border-gray-800 bg-gray-900 hover:border-gray-700'
              }`}
            >
              <div className="text-lg">{r === 'user' ? '📋' : '🤖'}</div>
              <div className={`mt-1.5 text-xs font-semibold ${role === r ? 'text-emerald-400' : 'text-gray-300'}`}>
                {r === 'user' ? '작업 의뢰인' : 'AI 에이전트'}
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                {r === 'user' ? '작업을 등록하고 구매' : '작업을 수행하고 수익'}
              </div>
            </button>
          ))}
        </div>

        <form onSubmit={handleSignup} className="rounded-2xl border border-gray-800 bg-gray-900 p-8 space-y-5">
          {error && (
            <div className="rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400">이메일</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-gray-50 placeholder-gray-600 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400">닉네임</label>
            <input
              type="text"
              placeholder="표시될 이름"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              required
              className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-gray-50 placeholder-gray-600 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400">비밀번호</label>
            <input
              type="password"
              placeholder="8자 이상"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-gray-50 placeholder-gray-600 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-emerald-500 py-2.5 text-sm font-semibold text-gray-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading ? '처리 중...' : '회원가입'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-gray-500">
          이미 계정이 있으신가요?{' '}
          <Link href="/auth/login" className="text-emerald-400 hover:underline">
            로그인
          </Link>
        </p>
      </div>
    </div>
  )
}

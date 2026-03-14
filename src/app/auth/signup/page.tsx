'use client'

// src/app/auth/signup/page.tsx
// 회원가입 — user(의뢰인) / provider(에이전트 제공자) 선택

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [nickname, setNickname]   = useState('')
  const [role, setRole]           = useState<'user' | 'provider'>('user')
  const [error, setError]         = useState<string | null>(null)
  const [loading, setLoading]     = useState(false)

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { role, nickname },
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      // provider는 Stripe Connect onboarding으로 이동
      router.push(role === 'provider' ? '/onboarding/stripe' : '/dashboard')
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSignup} className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-bold">회원가입</h1>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <input
          type="email"
          placeholder="이메일"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="w-full rounded border px-3 py-2"
        />
        <input
          type="password"
          placeholder="비밀번호 (8자 이상)"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          minLength={8}
          className="w-full rounded border px-3 py-2"
        />
        <input
          type="text"
          placeholder="닉네임"
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          required
          className="w-full rounded border px-3 py-2"
        />
        <div className="flex gap-3">
          {(['user', 'provider'] as const).map(r => (
            <label key={r} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                value={r}
                checked={role === r}
                onChange={() => setRole(r)}
              />
              {r === 'user' ? '의뢰인 (Task 등록)' : 'Provider (에이전트 제공)'}
            </label>
          ))}
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {loading ? '처리 중...' : '회원가입'}
        </button>
        <p className="text-center text-sm">
          이미 계정이 있으신가요?{' '}
          <a href="/auth/login" className="underline">로그인</a>
        </p>
      </form>
    </main>
  )
}

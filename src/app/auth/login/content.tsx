'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router  = useRouter()
  const params  = useSearchParams()
  const returnTo = params.get('returnTo') ?? '/dashboard'

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await createClient().auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false) }
    else router.push(returnTo)
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[#030712] px-4 overflow-hidden">

      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-emerald-500/5 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-emerald-500/3 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          <Link href="/" className="text-2xl font-bold text-gray-50">
            Agent<span className="text-emerald-400">Bid</span>
          </Link>
          <p className="mt-2 text-sm text-gray-500">AI Agent Marketplace</p>
        </div>

        <form onSubmit={handleLogin} className="rounded-2xl border border-gray-800 bg-gray-900 p-8 space-y-5">
          <div className="text-center">
            <h1 className="text-base font-semibold text-gray-100">Sign In</h1>
          </div>

          {error && (
            <div className="rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400">Email</label>
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
            <label className="text-xs font-medium text-gray-400">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-gray-50 placeholder-gray-600 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-emerald-500 py-2.5 text-sm font-semibold text-gray-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-gray-500">
          Don&apos;t have an account?{' '}
          <Link href="/auth/signup" className="text-emerald-400 hover:underline">
            Sign up
          </Link>
        </p>

        {/* Trust signals */}
        <div className="mt-8 flex justify-center gap-6 text-xs text-gray-700">
          <span>🔒 Secure Login</span>
          <span>·</span>
          <span>Privacy Protected</span>
          <span>·</span>
          <span>Free to Join</span>
        </div>
      </div>
    </div>
  )
}

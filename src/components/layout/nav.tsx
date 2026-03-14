// src/components/layout/nav.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function Nav() {
  const pathname = usePathname()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    const sb = createClient()
    sb.auth.getSession().then(({ data: { session } }) => {
      setEmail(session?.user.email ?? null)
    })
    const { data: { subscription } } = sb.auth.onAuthStateChange((_, s) => {
      setEmail(s?.user.email ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const isActive = (href: string) =>
    pathname === href ? 'text-emerald-400' : 'text-gray-400 hover:text-gray-100'

  return (
    <header className="sticky top-0 z-50 border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight text-gray-50">
            Agent<span className="text-emerald-400">Bid</span>
          </span>
        </Link>

        {/* Nav links */}
        <nav className="hidden items-center gap-6 text-sm sm:flex">
          <Link href="/tasks"     className={`transition-colors ${isActive('/tasks')}`}>마켓</Link>
          <Link href="/dashboard" className={`transition-colors ${isActive('/dashboard')}`}>대시보드</Link>
        </nav>

        {/* Auth */}
        <div className="flex items-center gap-3 text-sm">
          {email ? (
            <>
              <span className="hidden text-gray-500 sm:block">{email}</span>
              <button
                onClick={async () => { await createClient().auth.signOut(); window.location.href = '/' }}
                className="text-gray-400 hover:text-gray-100 transition-colors"
              >
                로그아웃
              </button>
            </>
          ) : (
            <>
              <Link href="/auth/login"  className="text-gray-400 hover:text-gray-100 transition-colors">로그인</Link>
              <Link href="/auth/signup" className="rounded-2xl bg-emerald-500 px-4 py-1.5 font-semibold text-gray-950 hover:bg-emerald-400 transition-colors">
                시작하기
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

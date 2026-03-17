// src/components/layout/nav.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function Nav() {
  const pathname  = usePathname()
  const [email, setEmail]       = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  // client 인스턴스 1개 — effect, signOut 공유
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setEmail(session?.user.email ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => {
      setEmail(s?.user.email ?? null)
    })
    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 경로 바뀌면 메뉴 닫기
  useEffect(() => { setMenuOpen(false) }, [pathname])

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/')
      ? 'text-emerald-400'
      : 'text-gray-400 hover:text-gray-100'

  return (
    <header className="sticky top-0 z-50 border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight text-gray-50">
            Agent<span className="text-emerald-400">Bid</span>
          </span>
        </Link>

        {/* Desktop nav links */}
        <nav className="hidden items-center gap-6 text-sm sm:flex">
          <Link href="/tasks"     className={`transition-colors ${isActive('/tasks')}`}>마켓</Link>
          <Link href="/dashboard" className={`transition-colors ${isActive('/dashboard')}`}>대시보드</Link>
        </nav>

        {/* Desktop auth */}
        <div className="hidden items-center gap-3 text-sm sm:flex">
          {email ? (
            <>
              <span className="max-w-[160px] truncate text-gray-500">{email}</span>
              <button
                onClick={handleSignOut}
                className="text-gray-400 transition-colors hover:text-gray-100"
              >
                로그아웃
              </button>
            </>
          ) : (
            <>
              <Link href="/auth/login"  className="text-gray-400 transition-colors hover:text-gray-100">로그인</Link>
              <Link href="/auth/signup" className="rounded-2xl bg-emerald-500 px-4 py-1.5 font-semibold text-gray-950 transition-colors hover:bg-emerald-400">
                시작하기
              </Link>
            </>
          )}
        </div>

        {/* Mobile: 햄버거 */}
        <button
          onClick={() => setMenuOpen(v => !v)}
          className="flex items-center justify-center rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-100 sm:hidden"
          aria-label={menuOpen ? '메뉴 닫기' : '메뉴 열기'}
          aria-expanded={menuOpen}
        >
          {menuOpen ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="border-t border-gray-800 bg-gray-950 px-4 pb-4 pt-2 sm:hidden">
          <nav className="flex flex-col gap-1">
            <Link href="/tasks" className={`rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              pathname === '/tasks' ? 'bg-gray-800 text-emerald-400' : 'text-gray-300 hover:bg-gray-800/50'
            }`}>
              🛒 마켓
            </Link>
            <Link href="/dashboard" className={`rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              pathname === '/dashboard' ? 'bg-gray-800 text-emerald-400' : 'text-gray-300 hover:bg-gray-800/50'
            }`}>
              📊 대시보드
            </Link>
          </nav>

          <div className="mt-3 border-t border-gray-800 pt-3">
            {email ? (
              <div className="flex flex-col gap-2">
                <span className="truncate px-3 text-xs text-gray-500">{email}</span>
                <button
                  onClick={handleSignOut}
                  className="rounded-xl px-3 py-2.5 text-left text-sm text-gray-400 transition-colors hover:bg-gray-800/50"
                >
                  로그아웃
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Link href="/auth/login" className="rounded-xl px-3 py-2.5 text-sm text-gray-300 transition-colors hover:bg-gray-800/50">
                  로그인
                </Link>
                <Link href="/auth/signup" className="rounded-xl bg-emerald-500 px-3 py-2.5 text-center text-sm font-semibold text-gray-950 transition-colors hover:bg-emerald-400">
                  시작하기
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getClientRole } from '@/lib/client-role'

const NAV_ITEMS = [
  { href: '/admin/reports', label: 'Reports', urgent: true },
  { href: '/admin/tasks',   label: 'Tasks' },
  { href: '/admin/users',   label: 'Users' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/auth/login?returnTo=/admin')
        return
      }
      // role 판정: getClientRole() helper 사용 (JWT payload decode 포함)
      // admin은 fallback 금지 → 비admin은 즉시 redirect
      const role = getClientRole(session)
      if (role !== 'admin') {
        router.replace('/dashboard')
        return
      }
      setReady(true)
    })
  }, [router])

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#030712]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-700 border-t-emerald-400" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-[#030712]">
      {/* Sidebar */}
      <aside className="flex w-[200px] shrink-0 flex-col border-r border-gray-800 bg-gray-950">
        {/* Logo */}
        <div className="border-b border-gray-800 px-5 py-5">
          <Link href="/admin" className="text-sm font-bold tracking-tight text-emerald-400">
            AgentBid
          </Link>
          <p className="mt-0.5 text-[10px] text-gray-600 uppercase tracking-widest">Admin</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {NAV_ITEMS.map(({ href, label, urgent }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-emerald-950/60 text-emerald-400 font-medium'
                    : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-50'
                }`}
              >
                <span>{label}</span>
                {urgent && !active && (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                )}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-800 px-5 py-4">
          <Link
            href="/dashboard"
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← Dashboard
          </Link>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}

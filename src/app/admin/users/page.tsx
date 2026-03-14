'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'

type AdminUser = {
  id: string
  email: string
  nickname: string | null
  role: string
  is_active: boolean
  created_at: string
}

function RoleBadge({ role }: { role: string }) {
  if (role === 'admin') return <Badge variant="success">admin</Badge>
  if (role === 'provider') return <Badge variant="info">provider</Badge>
  return <Badge variant="default">user</Badge>
}

function ActiveDot({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${active ? 'bg-emerald-400' : 'bg-gray-600'}`}
      title={active ? '활성' : '비활성'}
    />
  )
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-800" />
      ))}
    </div>
  )
}

export default function AdminUsersPage() {
  const [users, setUsers]   = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return

      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json()

      if (!res.ok) {
        setError(json.error ?? '오류가 발생했습니다')
      } else {
        setUsers(json.data ?? [])
      }
      setLoading(false)
    })
  }, [])

  return (
    <div className="px-8 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-50">유저 관리</h1>
        <p className="mt-0.5 text-sm text-gray-500">최근 가입 유저 50명</p>
      </div>

      {loading && <Skeleton />}

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">이메일</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">닉네임</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">역할</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">활성</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">가입일</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-600">
                    유저가 없습니다
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-900/40 transition-colors">
                    <td className="px-4 py-3 text-gray-200">{u.email}</td>
                    <td className="px-4 py-3 text-gray-400">{u.nickname ?? '—'}</td>
                    <td className="px-4 py-3">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ActiveDot active={u.is_active} />
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(u.created_at).toLocaleDateString('ko-KR')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

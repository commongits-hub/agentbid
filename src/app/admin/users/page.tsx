'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'

type AdminUser = {
  id: string
  email: string
  nickname: string | null
  role: string
  is_active: boolean
  created_at: string
}

type Confirm = { userId: string; email: string; nextActive: boolean } | null

function RoleBadge({ role }: { role: string }) {
  if (role === 'admin') return <Badge variant="success">admin</Badge>
  if (role === 'provider') return <Badge variant="info">provider</Badge>
  return <Badge variant="default">user</Badge>
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
  const [users, setUsers]       = useState<AdminUser[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [token, setToken]       = useState<string>('')
  const [confirm, setConfirm]   = useState<Confirm>(null)
  const [saving, setSaving]     = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { setLoading(false); return }
      setToken(session.access_token)
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json()
      if (!res.ok) setError(json.error ?? '오류가 발생했습니다')
      else setUsers(json.data ?? [])
      setLoading(false)
    })
  }, [])

  async function handleToggle() {
    if (!confirm) return
    setSaving(confirm.userId)
    setConfirm(null)

    const res = await fetch(`/api/admin/users/${confirm.userId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: confirm.nextActive }),
    })
    const json = await res.json()
    setSaving(null)

    if (!res.ok) {
      setActionMsg(`❌ ${json.error}`)
    } else {
      setUsers(prev => prev.map(u => u.id === confirm.userId ? { ...u, is_active: confirm.nextActive } : u))
      setActionMsg(`✓ ${confirm.email} — ${confirm.nextActive ? '활성화' : '비활성화'} 완료`)
    }
    setTimeout(() => setActionMsg(null), 3000)
  }

  return (
    <div className="px-8 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-50">유저 관리</h1>
          <p className="mt-0.5 text-sm text-gray-500">최근 가입 유저 50명</p>
        </div>
        {actionMsg && (
          <span className={`rounded-xl px-3 py-1.5 text-xs font-medium ${
            actionMsg.startsWith('❌')
              ? 'border border-red-800 bg-red-950/30 text-red-400'
              : 'border border-emerald-800 bg-emerald-950/30 text-emerald-400'
          }`}>{actionMsg}</span>
        )}
      </div>

      {loading && <Skeleton />}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">이메일</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">닉네임</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">역할</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">상태</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">가입일</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {users.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-600">유저가 없습니다</td></tr>
              ) : (
                users.map(u => (
                  <tr key={u.id} className="hover:bg-gray-900/40 transition-colors">
                    <td className="px-4 py-3 text-gray-200">{u.email}</td>
                    <td className="px-4 py-3 text-gray-400">{u.nickname ?? '—'}</td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.is_active
                          ? 'bg-emerald-950/50 text-emerald-400'
                          : 'bg-gray-800 text-gray-500'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${u.is_active ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                        {u.is_active ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{new Date(u.created_at).toLocaleDateString('ko-KR')}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        disabled={saving === u.id || u.role === 'admin'}
                        onClick={() => setConfirm({ userId: u.id, email: u.email, nextActive: !u.is_active })}
                        className={`rounded-lg px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                          u.is_active
                            ? 'border border-red-800/60 text-red-400 hover:bg-red-950/30'
                            : 'border border-emerald-800/60 text-emerald-400 hover:bg-emerald-950/30'
                        }`}
                      >
                        {saving === u.id ? '처리 중...' : u.role === 'admin' ? '—' : u.is_active ? '비활성화' : '활성화'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.nextActive ? '유저 활성화' : '유저 비활성화'}
        description={`${confirm?.email}을 ${confirm?.nextActive ? '활성화' : '비활성화'}하시겠습니까?`}
        confirmLabel={confirm?.nextActive ? '활성화' : '비활성화'}
        danger={!confirm?.nextActive}
        onConfirm={handleToggle}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

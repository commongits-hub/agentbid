'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'

type AdminTask = {
  id: string
  title: string
  status: string
  budget_min: number | null
  budget_max: number | null
  submission_count: number
  created_at: string
}

// admin이 변경 가능한 범위
const ALLOWED_STATUSES = ['open', 'reviewing', 'disputed', 'cancelled'] as const
type AllowedStatus = typeof ALLOWED_STATUSES[number]
const STATUS_LABELS: Record<AllowedStatus, string> = {
  open: '공개',
  reviewing: '검토 중',
  disputed: '분쟁',
  cancelled: '취소',
}

type Confirm = { taskId: string; title: string; nextStatus: AllowedStatus } | null

function Skeleton() {
  return (
    <div className="space-y-2">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-800" />
      ))}
    </div>
  )
}

function formatBudget(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—'
  if (min != null && max != null) return `₩${min.toLocaleString()} ~ ₩${max.toLocaleString()}`
  if (min != null) return `₩${min.toLocaleString()}~`
  return `~ ₩${max!.toLocaleString()}`
}

export default function AdminTasksPage() {
  const [tasks, setTasks]       = useState<AdminTask[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [token, setToken]       = useState('')
  const [confirm, setConfirm]   = useState<Confirm>(null)
  const [saving, setSaving]     = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      setToken(session.access_token)
      const res = await fetch('/api/admin/tasks', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json()
      if (!res.ok) setError(json.error ?? '오류가 발생했습니다')
      else {
        // disputed 우선 정렬 — 미정의 status는 맨 뒤로
        const order = ['disputed', 'reviewing', 'open', 'completed', 'expired', 'cancelled']
        const sorted = (json.data ?? []).sort((a: AdminTask, b: AdminTask) => {
          const ai = order.indexOf(a.status); const bi = order.indexOf(b.status)
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
        })
        setTasks(sorted)
      }
      setLoading(false)
    })
  }, [])

  async function handleStatusChange() {
    if (!confirm) return
    setSaving(confirm.taskId)
    setConfirm(null)

    const res = await fetch(`/api/admin/tasks/${confirm.taskId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: confirm.nextStatus }),
    })
    const json = await res.json()
    setSaving(null)

    if (!res.ok) {
      setActionMsg(`❌ ${json.error}`)
    } else {
      setTasks(prev => prev.map(t => t.id === confirm.taskId ? { ...t, status: confirm.nextStatus } : t))
      setActionMsg(`✓ "${confirm.title.slice(0, 20)}..." → ${STATUS_LABELS[confirm.nextStatus]}`)
    }
    setTimeout(() => setActionMsg(null), 3000)
  }

  // 종단 상태(completed/expired)는 변경 불가
  const isTerminal = (s: string) => ['completed', 'expired'].includes(s)

  return (
    <div className="px-8 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-50">작업 목록</h1>
          <p className="mt-0.5 text-sm text-gray-500">삭제되지 않은 최근 작업 50건</p>
        </div>
        {actionMsg && (
          <span className={`rounded-xl px-3 py-1.5 text-xs font-medium ${
            actionMsg.startsWith('❌')
              ? 'border border-red-800 bg-red-950/30 text-red-400'
              : 'border border-emerald-800 bg-emerald-950/30 text-emerald-400'
          }`}>{actionMsg}</span>
        )}
      </div>

      {/* Summary bar */}
      {!loading && !error && tasks.length > 0 && (() => {
        const disputed  = tasks.filter(t => t.status === 'disputed').length
        const reviewing = tasks.filter(t => t.status === 'reviewing').length
        const open      = tasks.filter(t => t.status === 'open').length
        return (
          <div className="mb-6 flex flex-wrap gap-3">
            {disputed > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-red-800/60 bg-red-950/20 px-4 py-2.5">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                <span className="text-sm font-semibold text-red-400">{disputed}건</span>
                <span className="text-xs text-red-600">분쟁</span>
              </div>
            )}
            {reviewing > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-800/60 bg-amber-950/20 px-4 py-2.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-sm font-semibold text-amber-400">{reviewing}건</span>
                <span className="text-xs text-amber-600">검토 중</span>
              </div>
            )}
            <div className="flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-900 px-4 py-2.5">
              <span className="text-sm font-semibold text-gray-300">{open}건</span>
              <span className="text-xs text-gray-600">공개 중</span>
            </div>
          </div>
        )
      })()}

      {loading && <Skeleton />}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">제목</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">상태</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">제출수</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">예산</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">등록일</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">상태 변경</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {tasks.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-600">작업이 없습니다</td></tr>
              ) : (
                tasks.map(t => (
                  <tr key={t.id} className={`hover:bg-gray-900/40 transition-colors ${t.status === 'disputed' ? 'bg-red-950/10' : ''}`}>
                    <td className="max-w-xs px-4 py-3">
                      <p className="truncate text-gray-200">{t.title}</p>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                    <td className="px-4 py-3 text-right text-gray-400">{t.submission_count}</td>
                    <td className="px-4 py-3 text-gray-400">{formatBudget(t.budget_min, t.budget_max)}</td>
                    <td className="px-4 py-3 text-gray-500">{new Date(t.created_at).toLocaleDateString('ko-KR')}</td>
                    <td className="px-4 py-3 text-center">
                      {isTerminal(t.status) ? (
                        <span className="text-xs text-gray-700">종단</span>
                      ) : (
                        <select
                          disabled={saving === t.id}
                          value=""
                          onChange={e => {
                            const v = e.target.value as AllowedStatus
                            if (v && v !== t.status) setConfirm({ taskId: t.id, title: t.title, nextStatus: v })
                            e.target.value = ''
                          }}
                          className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 outline-none hover:border-gray-500 disabled:opacity-40"
                        >
                          <option value="" disabled>변경...</option>
                          {ALLOWED_STATUSES.filter(s => s !== t.status).map(s => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                      )}
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
        title="작업 상태 변경"
        description={confirm ? `"${confirm.title.slice(0, 30)}" 상태를 "${STATUS_LABELS[confirm.nextStatus]}"(으)로 변경하시겠습니까?` : ''}
        confirmLabel="변경"
        danger={confirm?.nextStatus === 'cancelled' || confirm?.nextStatus === 'disputed'}
        onConfirm={handleStatusChange}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

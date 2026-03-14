'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/badge'

type AdminTask = {
  id: string
  title: string
  status: string
  budget_min: number | null
  budget_max: number | null
  submission_count: number
  created_at: string
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

function formatBudget(min: number | null, max: number | null): string {
  if (!min && !max) return '—'
  if (min && max) return `₩${min.toLocaleString()} ~ ₩${max.toLocaleString()}`
  if (min) return `₩${min.toLocaleString()}~`
  return `~ ₩${max!.toLocaleString()}`
}

export default function AdminTasksPage() {
  const [tasks, setTasks]     = useState<AdminTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return

      const res = await fetch('/api/admin/tasks', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json()

      if (!res.ok) {
        setError(json.error ?? '오류가 발생했습니다')
      } else {
        setTasks(json.data ?? [])
      }
      setLoading(false)
    })
  }, [])

  return (
    <div className="px-8 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-50">작업 목록</h1>
        <p className="mt-0.5 text-sm text-gray-500">삭제되지 않은 최근 작업 50건</p>
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
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">제목</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">상태</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">제출수</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">예산</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">등록일</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-600">
                    작업이 없습니다
                  </td>
                </tr>
              ) : (
                tasks.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-900/40 transition-colors">
                    <td className="max-w-xs px-4 py-3">
                      <p className="truncate text-gray-200">{t.title}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400">{t.submission_count}</td>
                    <td className="px-4 py-3 text-gray-400">{formatBudget(t.budget_min, t.budget_max)}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(t.created_at).toLocaleDateString('ko-KR')}
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

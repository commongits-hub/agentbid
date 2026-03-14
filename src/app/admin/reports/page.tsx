'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import type { Variant } from '@/components/ui/badge'

type AdminReport = {
  id: string
  reporter_id: string
  target_type: string
  target_id: string
  reason: string
  status: string
  admin_note: string | null
  created_at: string
}

const REPORT_STATUS_MAP: Record<string, { label: string; variant: Variant }> = {
  pending:   { label: '대기 중',  variant: 'warning' },
  reviewed:  { label: '검토됨',   variant: 'info' },
  dismissed: { label: '기각',     variant: 'muted' },
  actioned:  { label: '조치 완료', variant: 'success' },
}

function ReportStatusBadge({ status }: { status: string }) {
  const { label, variant } = REPORT_STATUS_MAP[status] ?? { label: status, variant: 'muted' as Variant }
  return <Badge variant={variant}>{label}</Badge>
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

export default function AdminReportsPage() {
  const [reports, setReports] = useState<AdminReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return

      const res = await fetch('/api/admin/reports', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json()

      if (!res.ok) {
        setError(json.error ?? '오류가 발생했습니다')
      } else {
        setReports(json.data ?? [])
      }
      setLoading(false)
    })
  }, [])

  return (
    <div className="px-8 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-50">신고 내역</h1>
        <p className="mt-0.5 text-sm text-gray-500">최근 신고 50건</p>
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
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">유형</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">이유</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">상태</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">날짜</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {reports.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-600">
                    신고 내역이 없습니다
                  </td>
                </tr>
              ) : (
                reports.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-900/40 transition-colors">
                    <td className="px-4 py-3">
                      <span className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                        {r.target_type}
                      </span>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <p className="truncate text-gray-300">{r.reason}</p>
                    </td>
                    <td className="px-4 py-3">
                      <ReportStatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(r.created_at).toLocaleDateString('ko-KR')}
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

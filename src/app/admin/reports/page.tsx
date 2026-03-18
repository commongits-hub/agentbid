'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import type { Variant } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'

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

const STATUS_MAP: Record<string, { label: string; variant: Variant }> = {
  pending:   { label: 'Pending',   variant: 'warning' },
  reviewed:  { label: 'Reviewed',  variant: 'info' },
  resolved:  { label: 'Resolved',  variant: 'success' },
  dismissed: { label: 'Dismissed', variant: 'muted' },
}
const NEXT_STATUSES: Record<string, string[]> = {
  pending:   ['reviewed', 'resolved', 'dismissed'],
  reviewed:  ['resolved', 'dismissed'],
  resolved:  [],
  dismissed: [],
}
const STATUS_LABELS: Record<string, string> = {
  pending:   'Pending',
  reviewed:  'Reviewed',
  resolved:  'Resolved',
  dismissed: 'Dismissed',
}

function ReportStatusBadge({ status }: { status: string }) {
  const { label, variant } = STATUS_MAP[status] ?? { label: status, variant: 'muted' as Variant }
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

type Confirm = { reportId: string; reason: string; nextStatus: string } | null

export default function AdminReportsPage() {
  const [reports, setReports]   = useState<AdminReport[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [token, setToken]       = useState('')
  const [confirm, setConfirm]   = useState<Confirm>(null)
  const [adminNote, setAdminNote] = useState('')
  const [saving, setSaving]     = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [noteModal, setNoteModal] = useState<Confirm>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      setToken(session.access_token)
      const res = await fetch('/api/admin/reports', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json()
      if (!res.ok) setError(json.error ?? 'An error occurred.')
      else {
        const sorted = (json.data ?? []).sort((a: AdminReport, b: AdminReport) => {
          const order = ['pending', 'reviewed', 'resolved', 'dismissed']
          return order.indexOf(a.status) - order.indexOf(b.status)
        })
        setReports(sorted)
      }
      setLoading(false)
    })
  }, [])

  async function handleStatusChange() {
    if (!confirm) return
    setSaving(confirm.reportId)
    setConfirm(null)

    const res = await fetch(`/api/admin/reports/${confirm.reportId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: confirm.nextStatus, admin_note: adminNote || undefined }),
    })
    const json = await res.json()
    setSaving(null)
    setAdminNote('')

    if (!res.ok) {
      setActionMsg(`❌ ${json.error}`)
    } else {
      const ORDER = ['pending', 'reviewed', 'resolved', 'dismissed']
      setReports(prev => {
        const updated = prev.map(r =>
          r.id === confirm.reportId
            ? { ...r, status: confirm.nextStatus, admin_note: adminNote || r.admin_note }
            : r
        )
        return updated.sort((a, b) => {
          const ai = ORDER.indexOf(a.status); const bi = ORDER.indexOf(b.status)
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
        })
      })
      setActionMsg(`✓ Report status → ${STATUS_LABELS[confirm.nextStatus]}`)
    }
    setTimeout(() => setActionMsg(null), 3000)
  }

  return (
    <div className="px-8 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-50">Reports</h1>
          <p className="mt-0.5 text-sm text-gray-500">Recent 50 reports</p>
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
      {!loading && !error && reports.length > 0 && (() => {
        const pending  = reports.filter(r => r.status === 'pending').length
        const reviewed = reports.filter(r => r.status === 'reviewed').length
        return (
          <div className="mb-6 flex gap-3">
            {pending > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-800/60 bg-amber-950/20 px-4 py-2.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-sm font-semibold text-amber-400">{pending}</span>
                <span className="text-xs text-amber-600">Pending</span>
              </div>
            )}
            {reviewed > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-blue-800/60 bg-blue-950/20 px-4 py-2.5">
                <span className="h-2 w-2 rounded-full bg-blue-400" />
                <span className="text-sm font-semibold text-blue-400">{reviewed}</span>
                <span className="text-xs text-blue-600">Under review</span>
              </div>
            )}
            {pending === 0 && reviewed === 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-800/60 bg-emerald-950/20 px-4 py-2.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-xs text-emerald-400">No pending reports</span>
              </div>
            )}
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
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Reason</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Admin Note</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Date</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Change Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {reports.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-600">No reports found.</td></tr>
              ) : (
                reports.map(r => {
                  const nextOpts = NEXT_STATUSES[r.status] ?? []
                  return (
                    <tr key={r.id} className="hover:bg-gray-900/40 transition-colors">
                      <td className="px-4 py-3">
                        <span className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400">{r.target_type}</span>
                      </td>
                      <td className="max-w-[200px] px-4 py-3">
                        <p className="truncate text-gray-300" title={r.reason}>{r.reason}</p>
                      </td>
                      <td className="px-4 py-3"><ReportStatusBadge status={r.status} /></td>
                      <td className="max-w-[160px] px-4 py-3">
                        <p className="truncate text-xs text-gray-600" title={r.admin_note ?? undefined}>
                          {r.admin_note ?? '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{new Date(r.created_at).toLocaleDateString('en-US')}</td>
                      <td className="px-4 py-3 text-center">
                        {nextOpts.length === 0 ? (
                          <span className="text-xs text-gray-700">Terminal</span>
                        ) : (
                          <select
                            disabled={saving === r.id}
                            value=""
                            onChange={e => {
                              const v = e.target.value
                              if (v) {
                                setNoteModal({ reportId: r.id, reason: r.reason, nextStatus: v })
                              }
                              e.target.value = ''
                            }}
                            className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 outline-none hover:border-gray-500 disabled:opacity-40"
                          >
                            <option value="" disabled>Change...</option>
                            {nextOpts.map(s => (
                              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Note input modal */}
      {noteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => { setNoteModal(null); setAdminNote('') }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-gray-50">Change Report Status</h3>
            <p className="mt-2 text-sm text-gray-400">
              Set status to <span className="font-medium text-gray-200">"{STATUS_LABELS[noteModal.nextStatus]}"</span>.
            </p>
            <div className="mt-4">
              <p className="text-xs text-gray-500 mb-1.5">Admin Note <span className="text-gray-700">(optional)</span></p>
              <textarea
                value={adminNote}
                onChange={e => setAdminNote(e.target.value)}
                placeholder="Reason, action taken, etc..."
                rows={3}
                className="w-full rounded-xl border border-gray-800 bg-gray-950/50 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-emerald-500 resize-none"
              />
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => { setNoteModal(null); setAdminNote('') }}
                className="rounded-xl border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:border-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirm(noteModal); setNoteModal(null) }}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-gray-950 hover:bg-emerald-400"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title="Confirm Change"
        description={confirm ? `Change report status to "${STATUS_LABELS[confirm.nextStatus]}"?` : ''}
        confirmLabel="Confirm"
        danger={confirm?.nextStatus === 'dismissed'}
        onConfirm={handleStatusChange}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/middleware/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

const ALLOWED_STATUSES = ['pending', 'reviewed', 'resolved', 'dismissed'] as const
type ReportStatus = typeof ALLOWED_STATUSES[number]

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth(req)
  if ('error' in authResult) return authResult.error
  if (authResult.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body?.status) return NextResponse.json({ error: 'status required' }, { status: 400 })

  if (!ALLOWED_STATUSES.includes(body.status as ReportStatus)) {
    return NextResponse.json({ error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(', ')}` }, { status: 400 })
  }

  const updatePayload: { status: ReportStatus; admin_note?: string | null } = { status: body.status }
  if (typeof body.admin_note === 'string') {
    // 빈 문자열 → null (기존 메모 clear 명시적 처리)
    updatePayload.admin_note = body.admin_note.trim() || null
  }

  const { data, error } = await supabaseAdmin
    .from('reports')
    .update(updatePayload)
    .eq('id', id)
    .select('id, status, admin_note')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  return NextResponse.json({ data })
}

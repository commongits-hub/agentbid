import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/middleware/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

const ALLOWED_STATUSES = ['open', 'reviewing', 'disputed', 'cancelled'] as const
type AllowedStatus = typeof ALLOWED_STATUSES[number]

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

  if (!ALLOWED_STATUSES.includes(body.status as AllowedStatus)) {
    return NextResponse.json({ error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(', ')}` }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('tasks')
    .update({ status: body.status })
    .eq('id', id)
    .is('soft_deleted_at', null)   // 삭제된 task 변경 차단
    .select('id, title, status')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  return NextResponse.json({ data })
}

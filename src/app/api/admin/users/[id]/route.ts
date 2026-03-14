import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/middleware/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth(req)
  if ('error' in authResult) return authResult.error
  if (authResult.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body.is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active (boolean) required' }, { status: 400 })
  }

  if (id === authResult.user.id) {
    return NextResponse.json({ error: '자신의 계정은 변경할 수 없습니다.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ is_active: body.is_active })
    .eq('id', id)
    .select('id, email, is_active')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

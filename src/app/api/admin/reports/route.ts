// src/app/api/admin/reports/route.ts
// GET /api/admin/reports — admin 전용 신고 목록

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/middleware/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

export type AdminReport = {
  id: string
  reporter_id: string
  target_type: string
  target_id: string
  reason: string
  status: string
  admin_note: string | null
  created_at: string
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('error' in auth) return auth.error

  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('reports')
    .select('id, reporter_id, target_type, target_id, reason, status, admin_note, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data as AdminReport[] })
}

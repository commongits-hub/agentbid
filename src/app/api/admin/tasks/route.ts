// src/app/api/admin/tasks/route.ts
// GET /api/admin/tasks — admin 전용 작업 목록

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/middleware/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

export type AdminTask = {
  id: string
  title: string
  status: string
  budget_min: number | null
  budget_max: number | null
  submission_count: number
  created_at: string
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('error' in auth) return auth.error

  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('tasks')
    .select('id, title, status, budget_min, budget_max, submission_count, created_at')
    .is('soft_deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data as AdminTask[] })
}

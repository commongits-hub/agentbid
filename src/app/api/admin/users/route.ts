// src/app/api/admin/users/route.ts
// GET /api/admin/users — admin 전용 유저 목록

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/middleware/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

export type AdminUser = {
  id: string
  email: string
  nickname: string | null
  role: string
  is_active: boolean
  created_at: string
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('error' in auth) return auth.error

  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, nickname, role, is_active, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data as AdminUser[] })
}

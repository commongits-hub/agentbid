// src/app/api/tasks/route.ts
// GET  /api/tasks       - task 목록 조회 (open 상태, 페이지네이션)
// POST /api/tasks       - task 등록 (user 역할 필요)

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { requireAuth } from '@/middleware/auth'
import { createServerClientWithAuth } from '@/lib/supabase/server'

// Bearer/cookie 분기 helper (orders, submissions와 동일 패턴)
async function makeSupabaseClient(req: NextRequest) {
  const bearerToken = req.headers.get('authorization')?.replace('Bearer ', '')
  if (bearerToken) return createServerClientWithAuth(bearerToken)
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cs) { cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) },
      },
    },
  )
}

// GET /api/tasks?page=1&limit=20&category=uuid
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('error' in auth) return auth.error

  const { searchParams } = req.nextUrl

  // NaN 방어: parseInt 결과가 유한수가 아니면 기본값 사용
  const rawPage  = parseInt(searchParams.get('page')  ?? '1')
  const rawLimit = parseInt(searchParams.get('limit') ?? '20')
  const page     = Math.max(1, Number.isFinite(rawPage)  ? rawPage  : 1)
  const limit    = Math.min(50, Number.isFinite(rawLimit) ? rawLimit : 20)

  const category = searchParams.get('category')
  const offset   = (page - 1) * limit

  const supabase = await makeSupabaseClient(req)

  let query = supabase
    .from('tasks')
    .select('id, user_id, category_id, title, description, status, deadline_at, submission_count, published_at, created_at', { count: 'exact' })
    .eq('status', 'open')
    .is('soft_deleted_at', null)
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (category) {
    query = query.eq('category_id', category)
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    data,
    meta: { page, limit, total: count ?? 0 },
  })
}

// POST /api/tasks
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('error' in auth) return auth.error

  // provider는 task 등록 불가 (user 역할만 가능)
  if (auth.user.role === 'provider') {
    return NextResponse.json({ error: 'Providers cannot create tasks' }, { status: 403 })
  }

  let body: any = null
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { title, description, category_id, deadline_at, budget_min, budget_max } = body

  if (!title || !description) {
    return NextResponse.json(
      { error: 'title and description are required' },
      { status: 400 },
    )
  }

  const supabase = await makeSupabaseClient(req)

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id:    auth.user.id,
      title,
      description,
      category_id: category_id  ?? null,
      deadline_at: deadline_at  ?? null,
      budget_min:  budget_min   ?? null,
      budget_max:  budget_max   ?? null,
      status: 'draft',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}

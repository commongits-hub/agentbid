// src/app/api/submissions/route.ts
// GET  /api/submissions?task_id=uuid  - task의 submission 목록 조회 (필드 shaping 적용)
// POST /api/submissions               - submission 등록 (provider 전용)

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireProvider } from '@/middleware/auth'
import { supabaseAdmin, createServerClientWithAuth } from '@/lib/supabase/server'
import { shapeSubmissions } from '@/lib/submission-shaper'
import type { SubmissionRow } from '@/types'

// GET /api/submissions?task_id=uuid
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('error' in auth) return auth.error

  const taskId = req.nextUrl.searchParams.get('task_id')
  if (!taskId) {
    return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
  }

  const supabase = createServerClientWithAuth(
    req.headers.get('authorization')?.replace('Bearer ', '') ?? '',
  )

  // 1. task 소유자 확인 (RLS 통과 후 추가 검증)
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('id, user_id, status')
    .eq('id', taskId)
    .single()

  if (taskError || !task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const isTaskOwner = task.user_id === auth.user.id

  // task owner도 아니고 provider도 아니면 접근 차단
  if (!isTaskOwner && auth.user.role !== 'provider') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 2. submissions 조회 (RLS에 의해 이미 필터링됨)
  const { data: rows, error } = await supabase
    .from('submissions')
    .select('*')
    .eq('task_id', taskId)
    .is('soft_deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // task owner가 결제 완료한 submission ID 목록 조회 (service_role 사용)
  let paidSubmissionIds = new Set<string>()

  if (isTaskOwner) {
    const { data: paidOrders } = await supabaseAdmin
      .from('orders')
      .select('submission_id')
      .eq('task_id', taskId)
      .eq('user_id', auth.user.id)
      .eq('status', 'paid')

    if (paidOrders) {
      paidSubmissionIds = new Set(paidOrders.map((o) => o.submission_id))
    }
  }

  // 4. ⚠️ 핵심: 호출자 권한에 따라 필드 필터링 강제 적용
  const shaped = shapeSubmissions(
    rows as SubmissionRow[],
    auth.user.id,
    task.user_id,
    paidSubmissionIds,
  )

  return NextResponse.json({ data: shaped })
}

// POST /api/submissions
export async function POST(req: NextRequest) {
  const auth = await requireProvider(req)
  if ('error' in auth) return auth.error

  const body = await req.json()
  const { task_id, quoted_price, preview_text, content_text, file_path, file_name, file_size, mime_type } = body

  // 필수 필드 검증
  if (!task_id || !quoted_price) {
    return NextResponse.json(
      { error: 'task_id and quoted_price are required' },
      { status: 400 },
    )
  }

  if (quoted_price < 1000 || quoted_price > 10_000_000) {
    return NextResponse.json(
      { error: 'quoted_price must be between 1000 and 10000000' },
      { status: 400 },
    )
  }

  if (!preview_text || preview_text.trim().length === 0) {
    return NextResponse.json(
      { error: 'preview_text is required' },
      { status: 400 },
    )
  }

  const supabase = createServerClientWithAuth(
    req.headers.get('authorization')?.replace('Bearer ', '') ?? '',
  )

  // agent_id 조회 (현재 유저의 agent)
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('id')
    .is('soft_deleted_at', null)
    .single()

  if (agentError || !agent) {
    return NextResponse.json({ error: 'No agent found for this provider' }, { status: 403 })
  }

  // task 상태 확인 (open만 제출 가능)
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('id, status')
    .eq('id', task_id)
    .single()

  if (taskError || !task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  if (task.status !== 'open') {
    return NextResponse.json(
      { error: 'Task is not accepting submissions' },
      { status: 422 },
    )
  }

  const { data, error } = await supabase
    .from('submissions')
    .insert({
      task_id,
      agent_id: agent.id,
      quoted_price,
      preview_text: preview_text.slice(0, 200), // 최대 200자
      content_text: content_text ?? null,
      file_path: file_path ?? null,
      file_name: file_name ?? null,
      file_size: file_size ?? null,
      mime_type: mime_type ?? null,
      status: 'submitted',
    })
    .select('id, task_id, agent_id, status, quoted_price, preview_text, created_at')
    .single()

  if (error) {
    // 중복 제출 처리
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'You have already submitted to this task' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ✅ 제출 직후 응답: content_text, file_path 제외 (provider 본인이라도 확인용만 반환)
  return NextResponse.json({ data }, { status: 201 })
}

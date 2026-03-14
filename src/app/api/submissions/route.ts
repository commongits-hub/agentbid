// src/app/api/submissions/route.ts
// GET  /api/submissions?task_id=uuid  - task의 submission 목록 조회
// POST /api/submissions               - submission 등록 (provider 전용)
//
// ⚠️ content_text / file_path 마스킹 정책:
//   - task owner: shapeSubmissions() 적용 — paid 주문만 원본 공개
//   - provider:   자기 submission만 조회 가능 (agent_id 기준 필터)
//   - 그 외:      403

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireProvider } from '@/middleware/auth'
import { supabaseAdmin, createServerClientWithAuth } from '@/lib/supabase/server'
import { shapeSubmissions } from '@/lib/submission-shaper'
import type { SubmissionRow } from '@/types'

// ── 허용 MIME 타입 allowlist ────────────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/html', 'text/csv',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/zip', 'application/x-zip-compressed',
])

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB

// submissions 조회용 컬럼 목록 (content 포함)
const SUBMISSION_FULL_COLUMNS = [
  'id', 'task_id', 'agent_id', 'status', 'quoted_price',
  'preview_text', 'preview_thumbnail_url',
  'content_text', 'file_path', 'file_name', 'file_size', 'mime_type',
  'created_at', 'updated_at',
].join(', ')

// submissions 목록용 컬럼 (content 제외) — 아직 미구매 상태에서 사용
const SUBMISSION_PREVIEW_COLUMNS = [
  'id', 'task_id', 'agent_id', 'status', 'quoted_price',
  'preview_text', 'preview_thumbnail_url',
  'created_at', 'updated_at',
].join(', ')

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/submissions?task_id=uuid
// ──────────────────────────────────────────────────────────────────────────────
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

  // 1. task 존재 + 소유자 확인
  const { data: task } = await supabase
    .from('tasks')
    .select('id, user_id, status')
    .eq('id', taskId)
    .single()

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const isTaskOwner = task.user_id === auth.user.id

  // ── Case A: task owner ──────────────────────────────────────────────────────
  if (isTaskOwner) {
    // task owner: 모든 submission 조회 (content 포함) + shaping 적용
    const { data: rows, error } = await supabase
      .from('submissions')
      .select(SUBMISSION_FULL_COLUMNS)
      .eq('task_id', taskId)
      .is('soft_deleted_at', null)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // 결제 완료 submission ID 조회 (service_role — paid 판단 단일 경로)
    const { data: paidOrders } = await supabaseAdmin
      .from('orders')
      .select('submission_id')
      .eq('task_id', taskId)
      .eq('user_id', auth.user.id)
      .eq('status', 'paid')

    const paidSubmissionIds = new Set(
      (paidOrders ?? []).map((o: any) => o.submission_id as string),
    )

    // ⚠️ 핵심: paid 여부 기준으로 content 공개 제어
    const shaped = shapeSubmissions(
      (rows as unknown) as SubmissionRow[],
      auth.user.id,
      task.user_id,
      paidSubmissionIds,
    )

    return NextResponse.json({ data: shaped })
  }

  // ── Case B: provider — 본인 submission만 조회 ──────────────────────────────
  if (auth.user.role === 'provider') {
    // provider의 agent 조회 (user_id = auth.user.id 명시 — RLS 의존하지 않음)
    const { data: agent } = await supabase
      .from('agents')
      .select('id')
      .eq('user_id', auth.user.id)   // ← 명시적 소유권 검증
      .is('soft_deleted_at', null)
      .maybeSingle()

    if (!agent) {
      return NextResponse.json({ error: 'No agent found for this provider' }, { status: 403 })
    }

    // 본인 submission만 조회 (agent_id 기준 필터)
    // provider는 자신이 제출한 내용 전체를 볼 수 있음 (본인 작성물)
    const { data: rows, error } = await supabase
      .from('submissions')
      .select(SUBMISSION_FULL_COLUMNS)
      .eq('task_id', taskId)
      .eq('agent_id', agent.id)     // ← 본인 submission만
      .is('soft_deleted_at', null)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data: rows ?? [] })
  }

  // ── Case C: 그 외 → 403 ────────────────────────────────────────────────────
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/submissions
// ──────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireProvider(req)
  if ('error' in auth) return auth.error

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    task_id,
    quoted_price: rawPrice,
    preview_text: rawPreview,
    content_text: rawContent,
    file_path,
    file_name,
    file_size,
    mime_type,
  } = body

  // ── 1. 필수 필드 ──────────────────────────────────────────────────────────
  if (!task_id || typeof task_id !== 'string') {
    return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
  }

  // ── 2. quoted_price: 정수 강제 ────────────────────────────────────────────
  const quoted_price = Math.floor(Number(rawPrice))
  if (!Number.isFinite(quoted_price) || quoted_price !== Number(rawPrice)) {
    return NextResponse.json(
      { error: 'quoted_price must be an integer' },
      { status: 400 },
    )
  }
  if (quoted_price < 1000 || quoted_price > 10_000_000) {
    return NextResponse.json(
      { error: 'quoted_price must be between 1000 and 10000000' },
      { status: 400 },
    )
  }

  // ── 3. preview_text: 정규화 ──────────────────────────────────────────────
  const preview_text = typeof rawPreview === 'string'
    ? rawPreview.replace(/\s+/g, ' ').trim().slice(0, 200)  // 공백 정규화 + 200자 제한
    : null

  if (!preview_text || preview_text.length < 10) {
    return NextResponse.json(
      { error: 'preview_text must be at least 10 characters' },
      { status: 400 },
    )
  }

  // ── 4. content 최소 요건: content_text 또는 file_path 중 하나 필수 ────────
  const content_text = typeof rawContent === 'string' && rawContent.trim().length > 0
    ? rawContent.trim()
    : null

  if (!content_text && !file_path) {
    return NextResponse.json(
      { error: 'Either content_text or file_path is required' },
      { status: 400 },
    )
  }

  // ── 5. file 메타데이터 검증 ───────────────────────────────────────────────
  if (file_path !== undefined && file_path !== null) {
    if (typeof file_path !== 'string') {
      return NextResponse.json({ error: 'file_path must be a string' }, { status: 400 })
    }
    // file_path는 'submissions/{uuid}/' 로 시작해야 함 (임의 경로 심기 방지)
    if (!file_path.startsWith('submissions/')) {
      return NextResponse.json(
        { error: 'file_path must start with submissions/' },
        { status: 400 },
      )
    }
  }

  if (file_size !== undefined && file_size !== null) {
    const size = Number(file_size)
    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ error: 'file_size must be a positive number' }, { status: 400 })
    }
    if (size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `file_size must not exceed ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 },
      )
    }
  }

  if (mime_type !== undefined && mime_type !== null) {
    if (!ALLOWED_MIME_TYPES.has(mime_type)) {
      return NextResponse.json(
        { error: `Unsupported mime_type: ${mime_type}` },
        { status: 400 },
      )
    }
  }

  // ── 6. agent 조회: user_id = auth.user.id 명시 ────────────────────────────
  const supabase = createServerClientWithAuth(
    req.headers.get('authorization')?.replace('Bearer ', '') ?? '',
  )

  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('id')
    .eq('user_id', auth.user.id)   // ← 명시적 소유권 검증 (RLS 의존 금지)
    .is('soft_deleted_at', null)
    .maybeSingle()

  if (agentError || !agent) {
    return NextResponse.json({ error: 'No agent found for this provider' }, { status: 403 })
  }

  // ── 7. task 유효성 검증 ───────────────────────────────────────────────────
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('id, user_id, status')
    .eq('id', task_id)
    .single()

  if (taskError || !task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  // task 상태 확인 (open만 제출 가능)
  if (task.status !== 'open') {
    return NextResponse.json(
      { error: 'Task is not accepting submissions' },
      { status: 422 },
    )
  }

  // 자기 own task 제출 방지 (API 레벨 — DB trigger와 이중 방어)
  if (task.user_id === auth.user.id) {
    return NextResponse.json(
      { error: 'Cannot submit to your own task' },
      { status: 422 },
    )
  }

  // ── 8. submission 등록 ────────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('submissions')
    .insert({
      task_id,
      agent_id: agent.id,
      quoted_price,
      preview_text,
      content_text,
      file_path:  file_path  ?? null,
      file_name:  file_name  ?? null,
      file_size:  file_size  != null ? Number(file_size) : null,
      mime_type:  mime_type  ?? null,
      status: 'submitted',
    })
    .select('id, task_id, agent_id, status, quoted_price, preview_text, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'You have already submitted to this task' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ✅ 응답: content_text / file_path 제외 (확인용 필드만 반환)
  return NextResponse.json({ data }, { status: 201 })
}

'use client'

// src/app/tasks/[id]/page.tsx
// Task 상세 + submission 목록 비교 (task owner 전용)
// - task owner: 모든 submission preview 비교 → 선택 → checkout
// - provider: 자신의 submission 상태 확인만

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Task = {
  id: string
  title: string
  description: string
  status: string
  budget_min: number | null
  budget_max: number | null
  user_id: string
}

type Submission = {
  id: string
  agent_id: string
  status: string
  quoted_price: number
  preview_text: string | null
  preview_thumbnail_url: string | null
  // content_text / file_path: 결제 후에만 존재
  content_text?: string | null
  file_path?: string | null
}

export default function TaskDetailPage() {
  const { id: taskId } = useParams<{ id: string }>()
  const router = useRouter()
  const [task, setTask]               = useState<Task | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [myUserId, setMyUserId]       = useState<string | null>(null)
  const [loading, setLoading]         = useState(true)
  const [selecting, setSelecting]     = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      setMyUserId(session?.user.id ?? null)

      // task 조회
      const { data: t } = await supabase
        .from('tasks')
        .select('id, title, description, status, budget_min, budget_max, user_id')
        .eq('id', taskId)
        .single()

      if (!t) { router.push('/tasks'); return }
      setTask(t as Task)

      // submission 목록 (Bearer 토큰으로 shaping 포함)
      if (session) {
        const res = await fetch(`/api/submissions?task_id=${taskId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const data = await res.json()
        setSubmissions(data.data ?? [])
      }

      setLoading(false)
    }

    load()
  }, [taskId])

  async function handleSelectAndCheckout(submissionId: string, price: number) {
    setSelecting(submissionId)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/auth/login'); return }

    // order 생성 + Stripe checkout URL 요청
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ task_id: taskId, submission_id: submissionId }),
    })
    const data = await res.json()

    if (data.checkout_url) {
      window.location.href = data.checkout_url
    } else {
      alert(data.error ?? '결제 URL 생성 실패')
      setSelecting(null)
    }
  }

  if (loading) return <main className="p-8"><p>불러오는 중...</p></main>
  if (!task)   return null

  const isOwner = myUserId === task.user_id

  return (
    <main className="mx-auto max-w-2xl p-8">
      <button onClick={() => router.push('/tasks')} className="mb-4 text-sm text-gray-500 underline">
        ← 목록으로
      </button>

      {/* Task 정보 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{task.title}</h1>
        <p className="mt-2 text-gray-700">{task.description}</p>
        {(task.budget_min || task.budget_max) && (
          <p className="mt-2 text-violet-600">
            예산: {task.budget_min?.toLocaleString()}원
            {task.budget_max ? ` ~ ${task.budget_max.toLocaleString()}원` : ''}
          </p>
        )}
        <span className={`mt-2 inline-block rounded px-2 py-0.5 text-xs ${
          task.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {task.status}
        </span>
      </div>

      {/* Submission 목록 */}
      <h2 className="mb-4 text-lg font-semibold">
        제출물 목록 ({submissions.length}개)
      </h2>

      {submissions.length === 0 ? (
        <p className="text-gray-500">아직 제출된 결과물이 없습니다.</p>
      ) : (
        <ul className="space-y-4">
          {submissions.map(sub => (
            <li key={sub.id} className="rounded border p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  {/* preview_thumbnail_url이 있으면 표시 */}
                  {sub.preview_thumbnail_url && (
                    <img
                      src={sub.preview_thumbnail_url}
                      alt="preview"
                      className="mb-2 h-24 w-full rounded object-cover"
                    />
                  )}
                  <p className="text-sm text-gray-700">
                    {sub.preview_text ?? '(미리보기 없음)'}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">상태: {sub.status}</p>

                  {/* 결제 후 full content */}
                  {sub.content_text && (
                    <div className="mt-2 rounded bg-green-50 p-2 text-sm">
                      <p className="font-medium text-green-700">전체 내용</p>
                      <p className="text-gray-700">{sub.content_text}</p>
                    </div>
                  )}
                  {sub.file_path && (
                    <a
                      href={`/api/submissions/${sub.id}/download`}
                      className="mt-1 block text-sm text-blue-600 underline"
                    >
                      파일 다운로드
                    </a>
                  )}
                </div>

                {/* 가격 + 선택 버튼 (task owner만) */}
                <div className="ml-4 text-right">
                  <p className="font-bold text-violet-600">
                    {sub.quoted_price.toLocaleString()}원
                  </p>
                  {isOwner && task.status === 'open' && sub.status === 'submitted' && (
                    <button
                      onClick={() => handleSelectAndCheckout(sub.id, sub.quoted_price)}
                      disabled={selecting === sub.id}
                      className="mt-2 rounded bg-violet-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    >
                      {selecting === sub.id ? '처리 중...' : '선택 · 결제'}
                    </button>
                  )}
                  {sub.status === 'purchased' && (
                    <span className="mt-2 block text-xs font-medium text-green-600">구매 완료</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

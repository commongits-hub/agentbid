'use client'

// src/app/tasks/new/page.tsx
// Task 등록 폼 (user 역할 전용)
// - title, description, budget_min/max, deadline_at
// - POST /api/tasks → 성공 시 /tasks로 이동
// - provider 접근 시 /tasks로 리다이렉트

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function NewTaskPage() {
  const router = useRouter()
  const [token, setToken]         = useState<string | null>(null)
  const [appRole, setAppRole]     = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const [form, setForm] = useState({
    title:       '',
    description: '',
    budget_min:  '',
    budget_max:  '',
    deadline_at: '',
  })

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/auth/login'); return }

      const meta = session.user.app_metadata ?? session.user.user_metadata ?? {}
      const role = meta.app_role ?? session.user.user_metadata?.app_role ?? session.user.user_metadata?.role ?? 'user'

      // provider는 task 등록 불가
      if (role === 'provider') { router.push('/tasks'); return }

      setToken(session.access_token)
      setAppRole(role)
      setLoading(false)
    })
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return

    const { title, description, budget_min, budget_max, deadline_at } = form

    if (!title.trim()) { setError('제목을 입력해주세요.'); return }
    if (!description.trim()) { setError('설명을 입력해주세요.'); return }

    setSubmitting(true)
    setError(null)

    const body: Record<string, unknown> = { title: title.trim(), description: description.trim() }
    if (budget_min) body.budget_min = parseInt(budget_min, 10)
    if (budget_max) body.budget_max = parseInt(budget_max, 10)
    if (deadline_at) body.deadline_at = new Date(deadline_at).toISOString()

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? '등록 실패')
      setSubmitting(false)
      return
    }

    router.push('/tasks')
  }

  if (loading) return <main className="p-8"><p>불러오는 중...</p></main>

  return (
    <main className="mx-auto max-w-xl p-8">
      <button onClick={() => router.push('/tasks')} className="mb-4 text-sm text-gray-500 underline">
        ← 목록으로
      </button>

      <h1 className="mb-6 text-2xl font-bold">Task 등록</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 제목 */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">제목 *</label>
          <input
            name="title"
            value={form.title}
            onChange={handleChange}
            placeholder="어떤 작업이 필요한가요?"
            maxLength={200}
            required
            className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
        </div>

        {/* 설명 */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">설명 *</label>
          <textarea
            name="description"
            value={form.description}
            onChange={handleChange}
            placeholder="작업 요건, 형식, 주의사항 등을 자세히 적어주세요."
            rows={5}
            maxLength={5000}
            required
            className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
        </div>

        {/* 예산 */}
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-gray-700">최소 예산 (원)</label>
            <input
              name="budget_min"
              type="number"
              value={form.budget_min}
              onChange={handleChange}
              min={0}
              step={1000}
              placeholder="예: 10000"
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-gray-700">최대 예산 (원)</label>
            <input
              name="budget_max"
              type="number"
              value={form.budget_max}
              onChange={handleChange}
              min={0}
              step={1000}
              placeholder="예: 50000"
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>
        </div>

        {/* 마감일 */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">마감일</label>
          <input
            name="deadline_at"
            type="datetime-local"
            value={form.deadline_at}
            onChange={handleChange}
            className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
        </div>

        {error && (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-violet-600 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {submitting ? '등록 중...' : 'Task 등록'}
        </button>
      </form>
    </main>
  )
}

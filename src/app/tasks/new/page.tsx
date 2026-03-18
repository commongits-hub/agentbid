'use client'

// src/app/tasks/new/page.tsx
// Task creation form (user role only)
// - title, description, budget_min/max, deadline_at
// - POST /api/tasks → redirects to /tasks on success
// - Redirects non-user roles to /tasks

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function NewTaskPage() {
  const router = useRouter()
  const [token, setToken]         = useState<string | null>(null)
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

      const role = session.user.app_metadata?.app_role ?? 'user'
      if (role !== 'user') { router.push('/tasks'); return }

      setToken(session.access_token)
      setLoading(false)
    })
  }, [router])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return

    const { title, description, budget_min, budget_max, deadline_at } = form

    if (!title.trim()) { setError('Title is required.'); return }
    if (!description.trim()) { setError('Description is required.'); return }

    const minBudget = budget_min ? parseInt(budget_min, 10) : null
    const maxBudget = budget_max ? parseInt(budget_max, 10) : null

    if (minBudget != null && (!Number.isFinite(minBudget) || minBudget < 0)) {
      setError('Min budget must be 0 or greater.'); return
    }
    if (maxBudget != null && (!Number.isFinite(maxBudget) || maxBudget < 0)) {
      setError('Max budget must be 0 or greater.'); return
    }
    if (minBudget != null && maxBudget != null && minBudget > maxBudget) {
      setError('Min budget cannot be greater than max budget.'); return
    }

    setSubmitting(true)
    setError(null)

    const body: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim(),
    }
    if (minBudget != null) body.budget_min = minBudget
    if (maxBudget != null) body.budget_max = maxBudget
    if (deadline_at) body.deadline_at = new Date(deadline_at).toISOString()

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      setError(data?.error ?? 'Failed to post task.')
      setSubmitting(false)
      return
    }

    router.push('/tasks')
  }

  if (loading) {
    return <main className="p-8"><p className="text-sm text-gray-400">Loading...</p></main>
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <button onClick={() => router.push('/tasks')} className="mb-4 text-sm text-gray-500 underline">
        ← Back to list
      </button>

      <h1 className="mb-6 text-2xl font-bold">Post a Task</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Title *</label>
          <input
            name="title"
            value={form.title}
            onChange={handleChange}
            placeholder="What do you need done?"
            maxLength={200}
            required
            className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Description *</label>
          <textarea
            name="description"
            value={form.description}
            onChange={handleChange}
            placeholder="Describe requirements, format, and any notes in detail."
            rows={5}
            maxLength={5000}
            required
            className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-gray-700">Min Budget (₩)</label>
            <input
              name="budget_min"
              type="number"
              value={form.budget_min}
              onChange={handleChange}
              min={0}
              step={1000}
              placeholder="e.g. 10000"
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-gray-700">Max Budget (₩)</label>
            <input
              name="budget_max"
              type="number"
              value={form.budget_max}
              onChange={handleChange}
              min={0}
              step={1000}
              placeholder="e.g. 50000"
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Deadline</label>
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
          {submitting ? 'Posting...' : 'Post Task'}
        </button>
      </form>
    </main>
  )
}

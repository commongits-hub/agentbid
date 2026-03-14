'use client'

// src/app/tasks/page.tsx
// Task 목록 페이지 — open 상태 task 조회

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Task = {
  id: string
  title: string
  description: string
  status: string
  budget_min: number | null
  budget_max: number | null
  created_at: string
}

export default function TasksPage() {
  const [tasks, setTasks]     = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('tasks')
      .select('id, title, description, status, budget_min, budget_max, created_at')
      .eq('status', 'open')
      .is('soft_deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setTasks((data as Task[]) ?? [])
        setLoading(false)
      })
  }, [])

  if (loading) return <main className="p-8"><p>불러오는 중...</p></main>

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Task 목록</h1>
        <Link href="/tasks/new" className="rounded bg-black px-4 py-2 text-sm text-white">
          + Task 등록
        </Link>
      </div>

      {tasks.length === 0 && (
        <p className="text-gray-500">등록된 Task가 없습니다.</p>
      )}

      <ul className="space-y-4">
        {tasks.map(task => (
          <li key={task.id} className="rounded border p-4 hover:bg-gray-50">
            <Link href={`/tasks/${task.id}`}>
              <h2 className="font-semibold">{task.title}</h2>
              <p className="text-sm text-gray-600 line-clamp-2">{task.description}</p>
              {(task.budget_min || task.budget_max) && (
                <p className="mt-1 text-sm text-violet-600">
                  예산: {task.budget_min?.toLocaleString()}원
                  {task.budget_max ? ` ~ ${task.budget_max.toLocaleString()}원` : ''}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                {new Date(task.created_at).toLocaleDateString('ko-KR')}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}

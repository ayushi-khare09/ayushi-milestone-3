import { describe, expect, it } from 'vitest'
import { runProjectAnalysis } from '../agents/engine'
import type { MilestonePlanResult, ProjectIdea, StudentProfile } from '../types/models'
import { buildLocalMentorReply } from './mentor'
import { adjustPlanForProgress } from './progress'
import { makeProjectReport } from './reportGeneration'

const project: ProjectIdea = {
  id: 'project_m3',
  studentId: 'student_m3',
  title: 'Attendance Tracker',
  description: 'A web application to record and review classroom attendance for a small student group.',
  domain: 'web',
  durationWeeks: 6,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const profile: StudentProfile = {
  id: 'student_m3',
  userId: 'user_m3',
  name: 'Student',
  course: 'Computer Science',
  year: '2nd year',
  skills: [{ skill: 'JavaScript', category: 'programming', level: 2, selfLevel: 2 }],
  priorProjects: 'one',
  weeklyHours: 8,
  assessment: { score: 55, level: 'intermediate', strengths: [], growthAreas: [], verifiedShare: 0, assessedAt: '2026-01-01T00:00:00.000Z' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const results = runProjectAnalysis(project, profile)

describe('Milestone 3 workflows', () => {
  it('gives project-aware mentor guidance for blockers and weekly check-ins', () => {
    const advice = buildLocalMentorReply('I am blocked by a risk. What should I do?', project, results)
    expect(advice).toContain(results.risk.risks[0].mitigation)

    const checkIn = buildLocalMentorReply(
      'Weekly check-in (week 2)\nCompleted: Set up the database\nBlockers: API connection fails\nNext focus: Test the attendance flow',
      project,
      results,
    )
    expect(checkIn).toContain('Set up the database')
    expect(checkIn).toContain('API connection fails')
    expect(checkIn).toContain('Test the attendance flow')
  })

  it('reflects milestone status changes and carries unfinished work forward', () => {
    const plan: MilestonePlanResult = {
      projectDurationWeeks: 2,
      totalWeeks: 2,
      summary: 'Two-week plan.',
      milestones: [
        { week: 1, title: 'Plan', tasks: ['Define scope'], dependencies: [], estimatedHours: 4, deliverables: ['Scope'], status: 'planned', requiredSkills: [] },
        { week: 2, title: 'Build', tasks: ['Implement MVP'], dependencies: [], estimatedHours: 6, deliverables: ['MVP'], status: 'planned', requiredSkills: [] },
      ],
    }

    const adjusted = adjustPlanForProgress(plan, [
      { week: 1, status: 'in-progress' },
      { week: 2, status: 'planned' },
    ])

    expect(adjusted.milestones[0].status).toBe('in-progress')
    expect(adjusted.milestones[1].dependencies).toContain('Week 1 carry-over')
    expect(adjusted.summary).toContain('latest milestone progress')

    const completed = adjustPlanForProgress(plan, [{ week: 1, status: 'done' }])
    expect(completed.milestones[0].status).toBe('done')
    expect(completed.milestones[0].tasks).toEqual(plan.milestones[0].tasks)
  })

  it('creates methodology and progress reports from blueprint and student updates', () => {
    const methodology = makeProjectReport('methodology', project, results, [])
    expect(methodology).toContain('## Methodological approach')
    expect(methodology).toContain('## Development phases')
    expect(methodology).toContain('## Evaluation criteria')

    const progress = makeProjectReport('progress', project, results, [{ week: 1, status: 'done' }])
    expect(progress).toContain('1 of 6 milestones marked complete.')
    expect(progress).toContain('Week 1')
    expect(progress).toContain('Completed')
  })
})

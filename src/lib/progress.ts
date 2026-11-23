import type { MilestonePlanResult } from '../types/models'
import type { MilestoneProgress } from '../types/models'

export function adjustPlanForProgress(plan: MilestonePlanResult, progress: MilestoneProgress[]): MilestonePlanResult {
  const statusByWeek = new Map(progress.map(item => [item.week, item.status]))
  const milestones = plan.milestones.map(milestone => {
    const progressStatus = statusByWeek.get(milestone.week)
    if (!progressStatus) return milestone
    return {
      ...milestone,
      status: progressStatus === 'done' ? 'done' as const : progressStatus === 'planned' ? 'planned' as const : 'in-progress' as const,
    }
  })

  const carriedWeeks = milestones
    .filter(milestone => milestone.week < milestones.length && statusByWeek.has(milestone.week) && statusByWeek.get(milestone.week) !== 'done')
    .map(milestone => milestone.week)
  for (const week of carriedWeeks) {
    const next = milestones.find(milestone => milestone.week === week + 1)
    if (next && !next.dependencies.includes(`Week ${week} carry-over`)) {
      next.dependencies = [...next.dependencies, `Week ${week} carry-over`]
    }
  }

  return {
    ...plan,
    milestones,
    summary: plan.summary.includes("Updated to reflect the student's latest milestone progress")
      ? plan.summary
      : `${plan.summary} Updated to reflect the student's latest milestone progress; incomplete work carries into the next milestone.`,
  }
}

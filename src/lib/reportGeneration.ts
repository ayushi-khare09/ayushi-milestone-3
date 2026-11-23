import type { PipelineResults, ProjectIdea } from '../types/models'
import type { MilestoneProgress } from '../types/models'

export type ReportKind = 'synopsis' | 'methodology' | 'progress' | 'final'

const progressLabels = {
  planned: 'Not started',
  'in-progress': 'In progress',
  'half-done': 'Half done',
  done: 'Completed',
} as const

export function makeProjectReport(kind: ReportKind, project: ProjectIdea, results: PipelineResults | null, progress: MilestoneProgress[]): string {
  const updated = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  const progressByWeek = new Map(progress.map(item => [item.week, item.status]))
  const lines = [
    `# ${project.title}`,
    '',
    `**Generated:** ${updated}`,
    `**Project area:** ${project.customDomain || project.domain.replace('_', ' ')}`,
    `**Duration:** ${project.durationWeeks} weeks`,
    '',
    '## Project idea',
    project.description,
    '',
  ]

  if (kind === 'synopsis') {
    lines.push('## Project overview', results?.scopeAndStack.summary ?? 'This synopsis is based on the project idea currently saved in your workspace.', '')
    if (results) lines.push(
      '## Problem statement', results.scopeAndStack.problemStatement, '',
      '## Objectives', ...results.scopeAndStack.projectObjectives.map(item => `- ${item}`), '',
      '## Proposed solution', results.scopeAndStack.proposedSolution, '',
      '## Intended users', results.scopeAndStack.targetUsers, '',
      '## Initial technology choices', ...results.scopeAndStack.techStack.map(item => `- **${item.layer}:** ${item.choice} — ${item.reason}`),
    )
  } else if (kind === 'methodology' && results) {
    lines.push(
      '## Methodological approach',
      'The project will be developed iteratively: define a focused MVP, implement it in milestone-sized increments, and validate each increment against its deliverables and success criteria.',
      '',
      '## Development phases',
      ...results.plan.milestones.flatMap(item => [
        `### Week ${item.week}: ${item.title}`,
        `- **Activities:** ${item.tasks.join('; ')}`,
        `- **Methods and tools:** ${results.scopeAndStack.techStack.map(stack => `${stack.layer}: ${stack.choice}`).join('; ') || 'Use the technologies selected for the MVP.'}`,
        `- **Validation:** ${item.testingCheckpoint ?? 'Review the milestone deliverables against the project success criteria.'}`,
        `- **Deliverable:** ${item.deliverables.join('; ') || 'Working milestone increment'}`,
        `- **Risk response:** ${item.riskMitigation ?? 'Keep the milestone within the MVP and resolve blockers before adding optional work.'}`,
      ]),
      '',
      '## Evaluation criteria',
      ...results.scopeAndStack.successCriteria.map(item => `- ${item}`),
    )
  } else if (kind === 'progress' && results) {
    const completed = results.plan.milestones.filter(item => (progressByWeek.get(item.week) ?? item.status) === 'done').length
    lines.push(
      '## Current progress',
      `${completed} of ${results.plan.milestones.length} milestones marked complete.`,
      '',
      '## Milestones',
      ...results.plan.milestones.flatMap(item => [
        `- **Week ${item.week} · ${item.title}:** ${progressLabels[progressByWeek.get(item.week) ?? item.status]}`,
        `  - ${item.tasks.join('; ')}`,
        `  - Deliverable: ${item.deliverables[0] ?? 'Milestone deliverables'}`,
      ]),
      '',
      '## Next step',
      results.plan.milestones.find(item => (progressByWeek.get(item.week) ?? item.status) !== 'done')?.title ?? 'Review final project deliverables.',
    )
  } else if (kind === 'final' && results) {
    lines.push(
      '## Abstract', results.scopeAndStack.summary, '',
      '## Objectives', ...results.scopeAndStack.projectObjectives.map(item => `- ${item}`), '',
      '## Project scope', '### Included in the MVP', ...(results.scopeAndStack.inScope.length ? results.scopeAndStack.inScope : results.scopeAndStack.mvp).map(item => `- ${item}`), '',
      '### Future expansion', ...results.scopeAndStack.outOfScope.map(item => `- ${item}`), '',
      '## Recommended technology', ...results.scopeAndStack.techStack.map(item => `- **${item.layer}: ${item.choice}.** ${item.reason}`), '',
      '## Execution plan', ...results.plan.milestones.map(item => `- **Week ${item.week}: ${item.title}.** ${item.tasks.join('; ')} Deliverable: ${item.deliverables[0] ?? 'Milestone deliverables'}`), '',
      '## Risks and mitigation', ...results.risk.risks.map(item => `- **${item.title} (${item.severity}):** ${item.mitigation}`), '',
      '## Feasibility', `${results.feasibility.verdict} · ${results.feasibility.score}/100.`, ...results.feasibility.recommendations.map(item => `- ${item}`),
    )
  }

  return lines.join('\n')
}

import type { PipelineResults, ProjectIdea } from '../types/models'

export function buildLocalMentorReply(text: string, project: ProjectIdea, results?: PipelineResults): string {
  const question = text.toLowerCase()
  const nextMilestone = results?.plan.milestones.find(milestone => milestone.status !== 'done')

  if (question.includes('weekly check-in')) {
    const completed = text.match(/completed:\s*([^\n]*)/i)?.[1]?.trim()
    const blockers = text.match(/blockers?:\s*([^\n]*)/i)?.[1]?.trim()
    const next = text.match(/next(?: week)?(?:'s)? focus:\s*([^\n]*)/i)?.[1]?.trim()
    const acknowledgement = completed && completed.toLowerCase() !== 'nothing yet'
      ? `You made progress on ${completed}.`
      : 'It is useful to identify what is still open, even if little was completed this week.'
    const blockerAdvice = blockers && blockers.toLowerCase() !== 'none'
      ? ` For the blocker “${blockers}”, write down the smallest question you need answered and tackle that before adding scope.`
      : ' You have not reported a blocker, so keep the next task small and testable.'
    return `${acknowledgement}${blockerAdvice}${next ? ` Your stated focus is ${next}.` : ''} ${nextMilestone ? `The next planned milestone is “${nextMilestone.title}”; ${nextMilestone.testingCheckpoint ?? nextMilestone.tasks[0]}` : 'What is the one outcome you want to demonstrate before your next check-in?'}`
  }

  if (!results) {
    return `For “${project.title}”, start by turning the idea into one small, demonstrable outcome. Based on your description, identify the first user action and the result they should see. What would count as a working first version?`
  }

  if (/test|testing|validate|quality/.test(question)) {
    const checkpoint = nextMilestone?.testingCheckpoint
    return checkpoint
      ? `For “${project.title}”, use this checkpoint for the next milestone: ${checkpoint} Test one normal case and one edge case, record the expected result before running it, and fix failures before adding features.`
      : `Your planned milestones are complete. Validate the main user flow against the project success criteria, then record any remaining defects and their impact.`
  }

  if (/risk|block|stuck|problem|issue|mitigat/.test(question)) {
    const risk = results.risk.risks[0]
    return risk
      ? `A risk to keep in view is ${risk.title} (${risk.severity}): ${risk.mitigation} Break the blocker into the smallest test or decision that can confirm the next step. What have you tried so far?`
      : `I do not see a specific risk recorded in the blueprint yet. Describe what is blocking you, and reduce it to one decision or test you can complete this week.`
  }

  if (/stack|technology|tech|framework|database/.test(question)) {
    const stack = results.scopeAndStack.techStack.slice(0, 3).map(item => `${item.layer}: ${item.choice} (${item.reason})`)
    return stack.length
      ? `The current blueprint recommends ${stack.join('; ')}. Start with the choice needed for the next milestone rather than setting up every layer at once. ${nextMilestone ? `That milestone is “${nextMilestone.title}”.` : ''}`
      : `Use the smallest technology choice that supports the project's core user flow, and validate it with a short prototype before committing to it.`
  }

  if (/realistic|timeline|time|schedule|week/.test(question)) {
    return `The current feasibility score is ${results.feasibility.score}/100 (${results.feasibility.verdict}) for a ${project.durationWeeks}-week project. ${nextMilestone ? `Focus first on “${nextMilestone.title}” (${nextMilestone.estimatedHours} planned hours).` : 'The planned milestones are marked complete.'} If your available time has changed, update your profile or milestone progress and review the adjusted plan.`
  }

  return `${results.scopeAndStack.summary} The next planned step is ${nextMilestone ? `“${nextMilestone.title}”: ${nextMilestone.tasks[0]}` : 'to review the completed milestones against the success criteria'}. What part would you like to work through first?`
}

/**
 * Single entry point for data access. With VITE_API_BASE_URL set, calls the backend
 * (contract in docs/ARCHITECTURE.md); otherwise runs fully in the browser in demo mode.
 * Pages only ever import `api`, so switching to the real backend needs no UI changes.
 * All data belongs to the signed-in user.
 */
import { assessSkills } from '../lib/skills'
import { load, newId, save } from '../lib/storage'
import type { MentorMessage, MilestoneProgress, MilestoneStatus, NewProjectIdea, PipelineRun, ProjectIdea, ProjectReport, StudentProfile } from '../types/models'
import { completeDemoRun, deleteDemoRuns, getDemoRun, storeDemoRun, triggerDemoRun } from './demoPipeline'
import { buildLocalMentorReply } from '../lib/mentor'
import { adjustPlanForProgress } from '../lib/progress'
import { makeProjectReport, type ReportKind } from '../lib/reportGeneration'
import { ApiError, http, isDemoMode } from './http'
import { getSession } from './session'

export { ApiError, isDemoMode }

export type ProfileInput = Omit<StudentProfile, 'id' | 'userId' | 'assessment' | 'createdAt' | 'updatedAt'>
export type { MilestoneProgress, MilestoneStatus } from '../types/models'
export type MilestoneUpdateResult = { progress: MilestoneProgress; adjustmentRun?: PipelineRun; adjustmentUnavailable?: string }

const userId = () => {
  const id = getSession()?.user.id
  if (!id) throw new ApiError('Please sign in to continue.', 401)
  return id
}
// Local cache keys are per user, so accounts on a shared device never see each other's data.
const profileKey = (uid: string) => `profile:${uid}`
const projectsKey = (uid: string) => `projects:${uid}`
const milestoneKey = (uid: string, projectId: string) => `milestone-progress:${uid}:${projectId}`
const readProjects = (uid: string) => load<ProjectIdea[]>(projectsKey(uid), [])
const cacheProject = (uid: string, project: ProjectIdea) => save(projectsKey(uid), [project, ...readProjects(uid).filter(p => p.id !== project.id)])

export const api = {
  /** Get mentor chat messages for a project */
  async getMentorMessages(projectId: string): Promise<MentorMessage[]> {
    if (isDemoMode) return load<MentorMessage[]>(`mentor:${projectId}`, [])
    return http<MentorMessage[]>(`/projects/${projectId}/mentor/messages`)
  },

  /** Send a mentor message */
  async sendMentorMessage(projectId: string, text: string): Promise<{ studentMessage: MentorMessage; mentorReply: MentorMessage }> {
    if (isDemoMode) {
      const messages = load<MentorMessage[]>(`mentor:${projectId}`, [])
      const studentMessage: MentorMessage = { id: newId('msg'), projectId, role: 'student', text, createdAt: new Date().toISOString() }
      const project = readProjects(userId()).find(item => item.id === projectId)
      if (!project) throw new ApiError('Project not found.', 404)
      const run = project.latestRunId ? await api.getPipelineRun(project.latestRunId) : null
      const mentorReply: MentorMessage = { id: newId('msg'), projectId, role: 'mentor', text: buildLocalMentorReply(text, project, run?.results), createdAt: new Date().toISOString() }
      save(`mentor:${projectId}`, [...messages, studentMessage, mentorReply])
      return { studentMessage, mentorReply }
    }
    return http<{ studentMessage: MentorMessage; mentorReply: MentorMessage }>(`/projects/${projectId}/mentor/messages`, { method: 'POST', body: JSON.stringify({ text }) })
  },

  /** List reports for a project */
  async listReports(projectId: string): Promise<ProjectReport[]> {
    if (isDemoMode) return load<ProjectReport[]>(`reports:${projectId}`, [])
    return http<ProjectReport[]>(`/projects/${projectId}/reports`)
  },

  /** Generate a report for a project */
  async generateReport(projectId: string, kind: ReportKind): Promise<ProjectReport> {
    if (isDemoMode) {
      const reports = load<ProjectReport[]>(`reports:${projectId}`, [])
      const project = readProjects(userId()).find(item => item.id === projectId)
      if (!project) throw new ApiError('Project not found.', 404)
      const run = project.latestRunId ? await api.getPipelineRun(project.latestRunId) : null
      const progress = await api.getMilestoneProgress(projectId)
      if (kind !== 'synopsis' && !run?.results) throw new ApiError('Complete the project analysis before generating this report.', 409)
      const report: ProjectReport = {
        id: newId('rep'),
        projectId,
        kind,
        content: makeProjectReport(kind, project, run?.results ?? null, progress),
        createdAt: new Date().toISOString()
      }
      save(`reports:${projectId}`, [...reports, report])
      return report
    }
    return http<ProjectReport>(`/projects/${projectId}/reports`, { method: 'POST', body: JSON.stringify({ kind }) })
  },

  /** The signed-in student's profile, cached locally so the UI can render instantly. */
  getProfile(): StudentProfile | null {
    const uid = getSession()?.user.id
    return uid ? load<StudentProfile | null>(profileKey(uid), null) : null
  },

  async loadProfile(): Promise<StudentProfile | null> {
    const uid = getSession()?.user.id
    if (!uid) return null
    if (isDemoMode) return api.getProfile()
    try {
      const profile = await http<StudentProfile>('/students/me')
      save(profileKey(uid), profile)
      return profile
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  },

  /** Creates or updates the profile; the skill assessment is (re)computed on every save. */
  async saveProfile(input: ProfileInput): Promise<StudentProfile> {
    const uid = userId()
    const existing = api.getProfile()
    const now = new Date().toISOString()
    let profile: StudentProfile = {
      ...input,
      id: existing?.id ?? newId('stu'),
      userId: uid,
      assessment: assessSkills(input.skills, input.priorProjects, input.weeklyHours),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    if (!isDemoMode) {
      // The client-side assessment is sent along; the backend may store it or replace it with its own.
      const body = JSON.stringify({ ...input, assessment: profile.assessment })
      profile = existing
        ? await http<StudentProfile>(`/students/${existing.id}`, { method: 'PUT', body })
        : await http<StudentProfile>('/students', { method: 'POST', body })
    }
    save(profileKey(uid), profile)
    return profile
  },

  async listProjects(): Promise<ProjectIdea[]> {
    const uid = userId()
    const profile = api.getProfile() ?? await api.loadProfile()
    if (isDemoMode || !profile) return readProjects(uid)
    return http<ProjectIdea[]>(`/students/${profile.id}/projects`)
  },

  async getProject(id: string): Promise<ProjectIdea | null> {
    if (isDemoMode) return readProjects(userId()).find(p => p.id === id) ?? null
    return http<ProjectIdea>(`/projects/${id}`).catch(e => { if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return null; throw e })
  },

  async getMilestoneProgress(projectId: string): Promise<MilestoneProgress[]> {
    const uid = userId()
    if (isDemoMode) return load<MilestoneProgress[]>(milestoneKey(uid, projectId), [])
    return http<MilestoneProgress[]>(`/projects/${encodeURIComponent(projectId)}/milestones`)
  },

  async setMilestoneProgress(projectId: string, week: number, status: MilestoneStatus): Promise<MilestoneUpdateResult> {
    const uid = userId()
    if (!isDemoMode) return http<MilestoneUpdateResult>(`/projects/${encodeURIComponent(projectId)}/milestones/${week}`, { method: 'PUT', body: JSON.stringify({ status }) })
    const current = load<MilestoneProgress[]>(milestoneKey(uid, projectId), [])
    const previous = current.find(item => item.week === week)
    if (previous?.status === status) return { progress: previous }
    const progress = { week, status, updatedAt: new Date().toISOString() }
    const updatedProgress = [...current.filter(item => item.week !== week), progress].sort((a, b) => a.week - b.week)
    save(milestoneKey(uid, projectId), updatedProgress)
    const project = readProjects(uid).find(item => item.id === projectId)
    if (!project?.latestRunId) return { progress, adjustmentUnavailable: 'Complete an initial project analysis before the planner can adjust your plan.' }
    const run = getDemoRun(project.latestRunId)
    if (!run?.results) return { progress, adjustmentUnavailable: 'Complete an initial project analysis before the planner can adjust your plan.' }
    const adjustedRun: PipelineRun = {
      ...run,
      id: newId('run'),
      status: 'completed',
      createdAt: progress.updatedAt!,
      finishedAt: progress.updatedAt,
      steps: run.steps.map(step => ({
        ...step,
        status: 'completed',
        summary: step.agentId === 'planner' ? 'Plan adjusted to reflect the latest milestone progress.' : step.summary,
      })),
      results: { ...run.results, plan: adjustPlanForProgress(run.results.plan, updatedProgress) },
    }
    storeDemoRun(adjustedRun)
    cacheProject(uid, { ...project, latestRunId: adjustedRun.id })
    return { progress, adjustmentRun: adjustedRun }
  },

  /** Submits an idea and starts a local LLM/demo analysis or a configured API pipeline. */
  async submitIdea(idea: NewProjectIdea): Promise<{ project: ProjectIdea; run: PipelineRun }> {
    const uid = userId()
    const profile = api.getProfile()
    if (!profile) throw new ApiError('Please create your profile before submitting an idea.')

    if (!isDemoMode) {
      const project = await http<ProjectIdea>('/projects', { method: 'POST', body: JSON.stringify({ ...idea, studentId: profile.id }) })
      const run = await api.triggerPipeline(project.id)
      const stored = { ...project, latestRunId: run.id }
      cacheProject(uid, stored)
      return { project: stored, run }
    }

    const project: ProjectIdea = { ...idea, id: newId('prj'), studentId: profile.id, createdAt: new Date().toISOString() }
    const run = triggerDemoRun(project)
    const stored = { ...project, latestRunId: run.id }
    cacheProject(uid, stored)
    void completeDemoRun(project, profile, run.id)
    return { project: stored, run }
  },

  /** Deletes a project and its pipeline runs. */
  async deleteProject(id: string): Promise<void> {
    const uid = userId()
    if (!isDemoMode) await http<void>(`/projects/${id}`, { method: 'DELETE' })
    else deleteDemoRuns(id)
    save(projectsKey(uid), readProjects(uid).filter(p => p.id !== id))
  },

  /** Triggers a new agent pipeline run for an existing project. */
  async triggerPipeline(projectId: string): Promise<PipelineRun> {
    if (!isDemoMode) return http<PipelineRun>(`/projects/${projectId}/pipeline-runs`, { method: 'POST' })
    const uid = userId()
    const profile = api.getProfile()
    if (!profile) throw new ApiError('Please create your profile before submitting an idea.')
    const project = readProjects(uid).find(p => p.id === projectId)
    if (!project) throw new ApiError('Project not found.', 404)
    const run = triggerDemoRun(project)
    cacheProject(uid, { ...project, latestRunId: run.id })
    void completeDemoRun(project, profile, run.id)
    return run
  },

  async getPipelineRun(runId: string): Promise<PipelineRun | null> {
    if (isDemoMode) {
      const run = getDemoRun(runId)
      if (run && (run.status === 'queued' || run.status === 'running')) {
        const project = readProjects(userId()).find(item => item.id === run.projectId)
        const profile = api.getProfile()
        if (project && profile) void completeDemoRun(project, profile, run.id)
      }
      return run
    }
    return http<PipelineRun>(`/pipeline-runs/${runId}`).catch(e => { if (e instanceof ApiError && e.status === 404) return null; throw e })
  },

  async cancelPipeline(runId: string): Promise<void> {
    if (isDemoMode) throw new ApiError('Cancellation is available when the server backend is enabled.')
    await http<void>(`/pipeline-runs/${runId}/cancel`, { method: 'POST' })
  },
}

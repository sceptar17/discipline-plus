import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { AiDiagnostic, User } from './lib/cloudflare'
import './App.css'
import './theme.css'
import { hasSupabaseEnv, loadAiDiagnostics, loadCoachDay, loadHealthSyncStatus, loadProgramCoach, checkReachability, loadScheduleRevision, savePlanSnapshot, saveScheduleChanges, startSignIn, saveScheduleSnapshot, supabase, supabaseUrl } from './lib/cloudflare'
import { diffScheduleRows, fingerprintScheduleRows, habitStats, isDueOn, pinItemsToDates, scheduleChangeCount, swapScheduleDates } from './lib/schedule'
import type { ScheduleRowFingerprint, ScheduleRowSet } from './lib/schedule'
import type { Sex } from './lib/standards'
import { d, key, add, dateOrdinal, monthKey, fmtDay, fmtShort, fmtMonth, fmtDateRange, fmtSecs, parseSecs, countUnitLabel, totalCount, loggedWeight, loggedReps, weightLabel, durationShort, workoutSummary } from './lib/format'
import { numberInputValue, parseNumberInput } from './lib/format'
import { Sheet } from './components/Sheet'
import { WeekStrip, type WeekDayStatus } from './components/WeekStrip'
import { PowerBlockBadge } from './components/PowerBlockBadge'
import { ProgressScreen } from './screens/ProgressScreen'
import { TargetEditor } from './components/TargetEditor'
import { TrashIcon } from './components/icons'
import type { TK, TT, RM, PM, EffortRating, DaySection, Target, Result, Exercise, Item, Day, PlanDay, Plan, RunStatus, Run, Log, LegacyHist, LegacyItem, LegacyState, State, ExerciseForm, PlanForm, PlanScheduleMode, PlanTargetMode, PlanCyclePreview, PlanSchedulePreview, RemovedItem, UndoActions, Toast, ScheduleSaveStatus, ItemDraft, DailyHealthDraft, MobilePairing, MobileSyncStatus, ExerciseRecommendation, DailyReview, CoachMessage, ProgramCoachMessage, WorkbookPreview, ImportedAnalysisItem, ImportedAnalysisDay, ImportedPlanAnalysis, ExerciseEditorMode, ScheduleTouchDrag, ScheduleMoveTarget, ConfirmState } from './types'

type CoachProfile = { birthYear: number | null; sex: Sex | null; heightInches: number | null; powerblockColors: boolean; trainingSince: string | null }
type ProfileDraft = { birthYear: string; sex: '' | Sex; heightFeet: string; heightInches: string; powerblockColors: boolean; trainingSince: string }
const EMPTY_COACH_PROFILE: CoachProfile = { birthYear: null, sex: null, heightInches: null, powerblockColors: true, trainingSince: null }
const profileDraftFrom = (profile: CoachProfile): ProfileDraft => ({
  birthYear: profile.birthYear ? String(profile.birthYear) : '',
  sex: profile.sex ?? '',
  heightFeet: profile.heightInches ? String(Math.floor(profile.heightInches / 12)) : '',
  heightInches: profile.heightInches ? String(Math.round(profile.heightInches % 12)) : '',
  powerblockColors: profile.powerblockColors,
  trainingSince: profile.trainingSince ?? '',
})

const KEY = 'fitness-tracker-v1'
const PENDING_CHANGES_KEY = 'discipline-plus-pending-changes'
const HEALTH_SYNC_DATE_KEY = 'discipline-plus-health-sync-date'
const APP_TABS = ['schedule', 'progress', 'plans', 'calendar', 'exercises', 'coach', 'settings'] as const
const PLAN_TABS = ['plans', 'calendar', 'exercises'] as const
type AppTab = typeof APP_TABS[number]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const EXERCISE_CATEGORY_OPTIONS = ['Bodyweight', 'Dumbbell']
const HABIT_CATEGORY_OPTIONS = ['Spiritual', 'Mind', 'Home', 'Health']
const TRACKABLE_KIND_LABEL: Record<TK, string> = { exercise: 'Exercise', habit: 'Habit' }
const TT_LABEL: Record<TT, string> = { count: 'Count', sets: 'Sets x reps', duration: 'Duration', distance: 'Distance', 'for-time': 'For time', weighted: 'Weighted sets' }
const RM_LABEL: Record<RM, string> = { 'last-result': 'Last result', 'personal-best': 'Personal best' }
const PM_LABEL: Record<PM, string> = { count: 'Count', time: 'Time', weight: 'Weight' }
const id = (p: string) => `${p}-${crypto.randomUUID()}`
const blank = (t: TT): Target => t === 'count' ? { count: 25, countUnit: 'reps' } : t === 'sets' ? { sets: 4, reps: 10 } : t === 'duration' ? { seconds: 60 } : t === 'distance' ? { distance: 2, unit: 'mi' } : t === 'for-time' ? { count: 100 } : { sets: 4, reps: 8, weight: 30 }
const clone = (t: Target) => ({ ...t })
const sum = (t: TT, x: Target) => t === 'count' ? `${x.count ?? 0} ${countUnitLabel(x)}` : t === 'sets' ? `${x.sets ?? 0} x ${x.reps ?? 0}` : t === 'duration' ? durationShort(x.seconds) : t === 'distance' ? `${x.distance ?? 0} ${x.unit ?? 'mi'}` : t === 'for-time' ? `${x.count ?? 0} count for time` : `${x.sets ?? 0} x ${x.reps ?? 0} @ ${x.weight ?? 0} lb`
const metric = (progressMetric: PM, entry: Pick<Log, 'target' | 'result'>) => progressMetric === 'count' ? entry.result.count ?? totalCount(entry.target) : progressMetric === 'time' ? entry.result.seconds ?? entry.target.seconds : loggedWeight(entry)
// True when `candidate` beats `current` for the progress metric. Weight ties go to the entry with more total reps.
const beats = (progressMetric: PM, candidate: Pick<Log, 'target' | 'result'>, current: Pick<Log, 'target' | 'result'>) => {
  const a = metric(progressMetric, current), b = metric(progressMetric, candidate)
  if (b === undefined) return false
  if (a === undefined) return true
  if (progressMetric === 'time') return b < a
  if (b !== a) return b > a
  return progressMetric === 'weight' && loggedReps(candidate) > loggedReps(current)
}
const resultSetSummary = (result: Result) => {
  if (!result.sets?.length) return ''
  const weights = Array.from(new Set(result.sets.map((set) => set.weight).filter((weight): weight is number => weight !== undefined)))
  const weight = weights.length === 1 ? `${weights[0]} lb · ` : ''
  return `${weight}${result.sets.map((set) => set.reps).join(' / ')}`
}
const kindOrder: Record<TK, number> = { exercise: 0, habit: 1 }
const allowedTypesForKind = (kind: TK): TT[] => kind === 'habit' ? ['count', 'duration'] : (Object.keys(TT_LABEL) as TT[])
const defaultCategoryForKind = (kind: TK) => kind === 'habit' ? HABIT_CATEGORY_OPTIONS[0] : EXERCISE_CATEGORY_OPTIONS[0]
const sanitizeExerciseKind = (kind?: TK): TK => kind === 'habit' ? 'habit' : 'exercise'
const sanitizeExerciseDefaultType = (kind: TK, defaultType?: TT): TT => {
  const allowed = allowedTypesForKind(kind)
  return defaultType && allowed.includes(defaultType) ? defaultType : allowed[0]
}
const sanitizeAllowedTypes = (kind: TK, allowed: TT[] | undefined, defaultType: TT): TT[] => {
  const supported = new Set(allowedTypesForKind(kind))
  const next = (allowed ?? []).filter((type): type is TT => supported.has(type))
  return Array.from(new Set(next.length ? [...next, defaultType] : [defaultType]))
}
const compareExercises = (a: Exercise, b: Exercise) => kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name)
const compareStrings = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
const normalizeCatalogName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
const importPlanName = (date = new Date()) => {
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  return `New Plan - ${yyyy}${mm}${dd}`
}
const validTargetTypes = new Set<TT>(['count', 'sets', 'duration', 'distance', 'for-time', 'weighted'])
const validProgressMetrics = new Set<PM>(['count', 'time', 'weight'])
const validRefs = new Set<RM>(['last-result', 'personal-best'])
const COACHING_NOTE_SEEDS = [
  { key: 'midline-doming', category: 'safety', title: 'Avoid pronounced abdominal doming', body: 'Straight-leg raises produced pronounced abdominal midline doming and are removed for now. Avoid movements that reproduce pronounced doming and prioritize pressure control.', priority: 3 },
  { key: 'dead-bug-substitution', category: 'modification', title: 'Use dead bugs for core work', body: 'Use dead bugs, generally 3 x 8 per side, while maintaining abdominal control.', priority: 2 },
  { key: 'right-elbow', category: 'symptom', title: 'Monitor right elbow', body: 'Overhead triceps extensions have sometimes concerned the right elbow. Skull crushers have been tolerated; progress triceps work conservatively and monitor symptoms.', priority: 3 },
  { key: 'kickstand-rdl', category: 'modification', title: 'Use kickstand RDL', body: 'A kickstand or staggered-stance RDL currently works better than a true single-leg RDL because balance is limiting.', priority: 1 },
  { key: 'lateral-raise-load', category: 'progression', title: 'Keep lateral raises strict', body: 'Lateral raises are currently better around 5 lb because strict 10-lb repetitions deteriorate.', priority: 2 },
  { key: 'clean-reps', category: 'principle', title: 'Prioritize clean repetitions', body: 'Clean repetitions matter more than forcing the prescribed repetition count.', priority: 2 },
  { key: 'double-progression', category: 'principle', title: 'Add reps before load', body: 'For most lifting, add clean repetitions within the range before increasing PowerBlock weight.', priority: 2 },
  { key: 'no-calorie-eatback', category: 'nutrition', title: 'Do not automatically eat back exercise calories', body: 'Exercise-calorie estimates should not automatically increase the daily calorie allowance.', priority: 2 },
] as const
const safeImportedType = (kind: TK, type: TT): TT => sanitizeExerciseDefaultType(kind, type)
const allowedTypesFromImportedItems = (kind: TK, itemTypes: TT[], defaultType: TT) => sanitizeAllowedTypes(kind, itemTypes.map((type) => safeImportedType(kind, type)), defaultType)
const emptyDailyHealthDraft = (): DailyHealthDraft => ({ calories: '', protein: '', carbs: '', fat: '', steps: '', weight: '' })
const wholeNumberText = (value: number | null | undefined) => value === null || value === undefined ? '' : String(Math.round(value))
const parseOptionalNumber = (value: string) => {
  const parsed = parseNumberInput(value)
  return parsed !== undefined && Number.isFinite(parsed) ? parsed : null
}
const parseOptionalWholeNumber = (value: string) => {
  const parsed = parseOptionalNumber(value)
  return parsed === null ? null : Math.round(parsed)
}
const dailyReviewFromPayload = (payload: unknown): DailyReview | null => {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Record<string, unknown>
  const structured = row.structured_review && typeof row.structured_review === 'object'
    ? row.structured_review as Record<string, unknown>
    : row
  const recommendations = Array.isArray(structured.exercise_recommendations)
    ? structured.exercise_recommendations.filter((item): item is ExerciseRecommendation => Boolean(item) && typeof item === 'object' && typeof (item as ExerciseRecommendation).exercise === 'string')
    : []
  return {
    id: String(row.id ?? ''),
    date: String(row.date ?? ''),
    model: String(row.model ?? ''),
    headline: String(structured.headline ?? row.headline ?? 'Daily review'),
    overall: String(structured.overall ?? ''),
    training: String(structured.training ?? ''),
    nutrition: String(structured.nutrition ?? ''),
    trends: String(structured.trends ?? ''),
    tomorrow: String(structured.tomorrow ?? ''),
    action_items: Array.isArray(structured.action_items) ? structured.action_items.map(String) : [],
    exercise_recommendations: recommendations,
  }
}
const mobileSyncStatusFromPayload = (payload: unknown): MobileSyncStatus | null => {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null
  return {
    id: row.id,
    name: row.name,
    app_version: typeof row.app_version === 'string' ? row.app_version : null,
    last_used_at: typeof row.last_used_at === 'string' ? row.last_used_at : null,
    last_sync_attempt_at: typeof row.last_sync_attempt_at === 'string' ? row.last_sync_attempt_at : null,
    last_sync_success_at: typeof row.last_sync_success_at === 'string' ? row.last_sync_success_at : null,
    last_sync_status: typeof row.last_sync_status === 'string' ? row.last_sync_status : null,
    last_sync_error: typeof row.last_sync_error === 'string' ? row.last_sync_error : null,
    background_permission: row.background_permission === true,
    last_sync_trigger: typeof row.last_sync_trigger === 'string' ? row.last_sync_trigger : null,
  }
}
const syncTimeLabel = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never'
const parseSetReps = (value: string) => value
  .split(/[\s,/x×-]+/)
  .map((part) => part.trim())
  .filter(Boolean)
  .map(Number)
const targetForType = (type: TT, target: Target): Target => {
  if (type === 'count') return { count: Math.max(1, Number(target.count ?? 1)), countUnit: target.countUnit === 'steps' ? 'steps' : 'reps' }
  if (type === 'sets') return { sets: Math.max(1, Number(target.sets ?? 3)), reps: Math.max(1, Number(target.reps ?? 10)) }
  if (type === 'duration') return { seconds: Math.max(10, Number(target.seconds ?? 60)) }
  if (type === 'distance') return { distance: Math.max(0.1, Number(target.distance ?? 1)), unit: target.unit === 'km' ? 'km' : 'mi' as 'mi' | 'km' }
  if (type === 'for-time') return { count: Math.max(1, Number(target.count ?? 10)) }
  return { sets: Math.max(1, Number(target.sets ?? 3)), reps: Math.max(1, Number(target.reps ?? 8)), weight: Math.max(0, Number(target.weight ?? 10)) }
}
const workbookPreviewFromFile = async (file: File): Promise<WorkbookPreview> => {
  if (file.size > 5 * 1024 * 1024) throw new Error('Spreadsheet files must be 5 MB or smaller.')
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheets = workbook.SheetNames.slice(0, 8).map((name) => {
    const sheet = workbook.Sheets[name]
    const rawRows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, { header: 1, raw: false, defval: '' })
    const rows = rawRows
      .slice(0, 180)
      .map((row) => row.slice(0, 20).map((value) => `${value ?? ''}`.trim().slice(0, 500)))
      .filter((row) => row.some((cell) => cell))
    return { name, rows }
  }).filter((sheet) => sheet.rows.length > 0)
  return { fileName: file.name, sheets }
}
const parsedAnalysisFromResponse = (payload: unknown): ImportedPlanAnalysis | null => {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<ImportedPlanAnalysis>
  if (!Array.isArray(candidate.items) || !Array.isArray(candidate.days)) return null
  const items: ImportedAnalysisItem[] = []
  candidate.items.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const next = item as Partial<ImportedAnalysisItem>
    if (!next.name?.trim()) return
    const kind = sanitizeExerciseKind(next.kind)
    const defaultType = safeImportedType(kind, validTargetTypes.has(next.defaultType as TT) ? next.defaultType as TT : 'count')
    const progressMetric = validProgressMetrics.has(next.progressMetric as PM)
      ? next.progressMetric as PM
      : (defaultType === 'duration' || defaultType === 'distance' || defaultType === 'for-time' ? 'time' : defaultType === 'weighted' ? 'weight' : 'count')
    items.push({
      name: next.name.trim(),
      kind,
      category: next.category?.trim() || defaultCategoryForKind(kind),
      notes: next.notes?.trim() ?? '',
      defaultType,
      progressMetric: kind === 'habit' && progressMetric === 'weight' ? (defaultType === 'duration' ? 'time' : 'count') : progressMetric,
      usedOnDays: Array.isArray(next.usedOnDays) ? next.usedOnDays.map((entry) => `${entry}`).filter(Boolean) : [],
    })
  })
  const days: ImportedAnalysisDay[] = []
  candidate.days.forEach((day) => {
    if (!day || typeof day !== 'object') return
    const nextDay = day as Partial<ImportedAnalysisDay>
    if (!nextDay.label?.trim() || !Array.isArray(nextDay.items)) return
    const itemsForDay: ImportedAnalysisDay['items'] = []
    nextDay.items.forEach((item) => {
      if (!item || typeof item !== 'object') return
      const nextItem = item as Partial<ImportedAnalysisDay['items'][number]>
      if (!nextItem.name?.trim()) return
      const type = validTargetTypes.has(nextItem.type as TT) ? nextItem.type as TT : 'count'
      itemsForDay.push({
        name: nextItem.name.trim(),
        type,
        target: targetForType(type, typeof nextItem.target === 'object' && nextItem.target ? nextItem.target as Target : {}),
        ref: validRefs.has(nextItem.ref as RM) ? nextItem.ref as RM : 'last-result',
        note: nextItem.note?.trim() ?? '',
      })
    })
    if (!itemsForDay.length) return
    days.push({
      label: nextDay.label.trim(),
      notes: nextDay.notes?.trim() ?? '',
      items: itemsForDay,
    })
  })
  if (items.length === 0 || days.length === 0) return null
  return {
    summary: candidate.summary?.trim() || 'Spreadsheet analyzed and converted into a plan preview.',
    warnings: Array.isArray(candidate.warnings) ? candidate.warnings.map((entry) => `${entry}`.trim()).filter(Boolean) : [],
    items,
    days,
  }
}
const emptyExerciseForm = (kind: TK = 'exercise'): ExerciseForm => ({ kind, name: '', category: defaultCategoryForKind(kind), equipment: '', notes: '', defaultType: 'count', allowed: ['count'], target: blank('count'), refs: ['last-result', 'personal-best'], progressMetric: 'count', repeatDays: [] })
const formFromExercise = (exercise: Exercise): ExerciseForm => ({ kind: exercise.kind, name: exercise.name, category: exercise.category, equipment: exercise.equipment, notes: exercise.notes, defaultType: exercise.defaultType, allowed: [...exercise.allowed], target: clone(exercise.target), refs: [...exercise.refs], progressMetric: exercise.progressMetric, repeatDays: [...(exercise.repeatDays ?? [])] })
const emptyPlanForm = (): PlanForm => ({ name: '', focus: '' })
const formFromPlan = (plan: Plan): PlanForm => ({ name: plan.name, focus: plan.focus })
const progressMetricHint = (form: ExerciseForm) => {
  if (form.kind === 'habit') {
    return form.progressMetric === 'time'
      ? 'Timed habits compare minutes logged over time.'
      : 'Count-based habits compare completions or volume over time.'
  }
  if (form.progressMetric === 'time') {
    if (form.defaultType === 'distance') return 'Distance is the target, and logged time is what gets tracked for progress.'
    if (form.defaultType === 'for-time') return 'Fixed reps are the target, and finish time is what gets tracked for progress.'
    return 'Timed exercises should usually use Duration as the default target type.'
  }
  if (form.progressMetric === 'weight') {
    return 'Weight-based exercises can still use sets x reps, but the weight used becomes the progress value.'
  }
  return 'Count-based exercises compare reps or total volume over time.'
}

function seed(): State {
  const today = key(new Date())
  const ex: Exercise[] = [
    { id: id('ex'), kind: 'exercise', name: 'Push-Ups', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Can be straight reps, sets, or for time.', defaultType: 'sets', allowed: ['count', 'sets', 'for-time'], target: { sets: 5, reps: 20 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'exercise', name: 'Wall Sit', category: 'Bodyweight', equipment: 'Wall', notes: 'Great timed hold.', defaultType: 'duration', allowed: ['duration'], target: { seconds: 90 }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
    { id: id('ex'), kind: 'exercise', name: 'Dumbbell Curl', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Track weight progression.', defaultType: 'weighted', allowed: ['weighted', 'sets'], target: { sets: 4, reps: 8, weight: 32 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), kind: 'exercise', name: 'Run', category: 'Bodyweight', equipment: 'Shoes', notes: 'Distance-focused by default.', defaultType: 'distance', allowed: ['distance', 'duration'], target: { distance: 3, unit: 'mi' }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
    { id: id('ex'), kind: 'habit', name: 'Bible Reading', category: 'Spiritual', equipment: '', notes: 'Daily reading can be tracked by time or completed sections.', defaultType: 'duration', allowed: ['count', 'duration'], target: { seconds: 900 }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
    { id: id('ex'), kind: 'habit', name: 'Prayer', category: 'Spiritual', equipment: '', notes: 'Simple daily prayer habit.', defaultType: 'duration', allowed: ['duration'], target: { seconds: 600 }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
  ]
  const planId = id('plan'), runId = id('run')
  return {
    exercises: ex,
    schedule: [
      { date: today, notes: 'Today stays front and center.', rest: false, skipped: false, runId, dayNo: 1, items: [
        { id: id('it'), exerciseId: ex[0].id, type: 'sets', target: { sets: 5, reps: 20 }, ref: 'personal-best', done: false, result: {} },
        { id: id('it'), exerciseId: ex[2].id, type: 'weighted', target: { sets: 4, reps: 8, weight: 32 }, ref: 'last-result', done: false, result: {} },
      ]},
      { date: add(today, 1), notes: 'Conditioning day.', rest: false, skipped: false, runId, dayNo: 2, items: [
        { id: id('it'), exerciseId: ex[3].id, type: 'distance', target: { distance: 3, unit: 'mi' }, ref: 'last-result', done: false, result: {} },
        { id: id('it'), exerciseId: ex[1].id, type: 'duration', target: { seconds: 90 }, ref: 'personal-best', done: false, result: {} },
      ]},
      { date: add(today, 2), notes: 'Recovery day.', rest: true, skipped: false, runId, dayNo: 3, items: [] },
    ],
    plans: [{ id: planId, name: '30-Day Strength Base', focus: 'Simple repeatable structure with recovery built in.', days: [
      { id: id('pd'), label: 'Day 1', rest: false, items: [{ id: id('pi'), exerciseId: ex[0].id, type: 'sets', target: { sets: 5, reps: 20 }, ref: 'personal-best' }, { id: id('pi'), exerciseId: ex[2].id, type: 'weighted', target: { sets: 4, reps: 8, weight: 32 }, ref: 'last-result' }] },
      { id: id('pd'), label: 'Day 2', rest: false, items: [{ id: id('pi'), exerciseId: ex[3].id, type: 'distance', target: { distance: 3, unit: 'mi' }, ref: 'last-result' }, { id: id('pi'), exerciseId: ex[1].id, type: 'duration', target: { seconds: 90 }, ref: 'personal-best' }] },
      { id: id('pd'), label: 'Day 3', rest: true, items: [] },
    ] }],
    runs: [{ id: runId, planId, startDate: today, name: 'Strength Base active run', status: 'active' }],
    logs: [
      { id: id('log'), exerciseId: ex[2].id, date: add(today, -3), type: 'weighted', target: { sets: 4, reps: 8, weight: 30 }, result: { weight: 30 }, done: true },
      { id: id('log'), exerciseId: ex[1].id, date: add(today, -5), type: 'duration', target: { seconds: 75 }, result: { seconds: 75, timeText: fmtSecs(75) }, done: true },
      { id: id('log'), exerciseId: ex[0].id, date: add(today, -7), type: 'sets', target: { sets: 5, reps: 18 }, result: { count: 90 }, done: true },
    ],
  }
}

function normalizeItem(item: LegacyItem): Item {
  if (item.result) {
    return { id: item.id, exerciseId: item.exerciseId, type: item.type, target: clone(item.target), ref: item.ref, done: item.done, result: { ...item.result } }
  }
  return {
    id: item.id,
    exerciseId: item.exerciseId,
    type: item.type,
    target: clone(item.target),
    ref: item.ref,
    done: item.done,
    result: {
      seconds: item.actualSeconds,
      timeText: item.actualTimeText,
      weight: item.actualWeight,
      count: item.actualCount,
      note: item.note,
    },
  }
}

function logIdForItem(itemId: string) {
  return `log-${itemId}`
}

function scheduleDayId(date: string) {
  return `day-${date}`
}

function logFromItem(date: string, item: Item): Log {
  return {
    id: logIdForItem(item.id),
    sourceItemId: item.id,
    exerciseId: item.exerciseId,
    date,
    type: item.type,
    target: clone(item.target),
    result: { ...item.result },
    done: true,
  }
}

function logFromLegacyHistory(entry: LegacyHist): Log {
  return {
    id: entry.id.startsWith('log-') ? entry.id : `legacy-${entry.id}`,
    sourceItemId: entry.id.startsWith('hist-') ? entry.id.slice(5) : undefined,
    exerciseId: entry.exerciseId,
    date: entry.date,
    type: entry.type,
    target: clone(entry.target),
    result: {
      seconds: entry.actualSeconds,
      timeText: entry.actualSeconds !== undefined ? fmtSecs(entry.actualSeconds) : undefined,
      weight: entry.actualWeight,
      count: entry.actualCount,
    },
    done: true,
  }
}

function syncLog(logs: Log[], date: string, item: Item) {
  const nextLogs = logs.filter((entry) => entry.id !== logIdForItem(item.id))
  return item.done ? [...nextLogs, logFromItem(date, item)] : nextLogs
}

function ensureAmpedData(state: LegacyState): State {
  const normalizedSchedule = (state.schedule ?? []).map((day) => ({ ...day, items: (day.items ?? []).map(normalizeItem) }))
  const legacyRunIds = new Set(
    (state.runs ?? [])
      .filter((run) => run.name === 'Strength Base active run')
      .map((run) => run.id),
  )
  const cleanedLegacyLogs = (state.logs ?? []).filter((entry) => !entry.id.startsWith('h-'))
  const migratedHistoryLogs = (state.history ?? [])
    .filter((entry) => !entry.id.startsWith('h-') && !entry.id.startsWith('hist-'))
    .map(logFromLegacyHistory)
  const cleanedState: State = {
    exercises: state.exercises ?? [],
    plans: (state.plans ?? []).filter((plan) => plan.name !== '30-Day Strength Base'),
    runs: (state.runs ?? [])
      .filter((run) => !legacyRunIds.has(run.id))
      .map((run) => ({
        ...run,
        status: run.status === 'completed' ? 'completed' : 'active',
        completedAt: typeof run.completedAt === 'string' ? run.completedAt : undefined,
      })),
    schedule: normalizedSchedule.filter((day) => !day.runId || !legacyRunIds.has(day.runId)),
    logs: [...cleanedLegacyLogs, ...migratedHistoryLogs],
  }

  const withMetrics: Exercise[] = cleanedState.exercises.map((exercise) => {
    const kind = sanitizeExerciseKind(exercise.kind)
    const defaultType = sanitizeExerciseDefaultType(kind, exercise.defaultType)
    const refs = (exercise.refs ?? []).filter((ref): ref is RM => ref === 'last-result' || ref === 'personal-best')
    const progressMetric = exercise.progressMetric ?? (defaultType === 'distance' || defaultType === 'duration' || defaultType === 'for-time' ? 'time' : defaultType === 'weighted' ? 'weight' : exercise.name.toLowerCase().includes('dumbbell') ? 'weight' : 'count')
    return {
      ...exercise,
      kind,
      category: exercise.category || defaultCategoryForKind(kind),
      defaultType,
      allowed: sanitizeAllowedTypes(kind, exercise.allowed, defaultType),
      refs: refs.length ? refs : ['last-result', 'personal-best'],
      progressMetric: kind === 'habit' && progressMetric === 'weight' ? (defaultType === 'duration' ? 'time' : 'count') : progressMetric,
    }
  })
  const exerciseCatalog: Exercise[] = [
    { id: id('ex'), kind: 'exercise', name: 'Push-Ups', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Straight sets, endurance blocks, and for-time work.', defaultType: 'sets', allowed: ['count', 'sets', 'for-time'], target: { sets: 5, reps: 20 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'exercise', name: 'Bent-Over Reverse Fly', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Rear delt dumbbell movement.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 3, reps: 12 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), kind: 'exercise', name: 'Bird Dog', category: 'Bodyweight', equipment: 'Floor', notes: 'Core and stability movement.', defaultType: 'sets', allowed: ['sets', 'count'], target: { sets: 3, reps: 10 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'exercise', name: 'Burpees', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Full-body conditioning movement.', defaultType: 'count', allowed: ['count', 'for-time'], target: { count: 20 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'exercise', name: 'Calf Raises', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Can be bodyweight or weighted.', defaultType: 'sets', allowed: ['sets', 'count'], target: { sets: 3, reps: 20 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'exercise', name: 'Chest-Supported Row', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Back movement with chest support.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 3, reps: 10 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), kind: 'exercise', name: 'Crunches', category: 'Bodyweight', equipment: 'Floor', notes: 'Abdominal isolation movement.', defaultType: 'count', allowed: ['count', 'sets'], target: { count: 30 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'exercise', name: 'Dead Bug', category: 'Bodyweight', equipment: 'Floor', notes: 'Core control movement.', defaultType: 'sets', allowed: ['sets', 'count'], target: { sets: 3, reps: 12 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'exercise', name: 'Dumbbell Floor Press', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Horizontal pressing movement.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 4, reps: 8 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), kind: 'exercise', name: 'Dumbbell Romanian Deadlift', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Hip hinge lower-body movement.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 4, reps: 10 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), kind: 'exercise', name: 'Dumbbell Row', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Single-arm row work.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 3, reps: 10 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), kind: 'exercise', name: 'Plank', category: 'Bodyweight', equipment: 'Floor', notes: 'Timed hold.', defaultType: 'duration', allowed: ['duration'], target: { seconds: 120 }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
    { id: id('ex'), kind: 'exercise', name: 'Glute Bridge', category: 'Bodyweight', equipment: 'Floor', notes: 'Posterior chain bodyweight movement.', defaultType: 'sets', allowed: ['sets', 'count'], target: { sets: 3, reps: 15 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'exercise', name: 'Run', category: 'Bodyweight', equipment: 'Shoes', notes: 'Distance or timed running.', defaultType: 'distance', allowed: ['distance', 'duration'], target: { distance: 2, unit: 'mi' }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
    { id: id('ex'), kind: 'exercise', name: 'Goblet Squat', category: 'Dumbbell', equipment: 'Dumbbell', notes: 'Lower-body strength squat variation.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 4, reps: 10 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), kind: 'exercise', name: 'Hammer Curl', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Neutral-grip dumbbell curl.', defaultType: 'weighted', allowed: ['weighted', 'sets'], target: { sets: 3, reps: 10, weight: 25 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), kind: 'exercise', name: 'Jumping Jacks', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Simple conditioning movement.', defaultType: 'count', allowed: ['count', 'duration'], target: { count: 50 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'exercise', name: 'Lateral Raise', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Shoulder accessory movement.', defaultType: 'weighted', allowed: ['weighted', 'sets'], target: { sets: 3, reps: 12, weight: 15 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), kind: 'exercise', name: 'Mountain Climbers', category: 'Bodyweight', equipment: 'Floor', notes: 'Core and conditioning movement.', defaultType: 'duration', allowed: ['duration', 'count'], target: { seconds: 60 }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
    { id: id('ex'), kind: 'exercise', name: 'Dumbbell Lunges', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Weighted lunges.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 3, reps: 20 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), kind: 'exercise', name: 'Pull-Ups', category: 'Bodyweight', equipment: 'Pull-up Bar', notes: 'Vertical pulling movement.', defaultType: 'count', allowed: ['count', 'sets'], target: { count: 10 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'exercise', name: 'Squats', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Bodyweight squat volume or for-time work.', defaultType: 'count', allowed: ['count', 'for-time'], target: { count: 100 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'exercise', name: 'Sit-Ups', category: 'Bodyweight', equipment: 'Floor', notes: 'Basic core movement.', defaultType: 'count', allowed: ['count', 'sets'], target: { count: 25 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'exercise', name: 'Step-Ups', category: 'Bodyweight', equipment: 'Bench or Step', notes: 'Lower-body step movement.', defaultType: 'sets', allowed: ['sets', 'count'], target: { sets: 3, reps: 12 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'exercise', name: 'Wall Sit', category: 'Bodyweight', equipment: 'Wall', notes: 'Timed wall sit hold.', defaultType: 'duration', allowed: ['duration'], target: { seconds: 60 }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
    { id: id('ex'), kind: 'exercise', name: 'Dumbbell Shoulder Press', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Vertical pressing movement.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 3, reps: 10 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), kind: 'exercise', name: 'Walking Lunges', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Traveling lunge variation.', defaultType: 'count', allowed: ['count', 'sets'], target: { count: 40 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'exercise', name: 'Lunges', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Bodyweight lunges.', defaultType: 'count', allowed: ['count', 'sets'], target: { count: 40 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'habit', name: 'Bible Reading', category: 'Spiritual', equipment: '', notes: 'Track Bible reading by time or completed sections.', defaultType: 'duration', allowed: ['count', 'duration'], target: { seconds: 900 }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
    { id: id('ex'), kind: 'habit', name: 'Prayer', category: 'Spiritual', equipment: '', notes: 'A simple daily prayer habit.', defaultType: 'duration', allowed: ['duration'], target: { seconds: 600 }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
    { id: id('ex'), kind: 'habit', name: 'Journal', category: 'Mind', equipment: '', notes: 'Track journaling by entries or minutes.', defaultType: 'count', allowed: ['count', 'duration'], target: { count: 1 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), kind: 'habit', name: 'Tidy Up', category: 'Home', equipment: '', notes: 'A quick cleanup block for the day.', defaultType: 'duration', allowed: ['duration'], target: { seconds: 900 }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
  ]

  const existingByName = new Map(withMetrics.map((exercise) => [`${exercise.kind}:${exercise.name}`, exercise]))
  const exercises = [...withMetrics]

  for (const exercise of exerciseCatalog) {
    const exerciseKey = `${exercise.kind}:${exercise.name}`
    if (!existingByName.has(exerciseKey)) {
      exercises.push(exercise)
      existingByName.set(exerciseKey, exercise)
    }
  }

  const scheduleLogs = cleanedState.schedule.flatMap((day) => day.items.filter((item) => item.done).map((item) => logFromItem(day.date, item)))
  const logsById = new Map<string, Log>()
  for (const entry of [...cleanedState.logs, ...scheduleLogs]) {
    logsById.set(entry.id, entry)
  }

  return { ...cleanedState, exercises, logs: [...logsById.values()] }
}

function referenceTarget(history: Log[], exercise: Exercise, mode: RM, type: TT, fallback: Target) {
  const rows = history
    .filter((h) => h.exerciseId === exercise.id && h.done)
    .sort((a, b) => b.date.localeCompare(a.date))

  if (!rows.length) {
    return clone(fallback)
  }

  const progressMetric = effectiveProgressMetric(exercise, type)
  const source = mode === 'last-result'
    ? rows[0]
    : rows.reduce((acc, row) => beats(progressMetric, row, acc) ? row : acc, rows[0])
  const next = clone(source.target)

  if (progressMetric === 'time' && source.result.seconds !== undefined) {
    next.seconds = source.result.seconds
  }
  const sourceWeight = loggedWeight(source)
  if (progressMetric === 'weight' && sourceWeight !== undefined) {
    next.weight = sourceWeight
  }
  if (progressMetric === 'count' && source.result.count !== undefined) {
    next.count = source.result.count
  }

  return next
}

function continuedTargetFromLatest(history: Log[], exercise: Exercise, type: TT, fallback: Target, beforeDate: string) {
  const source = history
    .filter((entry) => entry.exerciseId === exercise.id && entry.done && entry.date < beforeDate)
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  if (!source) return clone(fallback)

  const next = clone(fallback)
  if (type === 'sets' || type === 'weighted') {
    // Keep the latest session's sets × reps target (not the weakest set) at the latest weight used.
    const completedSets = source.result.sets?.filter((set) => Number.isInteger(set.reps) && set.reps > 0) ?? []
    next.sets = source.target.sets ?? (completedSets.length || next.sets)
    next.reps = source.target.reps ?? (completedSets.length ? Math.max(...completedSets.map((set) => set.reps)) : next.reps)
    const latestWeight = source.result.weight
      ?? source.result.sets?.map((set) => set.weight).find((weight): weight is number => weight !== undefined)
      ?? source.target.weight
    if (latestWeight !== undefined) next.weight = latestWeight
    return next
  }
  if (type === 'count') {
    next.count = source.result.count ?? source.target.count ?? next.count
    next.countUnit = source.target.countUnit ?? next.countUnit
    return next
  }
  if (type === 'duration') {
    next.seconds = source.result.seconds ?? source.target.seconds ?? next.seconds
    return next
  }
  if (type === 'distance') {
    next.distance = source.target.distance ?? next.distance
    next.unit = source.target.unit ?? next.unit
    return next
  }
  next.count = source.result.count ?? source.target.count ?? next.count
  return next
}

function applyReferenceToDraft(history: Log[], exercise: Exercise, mode: RM, draft: ItemDraft): ItemDraft {
  const target = referenceTarget(history, exercise, mode, draft.type, draft.target)
  const rows = history
    .filter((h) => h.exerciseId === exercise.id && h.done)
    .sort((a, b) => b.date.localeCompare(a.date))

  if (!rows.length) {
    return { ...draft, target }
  }

  const progressMetric = effectiveProgressMetric(exercise, draft.type)
  const source = mode === 'last-result'
    ? rows[0]
    : rows.reduce((acc, row) => beats(progressMetric, row, acc) ? row : acc, rows[0])

  return {
    ...draft,
    target,
    timeText: progressMetric === 'time'
      ? (source.result.timeText ?? (source.result.seconds !== undefined ? fmtSecs(source.result.seconds) : (target.seconds !== undefined ? fmtSecs(target.seconds) : draft.timeText)))
      : draft.timeText,
    weightText: progressMetric === 'weight'
      ? String(loggedWeight(source) ?? target.weight ?? '')
      : draft.weightText,
    countText: progressMetric === 'count'
      ? String(source.result.count ?? target.count ?? totalCount(target))
      : draft.countText,
  }
}

function referenceSummary(history: Log[], exercise: Exercise, mode: RM, type: TT) {
  const rows = history
    .filter((h) => h.exerciseId === exercise.id && h.done)
    .sort((a, b) => b.date.localeCompare(a.date))

  if (!rows.length) {
    return 'none'
  }

  const progressMetric = effectiveProgressMetric(exercise, type)
  const source = mode === 'last-result'
    ? rows[0]
    : rows.reduce((acc, row) => beats(progressMetric, row, acc) ? row : acc, rows[0])

  if (progressMetric === 'time') {
    return source.result.seconds !== undefined ? fmtSecs(source.result.seconds) : (source.target.seconds !== undefined ? fmtSecs(source.target.seconds) : 'none')
  }
  if (progressMetric === 'weight') {
    return weightLabel(source) || 'none'
  }

  const value = source.result.count ?? totalCount(source.target)
  return value !== undefined ? `${value}` : 'none'
}

function bestProgressEntry(history: Log[], exercise: Exercise) {
  if (!history.length) return undefined
  const progressMetric = effectiveProgressMetric(exercise, history[0].type)
  return history.reduce((acc, row) => beats(progressMetric, row, acc) ? row : acc, history[0])
}

function monthGrid(m: string) {
  const first = d(m), start = new Date(first); start.setDate(1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return key(x) })
}

function normalizeScheduleDay(day: Day): Day {
  return { ...day, rest: day.items.length === 0 }
}

function runStartLabel(startDate: string, today: string) {
  if (startDate < today) {
    return `Started ${fmtShort(startDate)}`
  }
  if (startDate > today) {
    return `Starting ${fmtShort(startDate)}`
  }
  return `Starting today (${fmtShort(startDate)})`
}

function runDisplayName(run: Run, plans: Plan[], today: string) {
  const plan = run.planId ? plans.find((entry) => entry.id === run.planId) : undefined
  const cleanedRunName = run.name.replace(/\s+starting\s+.+$/i, '').trim()
  const cycleLabel = run.name.match(/·\s*Cycle\s+\d+/i)?.[0] ?? ''
  const baseName = `${plan?.name ?? (cleanedRunName || run.name)}${plan && cycleLabel ? ` ${cycleLabel}` : ''}`
  const startLabel = runStartLabel(run.startDate, today).toLowerCase()
  return `${baseName} ${startLabel}`
}

function scheduledPlanLabel(day: Day, runs: Run[], plans: Plan[]) {
  if (!day.runId || !day.dayNo) return ''
  const run = runs.find((entry) => entry.id === day.runId)
  if (!run) return ''
  const plan = run.planId ? plans.find((entry) => entry.id === run.planId) : undefined
  const cycleLabel = run.name.match(/·\s*Cycle\s+\d+/i)?.[0] ?? ''
  const planName = `${plan?.name ?? run.name.replace(/\s+starting\s+.+$/i, '').trim()}${plan && cycleLabel ? ` ${cycleLabel}` : ''}`
  if (!planName) return ''
  return `${planName} - Day ${day.dayNo}`
}

function buildPlanSchedulePreview(plan: Plan | undefined, startDate: string, mode: PlanScheduleMode, cycleCount: number, endDate: string, schedule: Day[], firstCycleNumber: number): PlanSchedulePreview {
  const empty = { cycles: [], dates: [], conflicts: [], startDate, endDate: startDate, totalDays: 0, error: '' }
  if (!plan || plan.days.length === 0) return { ...empty, error: 'Add at least one day to this plan first.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { ...empty, error: 'Choose a valid start date.' }
  let daysToSchedule: number
  if (mode === 'end-date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return { ...empty, error: 'The program end date must be on or after the start date.' }
    daysToSchedule = Math.floor(dateOrdinal(endDate) - dateOrdinal(startDate)) + 1
    if (daysToSchedule > 366) return { ...empty, error: 'Choose a program window of one year or less.' }
  } else {
    const safeCycles = Math.max(1, Math.min(12, Math.floor(cycleCount || 1)))
    daysToSchedule = safeCycles * plan.days.length
  }
  const cycles: PlanCyclePreview[] = []
  let remaining = daysToSchedule
  let offset = 0
  while (remaining > 0) {
    const dayCount = Math.min(plan.days.length, remaining)
    const days = plan.days.slice(0, dayCount).map((planDay, index) => ({ date: add(startDate, offset + index), dayNo: index + 1, planDay }))
    cycles.push({ cycleNumber: firstCycleNumber + cycles.length, startDate: days[0].date, endDate: days[days.length - 1].date, days })
    remaining -= dayCount
    offset += dayCount
  }
  const dates = cycles.flatMap((cycle) => cycle.days.map((entry) => entry.date))
  const occupiedDates = new Set(schedule.map((day) => day.date))
  return {
    cycles,
    dates,
    conflicts: dates.filter((date) => occupiedDates.has(date)),
    startDate,
    endDate: dates[dates.length - 1] ?? startDate,
    totalDays: dates.length,
    error: '',
  }
}

function effectiveProgressMetric(exercise: Exercise, type: TT): PM {
  if (type === 'distance' || type === 'duration' || type === 'for-time') {
    return 'time'
  }
  if (type === 'weighted') {
    return 'weight'
  }
  return exercise.progressMetric
}

function makeItemDraft(item: Item, exercise: Exercise): ItemDraft {
  const progressMetric = effectiveProgressMetric(exercise, item.type)
  const targetSetReps = item.target.sets && item.target.reps
    ? Array.from({ length: item.target.sets }, () => item.target.reps).join(' / ')
    : ''
  return {
    type: item.type,
    target: clone(item.target),
    timeText: item.result.timeText ?? (item.result.seconds !== undefined ? fmtSecs(item.result.seconds) : ''),
    weightText: item.result.weight !== undefined ? String(item.result.weight) : (item.target.weight !== undefined ? String(item.target.weight) : ''),
    countText: item.result.count !== undefined ? String(item.result.count) : (progressMetric === 'count' && item.type !== 'duration' && item.type !== 'for-time' ? String(totalCount(item.target)) : ''),
    setRepsText: item.result.sets?.length ? item.result.sets.map((set) => set.reps).join(' / ') : targetSetReps,
    difficulty: item.result.difficulty ?? '',
    note: item.result.note ?? '',
  }
}

async function ensureProfile(currentUser: User) {
  if (!supabase) return
  await supabase.from('profiles').upsert({
    id: currentUser.id,
    email: currentUser.email ?? null,
    display_name: currentUser.user_metadata?.full_name ?? currentUser.user_metadata?.name ?? currentUser.email ?? 'Discipline + user',
  })
}

async function ensureCoachingFoundation(currentUser: User) {
  if (!supabase) return
  const { data: profileRows, error: profileReadError } = await supabase.from('coaching_profiles').select('id').eq('user_id', currentUser.id)
  if (profileReadError) {
    console.error('coaching profile read failed', profileReadError)
    return
  }
  if (!profileRows?.length) {
    const { error } = await supabase.from('coaching_profiles').upsert({
      id: `coach-profile-${currentUser.id}`,
      user_id: currentUser.id,
      goal_name: '60-day cut/recomposition',
      start_weight_lb: 199,
      height_inches: 72,
      target_weight_lb: 190,
      desired_loss_min_lb: 1,
      desired_loss_max_lb: 1.5,
      targets: { calories: { min: 2000, max: 2200 }, protein_g: { min: 170, max: 190 }, steps: 8000, lifting_sessions: 4, cardio_sessions: 2, recovery_days: 1 },
      equipment: 'Two PowerBlock adjustable dumbbells, maximum 50 lb each.',
      calorie_context: 'Displayed food intake may underestimate actual intake by roughly 100-200 calories because small additions are sometimes omitted.',
      coaching_style: { concise: true, use_trends: true, avoid_manufactured_problems: true, give_next_session_recommendations: true },
    })
    if (error) console.error('coaching profile seed failed', error)
  }

  const { data: noteRows, error: noteReadError } = await supabase.from('coaching_notes').select('id').eq('user_id', currentUser.id)
  if (noteReadError) {
    console.error('coaching notes read failed', noteReadError)
    return
  }
  const existingIds = new Set((noteRows ?? []).map((row) => row.id))
  const missingNotes = COACHING_NOTE_SEEDS
    .map((note) => ({
      id: `coach-note-${currentUser.id}-${note.key}`,
      user_id: currentUser.id,
      category: note.category,
      exercise_id: null,
      title: note.title,
      body: note.body,
      status: 'active',
      priority: note.priority,
      effective_from: null,
    }))
    .filter((note) => !existingIds.has(note.id))
  if (missingNotes.length) {
    const { error } = await supabase.from('coaching_notes').upsert(missingNotes)
    if (error) console.error('coaching notes seed failed', error)
  }
}

function catalogExercisesFromSlices(plans: Plan[], runs: Run[], schedule: Day[], logs: Log[]) {
  return ensureAmpedData({
    exercises: [],
    plans,
    runs,
    schedule,
    logs,
  }).exercises
}

function normalizePlanDaysData(days: PlanDay[]) {
  return days.map((day, index) => ({ ...day, label: `Day ${index + 1}`, rest: day.items.length === 0 }))
}

function mapExerciseRow(row: {
  id: string
  kind?: string | null
  name: string
  category: string
  equipment: string
  notes: string
  default_type: string
  allowed: unknown
  target: unknown
  refs: unknown
  progress_metric: string
  repeat_days?: unknown
}): Exercise {
  return {
    id: row.id,
    kind: sanitizeExerciseKind(row.kind as TK | undefined),
    name: row.name,
    category: row.category,
    equipment: row.equipment,
    notes: row.notes,
    defaultType: row.default_type as TT,
    allowed: Array.isArray(row.allowed) ? row.allowed as TT[] : ['count'],
    target: typeof row.target === 'object' && row.target ? row.target as Target : {},
    refs: Array.isArray(row.refs) ? row.refs as RM[] : ['last-result', 'personal-best'],
    progressMetric: row.progress_metric as PM,
    repeatDays: sanitizeRepeatDays(row.repeat_days),
  }
}

function sanitizeRepeatDays(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is number => Number.isInteger(entry) && entry >= 0 && entry <= 6))].sort((a, b) => a - b)
}

function buildScheduleRows(schedule: Day[], runs: Run[], logs: Log[], userId: string, validPlanIds: Set<string>): ScheduleRowSet {
  return {
    runs: runs.map((run) => ({
      id: run.id,
      user_id: userId,
      plan_id: run.planId && validPlanIds.has(run.planId) ? run.planId : null,
      start_date: run.startDate,
      name: run.name,
      status: run.status,
      completed_at: run.completedAt ?? null,
    })),
    days: schedule.map((day0) => ({
      id: scheduleDayId(day0.date),
      user_id: userId,
      date: day0.date,
      notes: day0.notes,
      skipped: day0.skipped,
      run_id: day0.runId ?? null,
      day_no: day0.dayNo ?? null,
    })),
    items: schedule.flatMap((day0) => day0.items.map((item) => ({
      id: item.id,
      user_id: userId,
      schedule_day_id: scheduleDayId(day0.date),
      exercise_id: item.exerciseId,
      type: item.type,
      target: item.target,
      ref: item.ref,
      done: item.done,
      result: item.result,
    }))),
    logs: logs.map((entry) => ({
      id: entry.id,
      user_id: userId,
      source_item_id: entry.sourceItemId ?? null,
      exercise_id: entry.exerciseId,
      date: entry.date,
      type: entry.type,
      target: entry.target,
      result: entry.result,
    })),
  }
}

function exerciseRow(exercise: Exercise, userId: string) {
  return {
    id: exercise.id,
    user_id: userId,
    kind: exercise.kind,
    name: exercise.name,
    category: exercise.category,
    equipment: exercise.equipment,
    notes: exercise.notes,
    default_type: exercise.defaultType,
    allowed: exercise.allowed,
    target: exercise.target,
    refs: exercise.refs,
    progress_metric: exercise.progressMetric,
    repeat_days: exercise.kind === 'habit' ? exercise.repeatDays ?? [] : [],
  }
}

function mapPlanRows(
  planRows: Array<{ id: string; name: string; focus: string }>,
  dayRows: Array<{ id: string; plan_id: string; day_number: number; notes: string }>,
  itemRows: Array<{ id: string; plan_day_id: string; exercise_id: string; type: string; target: unknown; ref: string }>,
): Plan[] {
  const itemsByDayId = new Map<string, PlanDay['items']>()
  for (const row of itemRows) {
    const nextItems = itemsByDayId.get(row.plan_day_id) ?? []
    nextItems.push({
      id: row.id,
      exerciseId: row.exercise_id,
      type: row.type as TT,
      target: typeof row.target === 'object' && row.target ? row.target as Target : {},
      ref: row.ref as RM,
    })
    itemsByDayId.set(row.plan_day_id, nextItems)
  }

  const daysByPlanId = new Map<string, PlanDay[]>()
  for (const row of dayRows) {
    const nextDays = daysByPlanId.get(row.plan_id) ?? []
    nextDays.push({
      id: row.id,
      label: `Day ${row.day_number}`,
      rest: false,
      notes: row.notes,
      items: itemsByDayId.get(row.id) ?? [],
    })
    daysByPlanId.set(row.plan_id, nextDays)
  }

  return planRows.map((row) => ({
    id: row.id,
    name: row.name,
    focus: row.focus,
    days: normalizePlanDaysData(
      [...(daysByPlanId.get(row.id) ?? [])].sort((a, b) => {
        const aNum = Number(a.label.replace('Day ', ''))
        const bNum = Number(b.label.replace('Day ', ''))
        return aNum - bNum
      }),
    ),
  }))
}

function mapRunRows(rows: Array<{ id: string; plan_id: string | null; start_date: string; name: string; status: string; completed_at: string | null }>): Run[] {
  return rows.map((row) => ({
    id: row.id,
    planId: row.plan_id ?? '',
    startDate: row.start_date,
    name: row.name,
    status: row.status === 'completed' ? 'completed' : 'active',
    completedAt: row.completed_at ?? undefined,
  }))
}

function mapScheduleRows(
  dayRows: Array<{ id: string; date: string; notes: string; skipped: boolean; run_id: string | null; day_no: number | null }>,
  itemRows: Array<{ id: string; schedule_day_id: string; exercise_id: string; type: string; target: unknown; ref: string; done: boolean; result: unknown }>,
): Day[] {
  const itemsByDayId = new Map<string, Item[]>()
  for (const row of itemRows) {
    const nextItems = itemsByDayId.get(row.schedule_day_id) ?? []
    nextItems.push({
      id: row.id,
      exerciseId: row.exercise_id,
      type: row.type as TT,
      target: typeof row.target === 'object' && row.target ? row.target as Target : {},
      ref: row.ref as RM,
      done: row.done,
      result: typeof row.result === 'object' && row.result ? row.result as Result : {},
    })
    itemsByDayId.set(row.schedule_day_id, nextItems)
  }

  return dayRows
    .map((row) => normalizeScheduleDay({
      date: row.date,
      notes: row.notes,
      rest: false,
      skipped: row.skipped,
      runId: row.run_id ?? undefined,
      dayNo: row.day_no ?? undefined,
      items: itemsByDayId.get(row.id) ?? [],
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function mapLogRows(rows: Array<{ id: string; source_item_id: string | null; exercise_id: string; date: string; type: string; target: unknown; result: unknown }>): Log[] {
  return rows.map((row) => ({
    id: row.id,
    sourceItemId: row.source_item_id ?? undefined,
    exerciseId: row.exercise_id,
    date: row.date,
    type: row.type as TT,
    target: typeof row.target === 'object' && row.target ? row.target as Target : {},
    result: typeof row.result === 'object' && row.result ? row.result as Result : {},
    done: true,
  }))
}

function signedOutState(): State {
  return ensureAmpedData({
    exercises: [],
    plans: [],
    runs: [],
    schedule: [],
    logs: [],
  })
}

export default function App() {
  const [state, setState] = useState<State>(() => {
    if (hasSupabaseEnv) {
      return signedOutState()
    }
    const raw = localStorage.getItem(KEY)
    return ensureAmpedData(raw ? JSON.parse(raw) as LegacyState : seed())
  })
  const today = key(new Date())
  const initialHashTab = window.location.hash.replace(/^#\/?/, '')
  const [tab, setTab] = useState<AppTab>(APP_TABS.includes(initialHashTab as AppTab) ? initialHashTab as AppTab : 'schedule')
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(hasSupabaseEnv)
  const [selected, setSelected] = useState(today)
  const [month, setMonth] = useState(monthKey(today))
  const [scheduleView, setScheduleView] = useState<'calendar' | 'list'>('list')
  const [visibleListCount, setVisibleListCount] = useState(5)
  const [showPastDays, setShowPastDays] = useState(false)
  const [shift, setShift] = useState<number | undefined>(1)
  const [swapDate, setSwapDate] = useState(add(today, 1))
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(state.exercises[0]?.id ?? null)
  const [exerciseEditorMode, setExerciseEditorMode] = useState<ExerciseEditorMode>(state.exercises[0] ? 'existing' : 'new')
  const [exerciseForm, setExerciseForm] = useState<ExerciseForm>(() => state.exercises[0] ? formFromExercise(state.exercises[0]) : emptyExerciseForm())
  const [libraryFilter, setLibraryFilter] = useState<TK>('exercise')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [pendingImport, setPendingImport] = useState<LegacyState | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [planEditing, setPlanEditing] = useState(false)
  const [planForm, setPlanForm] = useState<PlanForm>(() => emptyPlanForm())
  const [importAnalysis, setImportAnalysis] = useState<ImportedPlanAnalysis | null>(null)
  const [importWorkbook, setImportWorkbook] = useState<WorkbookPreview | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [settingsSection, setSettingsSection] = useState<'data' | 'integrations' | 'profile'>('profile')
  const [mobilePairing, setMobilePairing] = useState<MobilePairing | null>(null)
  const [mobilePairingLoading, setMobilePairingLoading] = useState(false)
  const [mobileSyncStatus, setMobileSyncStatus] = useState<MobileSyncStatus | null>(null)
  const [coachProfile, setCoachProfile] = useState<CoachProfile>(EMPTY_COACH_PROFILE)
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(() => profileDraftFrom(EMPTY_COACH_PROFILE))
  const [profileSaving, setProfileSaving] = useState(false)
  const [bodyweights, setBodyweights] = useState<Array<{ date: string; weight: number }>>([])
  const [mobileSyncStatusLoading, setMobileSyncStatusLoading] = useState(false)
  const [aiDiagnostics, setAiDiagnostics] = useState<AiDiagnostic[]>([])
  const [aiDiagnosticsLoading, setAiDiagnosticsLoading] = useState(false)
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({})
  const [openDaySections, setOpenDaySections] = useState<Record<DaySection, boolean>>({ habits: true, workout: true, health: false, coach: false })
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({})
  const [dailyHealthDraft, setDailyHealthDraft] = useState<DailyHealthDraft>(() => emptyDailyHealthDraft())
  const [dailyHealthLoading, setDailyHealthLoading] = useState(false)
  const [dailyHealthRefreshKey, setDailyHealthRefreshKey] = useState(0)
  const [dailyHealthSaving, setDailyHealthSaving] = useState(false)
  const [dailyReview, setDailyReview] = useState<DailyReview | null>(null)
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([])
  const [dailyReviewLoading, setDailyReviewLoading] = useState(false)
  const [dailyReviewSubmitting, setDailyReviewSubmitting] = useState(false)
  const [coachDraft, setCoachDraft] = useState('')
  const [coachSending, setCoachSending] = useState(false)
  const [programCoachMessages, setProgramCoachMessages] = useState<ProgramCoachMessage[]>([])
  const [programCoachDraft, setProgramCoachDraft] = useState('')
  const [programCoachLookback, setProgramCoachLookback] = useState<28 | 56 | 84>(28)
  const [programCoachLoading, setProgramCoachLoading] = useState(false)
  const [programCoachSending, setProgramCoachSending] = useState(false)
  const [recommendationDecisionSaving, setRecommendationDecisionSaving] = useState<Record<number, 'apply' | 'dismiss'>>({})
  const [expandedPlanDays, setExpandedPlanDays] = useState<Record<string, boolean>>({})
  const [expandedPlanItems, setExpandedPlanItems] = useState<Record<string, boolean>>({})
  const [draggedPlanDayId, setDraggedPlanDayId] = useState<string | null>(null)
  const [draggedScheduleDayDate, setDraggedScheduleDayDate] = useState<string | null>(null)
  const [scheduleMoveTarget, setScheduleMoveTarget] = useState<ScheduleMoveTarget | null>(null)
  const [applyPlanId, setApplyPlanId] = useState<string | null>(null)
  const [applyStartDate, setApplyStartDate] = useState(today)
  const [applyScheduleMode, setApplyScheduleMode] = useState<PlanScheduleMode>('cycles')
  const [applyTargetMode, setApplyTargetMode] = useState<PlanTargetMode>('latest')
  const [applyCycleCount, setApplyCycleCount] = useState(1)
  const [applyEndDate, setApplyEndDate] = useState(add(today, 59))
  const [applyPlanSaving, setApplyPlanSaving] = useState(false)
  const [keepCompletedPlanDays, setKeepCompletedPlanDays] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pendingReplayNotice, setPendingReplayNotice] = useState('')
  const [daySheet, setDaySheet] = useState<null | { mode: 'add'; kind: TK } | { mode: 'actions' }>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [libraryEditorOpen, setLibraryEditorOpen] = useState(false)
  const [scheduleSaveStatus, setScheduleSaveStatus] = useState<ScheduleSaveStatus>('idle')
  const [confirmState, setConfirmState] = useState<ConfirmState>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const planImportInputRef = useRef<HTMLInputElement | null>(null)
  const dayDetailRef = useRef<HTMLElement | null>(null)
  const daySectionsDateRef = useRef('')
  const exerciseDetailRef = useRef<HTMLDivElement | null>(null)
  const planDetailRef = useRef<HTMLElement | null>(null)
  const localScheduleRef = useRef({ schedule: state.schedule, runs: state.runs, logs: state.logs })
  const authUserRef = useRef<string | null>(null)
  const scheduleSaveTimerRef = useRef<number | null>(null)
  const scheduleLoadRevisionRef = useRef(0)
  const scheduleServerRevisionRef = useRef(0)
  // Undo buttons outlive the render that created them, so they call through here to act on the latest state.
  const undoActionsRef = useRef<UndoActions | null>(null)
  // What the server holds as of the last load or successful save, so saves can send only the difference.
  const savedScheduleRowsRef = useRef<ScheduleRowFingerprint | null>(null)
  const changesEndpointMissingRef = useRef(false)
  // Set when saves can't reach the server (offline or signed out); edits are kept locally until they can.
  const saveBlockedRef = useRef<null | 'signin' | 'offline'>(null)
  const replayedPendingRef = useRef(false)
  // Saves run one at a time; two overlapping saves would both claim the same revision and the second would 409.
  const scheduleSaveChainRef = useRef<Promise<unknown>>(Promise.resolve())
  const serverExerciseIdsRef = useRef(new Set<string>())
  const serverPlanIdsRef = useRef(new Set<string>())
  const scheduleTouchHoldRef = useRef<number | null>(null)
  const scheduleTouchDragRef = useRef<ScheduleTouchDrag | null>(null)
  const scheduleCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const setRepsInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const suppressScheduleDayClickRef = useRef(false)
  useEffect(() => {
    const syncTabFromHistory = () => {
      const hashTab = window.location.hash.replace(/^#\/?/, '')
      setTab(APP_TABS.includes(hashTab as AppTab) ? hashTab as AppTab : 'schedule')
    }
    window.addEventListener('popstate', syncTabFromHistory)
    return () => window.removeEventListener('popstate', syncTabFromHistory)
  }, [])
  const openTab = (nextTab: AppTab) => {
    if (nextTab !== tab) window.history.pushState({}, '', `${window.location.pathname}${window.location.search}#/${nextTab}`)
    setTab(nextTab)
  }
  useEffect(() => {
    if (hasSupabaseEnv) return
    localStorage.setItem(KEY, JSON.stringify(state))
  }, [state])
  useEffect(() => {
    if (!hasSupabaseEnv) return
    localStorage.removeItem(KEY)
  }, [])
  useEffect(() => {
    localScheduleRef.current = { schedule: state.schedule, runs: state.runs, logs: state.logs }
  }, [state.schedule, state.runs, state.logs])
  useEffect(() => {
    setSwapDate(add(selected, 1))
  }, [selected])
  useEffect(() => {
    if (!toasts.length) return
    // Each toast gets its own clock, so a queue of them doesn't linger end to end.
    const timers = toasts.map((toast) => window.setTimeout(
      () => setToasts((current) => current.filter((entry) => entry.id !== toast.id)),
      Math.max(0, (toast.action ? 6000 : 2800) - (Date.now() - toast.createdAt)),
    ))
    return () => timers.forEach((handle) => window.clearTimeout(handle))
  }, [toasts])
  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }

    let active = true
    const resetToSignedOutShell = () => {
      const next = signedOutState()
      setState(next)
      const nextToday = key(new Date())
      setSelected(nextToday)
      setMonth(monthKey(nextToday))
      setSelectedExerciseId(next.exercises[0]?.id ?? null)
      setExerciseEditorMode(next.exercises[0] ? 'existing' : 'new')
      setExerciseForm(next.exercises[0] ? formFromExercise(next.exercises[0]) : emptyExerciseForm())
      const nextPlan = next.plans[0]
      setSelectedPlanId(nextPlan?.id ?? null)
      setPlanForm(nextPlan ? formFromPlan(nextPlan) : emptyPlanForm())
      setApplyPlanId(null)
      setApplyStartDate(nextToday)
    }
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      authUserRef.current = data.session?.user?.id ?? null
      setUser(data.session?.user ?? null)
      if (data.session?.user) {
        await ensureProfile(data.session.user)
        await ensureCoachingFoundation(data.session.user)
      } else {
        resetToSignedOutShell()
      }
      if (active) {
        setAuthLoading(false)
      }
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authUserRef.current = nextSession?.user?.id ?? null
      setUser(nextSession?.user ?? null)
      setAuthLoading(false)
      if (nextSession?.user) {
        void ensureProfile(nextSession.user)
        void ensureCoachingFoundation(nextSession.user)
      } else {
        resetToSignedOutShell()
      }
    })

    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [])
  useEffect(() => {
    if (!supabase || !user) {
      setCoachProfile(EMPTY_COACH_PROFILE)
      return
    }
    let active = true
    const client = supabase
    const loadCoachProfile = async () => {
      let { data, error } = await client.from('coaching_profiles').select('birth_year, sex, height_inches, powerblock_colors, training_since').eq('user_id', user.id)
      // Before the API knows the new profile columns, fall back to what it has.
      if (error) ({ data, error } = await client.from('coaching_profiles').select('height_inches').eq('user_id', user.id))
      if (!active || error) return
      const row = (data?.[0] ?? {}) as { birth_year?: number | null; sex?: string | null; height_inches?: number | null; powerblock_colors?: boolean | null; training_since?: string | null }
      const next: CoachProfile = {
        birthYear: typeof row.birth_year === 'number' ? row.birth_year : null,
        sex: row.sex === 'male' || row.sex === 'female' ? row.sex : null,
        heightInches: typeof row.height_inches === 'number' ? row.height_inches : null,
        powerblockColors: row.powerblock_colors !== false,
        trainingSince: typeof row.training_since === 'string' && /^\d{4}-\d{2}$/.test(row.training_since) ? row.training_since : null,
      }
      setCoachProfile(next)
      setProfileDraft(profileDraftFrom(next))
    }
    void loadCoachProfile()
    return () => { active = false }
  }, [user])
  useEffect(() => {
    if (!supabase || !user || tab !== 'progress') return
    let active = true
    const client = supabase
    void client.from('body_weight_entries').select('local_date, weight_lb').eq('user_id', user.id).order('local_date', { ascending: true }).then(({ data, error }) => {
      if (!active || error || !data) return
      const byDate = new Map<string, number>()
      for (const row of data as Array<{ local_date: string; weight_lb: number }>) {
        if (typeof row.weight_lb === 'number') byDate.set(row.local_date, row.weight_lb)
      }
      setBodyweights([...byDate.entries()].map(([date, weight]) => ({ date, weight })))
    })
    return () => { active = false }
  }, [tab, user])
  useEffect(() => {
    if (!supabase || !user) {
      setDailyHealthDraft(emptyDailyHealthDraft())
      return
    }
    let active = true
    const loadDailyHealth = async () => {
      setDailyHealthLoading(true)
      const [{ data: healthRows, error: healthError }, { data: weightRows, error: weightError }] = await Promise.all([
        supabase.from('daily_health').select('id, calories_kcal, protein_g, carbs_g, fat_g, steps').eq('user_id', user.id).eq('date', selected),
        supabase.from('body_weight_entries').select('id, weight_lb, source, measured_at').eq('user_id', user.id).eq('local_date', selected).order('measured_at', { ascending: false }),
      ])
      if (!active) return
      if (healthError || weightError) {
        console.error('daily health load failed', healthError ?? weightError)
        setDailyHealthLoading(false)
        return
      }
      const health = healthRows?.[0]
      const weights = weightRows ?? []
      const weight = weights.find((row) => row.source === 'manual') ?? weights[0]
      setDailyHealthDraft({
        calories: wholeNumberText(health?.calories_kcal),
        protein: wholeNumberText(health?.protein_g),
        carbs: wholeNumberText(health?.carbs_g),
        fat: wholeNumberText(health?.fat_g),
        steps: wholeNumberText(health?.steps),
        weight: weight?.weight_lb === undefined ? '' : String(weight.weight_lb),
      })
      setDailyHealthLoading(false)
    }
    void loadDailyHealth()
    return () => { active = false }
  }, [dailyHealthRefreshKey, selected, user])
  useEffect(() => {
    if (!user) {
      setMobileSyncStatus(null)
      return
    }
    let active = true
    setMobileSyncStatusLoading(true)
    loadHealthSyncStatus().then((payload) => {
      if (active) setMobileSyncStatus(mobileSyncStatusFromPayload(payload?.device))
    }).catch((error) => {
      console.error('mobile sync status load failed', error)
    }).finally(() => {
      if (active) setMobileSyncStatusLoading(false)
    })
    const returnParams = new URLSearchParams(window.location.search)
    if (returnParams.has('healthSynced')) {
      const returnedDate = returnParams.get('date') || sessionStorage.getItem(HEALTH_SYNC_DATE_KEY)
      if (returnedDate && /^\d{4}-\d{2}-\d{2}$/.test(returnedDate)) {
        setSelected(returnedDate)
        setMonth(monthKey(returnedDate))
      }
      sessionStorage.removeItem(HEALTH_SYNC_DATE_KEY)
      setDailyHealthRefreshKey((current) => current + 1)
      returnParams.delete('healthSynced')
      returnParams.delete('date')
      const remainingQuery = returnParams.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}${window.location.hash}`)
    }
    return () => { active = false }
  }, [user])
  useEffect(() => {
    if (!user || tab !== 'settings' || settingsSection !== 'integrations') return
    let active = true
    setAiDiagnosticsLoading(true)
    loadAiDiagnostics().then((payload) => {
      if (active) setAiDiagnostics(Array.isArray(payload?.diagnostics) ? payload.diagnostics : [])
    }).catch((error) => {
      console.error('AI diagnostics load failed', error)
    }).finally(() => {
      if (active) setAiDiagnosticsLoading(false)
    })
    return () => { active = false }
  }, [settingsSection, tab, user])
  useEffect(() => {
    const selectedDay = localScheduleRef.current.schedule.find((entry) => entry.date === selected)
    const habitIds = new Set(state.exercises.filter((exercise) => exercise.kind === 'habit').map((exercise) => exercise.id))
    const workout = selectedDay?.items.filter((item) => !habitIds.has(item.exerciseId)) ?? []
    // Decide once per day, but decide again when that day's workout first loads.
    const sectionKey = `${selected}:${workout.length > 0}`
    if (daySectionsDateRef.current === sectionKey) return
    daySectionsDateRef.current = sectionKey
    const complete = workout.length > 0 && workout.every((item) => item.done)
    setOpenDaySections({ habits: true, workout: !complete, health: complete || workout.length === 0, coach: false })
  }, [selected, state.schedule, state.exercises])
  useEffect(() => {
    if (!user) {
      setDailyReview(null)
      setCoachMessages([])
      return
    }
    let active = true
    setDailyReviewLoading(true)
    setCoachDraft('')
    setRecommendationDecisionSaving({})
    loadCoachDay(selected).then((payload) => {
      if (!active) return
      setDailyReview(dailyReviewFromPayload(payload?.review))
      setCoachMessages(Array.isArray(payload?.messages) ? payload.messages.filter((message): message is CoachMessage => Boolean(message) && typeof message === 'object' && ((message as CoachMessage).role === 'user' || (message as CoachMessage).role === 'assistant')) : [])
    }).catch((error) => {
      console.error('daily coach load failed', error)
      if (active) {
        setDailyReview(null)
        setCoachMessages([])
      }
    }).finally(() => {
      if (active) setDailyReviewLoading(false)
    })
    return () => { active = false }
  }, [selected, user])
  useEffect(() => {
    if (!user) {
      setProgramCoachMessages([])
      return
    }
    if (tab !== 'coach') return
    let active = true
    setProgramCoachLoading(true)
    loadProgramCoach().then((payload) => {
      if (!active) return
      const messages = Array.isArray(payload?.messages)
        ? payload.messages.filter((message): message is ProgramCoachMessage => Boolean(message) && typeof message === 'object' && ((message as ProgramCoachMessage).role === 'user' || (message as ProgramCoachMessage).role === 'assistant'))
        : []
      setProgramCoachMessages(messages)
      const lookback = Number(payload?.lookbackDays)
      if (lookback === 28 || lookback === 56 || lookback === 84) setProgramCoachLookback(lookback)
    }).catch((error) => {
      console.error('program coach load failed', error)
      if (active) setProgramCoachMessages([])
    }).finally(() => {
      if (active) setProgramCoachLoading(false)
    })
    return () => { active = false }
  }, [tab, user])
  const exById = useMemo(() => Object.fromEntries(state.exercises.map((x) => [x.id, x])), [state.exercises])
  const sortedExercises = useMemo(() => [...state.exercises].sort(compareExercises), [state.exercises])
  const recurringHabits = useMemo(() => sortedExercises.filter((exercise) => exercise.kind === 'habit' && (exercise.repeatDays?.length ?? 0) > 0), [sortedExercises])
  const isHabitItem = (item: Item) => exById[item.exerciseId]?.kind === 'habit'
  const hasWorkoutContent = (day0: Day) => Boolean(day0.runId) || day0.items.some((item) => !isHabitItem(item))
  const emptyScheduleDay = (date: string): Day => ({ date, notes: '', rest: true, skipped: false, items: [] })
  // Habits belong to the calendar date they were done on, so moving a workout day never drags them along.
  const keepHabitsOnDates = (before: Day[], after: Day[], logs: Log[]) => pinItemsToDates(before, after, logs, {
    isPinned: isHabitItem,
    emptyDay: emptyScheduleDay,
    isDisposable: (day0) => !day0.runId && !day0.notes.trim(),
    normalize: normalizeScheduleDay,
  })
  // Fold any habit-only day that shares a date with a workout day into that workout day.
  const mergeDaysByDate = (days: Day[]) => {
    const byDate = new Map<string, Day>()
    for (const day0 of days) {
      const existing = byDate.get(day0.date)
      if (!existing) {
        byDate.set(day0.date, day0)
        continue
      }
      const [base, extra] = hasWorkoutContent(day0) && !hasWorkoutContent(existing) ? [day0, existing] : [existing, day0]
      byDate.set(day0.date, normalizeScheduleDay({ ...base, notes: base.notes || extra.notes, items: [...base.items, ...extra.items] }))
    }
    return [...byDate.values()]
  }
  const filteredLibraryExercises = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase()
    return sortedExercises.filter((exercise) => exercise.kind === libraryFilter && (!query || `${exercise.name} ${exercise.category} ${exercise.equipment}`.toLowerCase().includes(query)))
  }, [libraryFilter, libraryQuery, sortedExercises])
  const catalogMatchesByNormalizedName = useMemo(() => {
    const matchMap = new Map<string, Exercise>()
    sortedExercises.forEach((exercise) => {
      const key = normalizeCatalogName(exercise.name)
      if (!matchMap.has(key)) {
        matchMap.set(key, exercise)
      }
    })
    return matchMap
  }, [sortedExercises])
  const starterExercises = useMemo(() => catalogExercisesFromSlices([], [], [], []), [])
  const dayByDate = useMemo(() => Object.fromEntries(state.schedule.map((x) => [x.date, x])), [state.schedule])
  const derivedHistory = useMemo(() => [...state.logs].sort((a, b) => a.date.localeCompare(b.date)), [state.logs])
  // Logs grouped per exercise so per-item reference lookups don't scan the whole history on every render.
  const logsByExercise = useMemo(() => {
    const grouped = new Map<string, Log[]>()
    for (const entry of derivedHistory) {
      const rows = grouped.get(entry.exerciseId) ?? []
      rows.push(entry)
      grouped.set(entry.exerciseId, rows)
    }
    return grouped
  }, [derivedHistory])
  const exerciseHistory = (exerciseId: string) => logsByExercise.get(exerciseId) ?? []
  const habitDoneDates = useMemo(() => {
    const byHabit = new Map<string, Set<string>>()
    for (const entry of state.logs) {
      if (!entry.done) continue
      const dates = byHabit.get(entry.exerciseId) ?? new Set<string>()
      dates.add(entry.date)
      byHabit.set(entry.exerciseId, dates)
    }
    return byHabit
  }, [state.logs])
  const importedItemMatches = useMemo(() => {
    if (!importAnalysis) return []
    return importAnalysis.items
      .slice()
      .sort((a, b) => compareStrings(a.name, b.name))
      .map((item) => ({
        item,
        existing: catalogMatchesByNormalizedName.get(normalizeCatalogName(item.name)) ?? null,
      }))
  }, [catalogMatchesByNormalizedName, importAnalysis])
  const day: Day = normalizeScheduleDay(dayByDate[selected] ?? { date: selected, notes: '', rest: true, skipped: false, items: [] })
  const workoutItems = day.items.filter((item) => !isHabitItem(item))
  const habitItems = day.items.filter(isHabitItem)
  const isRestDay = workoutItems.length === 0
  const completedWorkoutItems = workoutItems.filter((item) => item.done).length
  const workoutComplete = !isRestDay && completedWorkoutItems === workoutItems.length
  const dueHabits = recurringHabits.filter((habit) => isDueOn(habit.repeatDays, selected) && !habitItems.some((item) => item.exerciseId === habit.id))
  const habitTotal = habitItems.length + dueHabits.length
  const habitDone = habitItems.filter((item) => item.done).length
  const hasHabitLibrary = state.exercises.some((exercise) => exercise.kind === 'habit')
  const dailyNumbersSummary = [
    dailyHealthDraft.calories.trim() && `${Number(dailyHealthDraft.calories).toLocaleString()} kcal`,
    dailyHealthDraft.protein.trim() && `${dailyHealthDraft.protein} g protein`,
    dailyHealthDraft.steps.trim() && `${Number(dailyHealthDraft.steps).toLocaleString()} steps`,
    dailyHealthDraft.weight.trim() && `${dailyHealthDraft.weight} lb`,
  ].filter(Boolean).join(' · ')
  const weekDayStatus = (date: string): WeekDayStatus => {
    const entry = dayByDate[date]
    if (!entry) return { workout: 'none', habitsDone: 0 }
    const workout = entry.items.filter((item) => !isHabitItem(item))
    const habitsDone = entry.items.filter((item) => isHabitItem(item) && item.done).length
    if (!workout.length) return { workout: 'none', habitsDone }
    if (entry.skipped) return { workout: 'skipped', habitsDone }
    const doneCount = workout.filter((item) => item.done).length
    return { workout: doneCount === workout.length ? 'done' : doneCount ? 'partial' : 'planned', habitsDone }
  }
  const pickerItems = daySheet?.mode === 'add'
    ? sortedExercises.filter((exercise) => exercise.kind === daySheet.kind && (!pickerQuery.trim() || `${exercise.name} ${exercise.category} ${exercise.equipment}`.toLowerCase().includes(pickerQuery.trim().toLowerCase())))
    : []
  const onSelectedDay = new Set(day.items.map((item) => item.exerciseId))
  const plan = state.plans.find((p) => p.id === selectedPlanId) ?? null
  const selectedDayPlanLabel = scheduledPlanLabel(day, state.runs, state.plans)
  const monthDays = useMemo(() => monthGrid(month), [month])
  const sortedDays = [...state.schedule].sort((a, b) => a.date.localeCompare(b.date))
  const nextWorkoutDay = sortedDays.find((day0) => day0.date > selected && day0.items.some((item) => !isHabitItem(item)))
  const activeRuns = state.runs.filter((run) => run.status === 'active')
  // Extending a plan adds another cycle; show a plan's active cycles as one program.
  const activeProgramGroups = Object.values(activeRuns.reduce<Record<string, { key: string; plan?: Plan; runs: Run[] }>>((groups, run) => {
    const groupKey = run.planId ? `plan-${run.planId}` : run.id
    const entry = groups[groupKey] ?? { key: groupKey, plan: state.plans.find((plan0) => plan0.id === run.planId), runs: [] }
    entry.runs.push(run)
    groups[groupKey] = entry
    return groups
  }, {})).map((group) => ({ ...group, runs: [...group.runs].sort((a, b) => a.startDate.localeCompare(b.startDate)) }))
  const completedRuns = state.runs.filter((run) => run.status === 'completed').sort((a, b) => (b.completedAt ?? b.startDate).localeCompare(a.completedAt ?? a.startDate))
  const activePlanIds = new Set(activeRuns.map((run) => run.planId).filter((planId): planId is string => !!planId))
  const planToApply = state.plans.find((entry) => entry.id === applyPlanId)
  const extendingPlan = Boolean(applyPlanId && activePlanIds.has(applyPlanId))
  const firstNewCycleNumber = applyPlanId ? state.runs.filter((run) => run.planId === applyPlanId).length + 1 : 1
  const applyPlanPreview = buildPlanSchedulePreview(planToApply, applyStartDate, applyScheduleMode, applyCycleCount, applyEndDate, state.schedule.filter(hasWorkoutContent), firstNewCycleNumber)
  const futureDays = sortedDays.filter((day0) => day0.date >= today)
  const pastDays = sortedDays.filter((day0) => day0.date < today).reverse()
  const listDays = showPastDays ? [...pastDays, ...futureDays] : futureDays
  const visibleDays = scheduleView === 'list' ? listDays.slice(0, visibleListCount) : sortedDays
  const pushToast = (message: string, action?: Toast['action']) => setToasts((current) => [...current, { id: id('toast'), message, createdAt: Date.now(), action }].slice(-3))
  const pushUndoToast = (message: string, undo: () => Promise<unknown>) => pushToast(message, { label: 'Undo', run: () => void undo() })
  const hasDailyNumbers = Boolean(dailyNumbersSummary)
  useEffect(() => {
    // Once a day's numbers are in (often synced from the phone), show the one-line summary instead of the form.
    if (!dailyHealthLoading && hasDailyNumbers) setOpenDaySections((current) => current.health ? { ...current, health: false } : current)
  }, [dailyHealthLoading, selected]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggleDaySection = (section: DaySection) => setOpenDaySections((current) => ({ ...current, [section]: !current[section] }))
  const updateScheduleMoveTargetFromPoint = (clientY: number) => {
    if (!scheduleTouchDragRef.current?.active) return
    const cards = visibleDays
      .map((day0) => {
        const element = scheduleCardRefs.current[day0.date]
        if (!element) return null
        return { date: day0.date, rect: element.getBoundingClientRect() }
      })
      .filter((entry): entry is { date: string; rect: DOMRect } => !!entry)

    if (!cards.length) return

    const beforeFirst = cards[0]
    if (clientY < beforeFirst.rect.top + (beforeFirst.rect.height / 2)) {
      setScheduleMoveTarget({ date: beforeFirst.date, placement: 'before' })
      return
    }

    for (const card of cards) {
      const midpoint = card.rect.top + (card.rect.height / 2)
      if (clientY < midpoint) {
        setScheduleMoveTarget({ date: card.date, placement: 'before' })
        return
      }
      if (clientY <= card.rect.bottom) {
        setScheduleMoveTarget({ date: card.date, placement: 'after' })
        return
      }
    }

    const last = cards[cards.length - 1]
    setScheduleMoveTarget({ date: last.date, placement: 'after' })
  }
  const persistExercisesCollection = useCallback(async (nextExercises: Exercise[]) => {
    if (!supabase || !user) return true

    const client = supabase
    const exerciseRows = nextExercises.map((exercise) => exerciseRow(exercise, user.id))
    const { data: currentRows } = await client.from('exercises').select('id').eq('user_id', user.id)
    const removedIds = (currentRows ?? []).map((row) => row.id).filter((id0) => !exerciseRows.some((row) => row.id === id0))
    if (removedIds.length) {
      const { error } = await client.from('exercises').delete().eq('user_id', user.id).in('id', removedIds)
      if (error) {
        console.error('exercise delete failed', error)
        return false
      }
    }
    if (exerciseRows.length) {
      const { error } = await client.from('exercises').upsert(exerciseRows)
      if (error) {
        console.error('exercise upsert failed', error)
        return false
      }
    }
    serverExerciseIdsRef.current = new Set(exerciseRows.map((row) => row.id))
    return true
  }, [user])
  const ensureScheduleDependencies = useCallback(async (nextSchedule: Day[], nextRuns: Run[], nextLogs: Log[], availablePlans: Plan[] = state.plans) => {
    if (!supabase || !user) return true

    const client = supabase
    const requiredExerciseIds = new Set([
      ...nextSchedule.flatMap((day0) => day0.items.map((item) => item.exerciseId)),
      ...nextLogs.map((entry) => entry.exerciseId),
    ])
    const exercisesToEnsure = state.exercises
      .filter((exercise) => requiredExerciseIds.has(exercise.id) && !serverExerciseIdsRef.current.has(exercise.id))
      .map((exercise) => exerciseRow(exercise, user.id))

    if (exercisesToEnsure.length) {
      const { error } = await client.from('exercises').upsert(exercisesToEnsure)
      if (error) {
        console.error('schedule dependency exercise upsert failed', error)
        return false
      }
      exercisesToEnsure.forEach((row) => serverExerciseIdsRef.current.add(row.id))
    }

    const requiredPlanIds = new Set(nextRuns.map((run) => run.planId).filter(Boolean))
    const plansToEnsure = availablePlans
      .filter((plan0) => requiredPlanIds.has(plan0.id) && !serverPlanIdsRef.current.has(plan0.id))
      .map((plan0) => ({
        id: plan0.id,
        user_id: user.id,
        name: plan0.name,
        focus: plan0.focus,
      }))

    if (plansToEnsure.length) {
      const { error } = await client.from('plans').upsert(plansToEnsure)
      if (error) {
        console.error('schedule dependency plan upsert failed', error)
        return false
      }
      plansToEnsure.forEach((row) => serverPlanIdsRef.current.add(row.id))
    }

    return true
  }, [state.exercises, state.plans, user])
  const persistPlans = useCallback(async (
    nextPlans: Plan[],
    options?: { changedPlanIds?: string[]; deletedPlanIds?: string[] },
  ) => {
    if (!supabase || !user) return true
    void options
    const planRows = nextPlans.map((plan0) => ({
      id: plan0.id,
      user_id: user.id,
      name: plan0.name,
      focus: plan0.focus,
    }))
    const dayRows = nextPlans.flatMap((plan0) => normalizePlanDaysData(plan0.days).map((day0, index) => ({
      id: day0.id,
      user_id: user.id,
      plan_id: plan0.id,
      day_number: index + 1,
      notes: day0.notes ?? '',
    })))
    const itemRows = nextPlans.flatMap((plan0) => normalizePlanDaysData(plan0.days).flatMap((day0) => day0.items.map((item) => ({
        id: item.id,
        user_id: user.id,
        plan_day_id: day0.id,
        exercise_id: item.exerciseId,
        type: item.type,
        target: item.target,
        ref: item.ref,
      }))))
    try {
      await savePlanSnapshot({ plans: planRows, days: dayRows, items: itemRows })
      serverPlanIdsRef.current = new Set(planRows.map((row) => row.id))
      return true
    } catch (error) {
      console.error('plan snapshot save failed', error)
      return false
    }
  }, [user])
  const writeScheduleData = useCallback(async (nextSchedule: Day[], nextRuns: Run[], nextLogs: Log[], availablePlans: Plan[], mode: 'changes' | 'full') => {
    if (!supabase || !user) return true

    const blockedBy = async () => {
      const reach = await checkReachability()
      if (reach === 'ok') return false
      saveBlockedRef.current = reach
      setScheduleSaveStatus(reach)
      return true
    }
    const dependenciesReady = await ensureScheduleDependencies(nextSchedule, nextRuns, nextLogs, availablePlans)
    if (!dependenciesReady) {
      if (!(await blockedBy())) setScheduleSaveStatus('error')
      return false
    }

    const rows = buildScheduleRows(nextSchedule, nextRuns, nextLogs, user.id, new Set(availablePlans.map((plan0) => plan0.id)))
    const saved = savedScheduleRowsRef.current
    setScheduleSaveStatus('saving')
    try {
      let written = false
      if (mode === 'changes' && saved && !changesEndpointMissingRef.current) {
        const changes = diffScheduleRows(saved, rows)
        if (scheduleChangeCount(changes) === 0) {
          setScheduleSaveStatus('saved')
          return true
        }
        try {
          scheduleServerRevisionRef.current = await saveScheduleChanges({ expectedRevision: scheduleServerRevisionRef.current, ...changes })
          written = true
        } catch (error) {
          // An API that predates incremental saves answers 404; fall back to a full snapshot until it's redeployed.
          if ((error as { context?: Response }).context?.status !== 404) throw error
          changesEndpointMissingRef.current = true
        }
      }
      if (!written) {
        scheduleServerRevisionRef.current = await saveScheduleSnapshot({ expectedRevision: scheduleServerRevisionRef.current, ...rows })
      }
      savedScheduleRowsRef.current = fingerprintScheduleRows(rows)
      saveBlockedRef.current = null
      setScheduleSaveStatus('saved')
      return true
    } catch (error) {
      const status = (error as { context?: Response }).context?.status
      console.error('schedule save failed', error)
      if (status === 409) setScheduleSaveStatus('conflict')
      else if (status !== undefined || !(await blockedBy())) setScheduleSaveStatus('error')
      return false
    }
  }, [ensureScheduleDependencies, user])
  const persistScheduleData = useCallback((nextSchedule: Day[], nextRuns: Run[], nextLogs: Log[], availablePlans: Plan[] = state.plans, mode: 'changes' | 'full' = 'changes') => {
    const run = scheduleSaveChainRef.current.then(() => writeScheduleData(nextSchedule, nextRuns, nextLogs, availablePlans, mode))
    scheduleSaveChainRef.current = run.catch(() => undefined)
    return run
  }, [state.plans, writeScheduleData])
  const commitPlans = async (
    nextPlans: Plan[],
    options?: { selectedPlanId?: string | null; changedPlanIds?: string[]; deletedPlanIds?: string[] },
  ) => {
    const previousPlans = state.plans
    const previousSelectedPlanId = selectedPlanId
    const normalizedPlans = nextPlans.map((plan0) => ({ ...plan0, days: normalizePlanDaysData(plan0.days) }))
    setState((current) => ({ ...current, plans: normalizedPlans }))
    const resolvedPlanId = options?.selectedPlanId === undefined ? selectedPlanId : options.selectedPlanId
    const nextPlan = normalizedPlans.find((plan0) => plan0.id === resolvedPlanId) ?? normalizedPlans[0] ?? null
    setSelectedPlanId(nextPlan?.id ?? null)
    setPlanForm(nextPlan ? formFromPlan(nextPlan) : emptyPlanForm())

    const ok = await persistPlans(normalizedPlans, {
      changedPlanIds: options?.changedPlanIds,
      deletedPlanIds: options?.deletedPlanIds,
    })
    if (!ok) {
      const previousPlan = previousPlans.find((plan0) => plan0.id === previousSelectedPlanId) ?? previousPlans[0] ?? null
      setState((current) => ({ ...current, plans: previousPlans }))
      setSelectedPlanId(previousPlan?.id ?? null)
      setPlanForm(previousPlan ? formFromPlan(previousPlan) : emptyPlanForm())
      pushToast('Could not save plans.')
      return false
    }

    return true
  }
  const queueSchedulePersist = useCallback((nextSchedule: Day[], nextRuns: Run[], nextLogs: Log[], nextPlans: Plan[]) => {
    if (scheduleSaveTimerRef.current) {
      window.clearTimeout(scheduleSaveTimerRef.current)
    }

    scheduleSaveTimerRef.current = window.setTimeout(() => {
      void persistScheduleData(nextSchedule, nextRuns, nextLogs, nextPlans).then((ok) => {
        if (!ok && !saveBlockedRef.current) {
          pushToast('Could not save schedule.')
        }
      })
      scheduleSaveTimerRef.current = null
    }, 250)
  }, [persistScheduleData])
  const commitScheduleState = async (nextSchedule: Day[], nextRuns: Run[], nextLogs: Log[], options?: { selectedDate?: string; persistMode?: 'queued' | 'immediate' }) => {
    const previous = localScheduleRef.current
    const normalizedSchedule = nextSchedule.map(normalizeScheduleDay)
    scheduleLoadRevisionRef.current += 1
    localScheduleRef.current = { schedule: normalizedSchedule, runs: nextRuns, logs: nextLogs }
    setState((current) => ({ ...current, schedule: normalizedSchedule, runs: nextRuns, logs: nextLogs }))
    if (options?.selectedDate) {
      setSelected(options.selectedDate)
      setMonth(monthKey(options.selectedDate))
    }
    if (options?.persistMode === 'immediate') {
      if (scheduleSaveTimerRef.current) {
        window.clearTimeout(scheduleSaveTimerRef.current)
        scheduleSaveTimerRef.current = null
      }
      const ok = await persistScheduleData(normalizedSchedule, nextRuns, nextLogs, state.plans)
      if (!ok && saveBlockedRef.current) {
        // Keep the edit on screen; it saves after signing in or reconnecting.
        pushToast(saveBlockedRef.current === 'signin' ? 'Your sign-in expired. Your change is kept — tap “Sign in to save” at the top.' : 'You’re offline. Your change is kept and saves when you reconnect.')
        return true
      }
      if (!ok) {
        localScheduleRef.current = previous
        setState((current) => ({ ...current, schedule: previous.schedule, runs: previous.runs, logs: previous.logs }))
        pushToast('Could not save schedule.')
        return false
      }
      return true
    }
    queueSchedulePersist(normalizedSchedule, nextRuns, nextLogs, state.plans)
    return true
  }
  const replaceWorkspaceState = async (next: State) => {
    const normalized = ensureAmpedData(next)
    const exercisesOk = await persistExercisesCollection(normalized.exercises)
    const deletedPlanIds = state.plans.map((plan0) => plan0.id).filter((id0) => !normalized.plans.some((plan0) => plan0.id === id0))
    const plansOk = exercisesOk ? await persistPlans(normalized.plans, { changedPlanIds: normalized.plans.map((plan0) => plan0.id), deletedPlanIds }) : false
    const scheduleOk = plansOk ? await persistScheduleData(normalized.schedule, normalized.runs, normalized.logs, normalized.plans, 'full') : false
    if (!exercisesOk || !plansOk || !scheduleOk) {
      pushToast('Could not replace app data.')
      return false
    }
    loadWorkspaceState(normalized)
    return true
  }
  useEffect(() => {
    if (!supabase || !user) return

    let active = true
    const client = supabase
    const ownerId = user.id
    const syncExercises = async () => {
      const baseColumns = 'id, kind, name, category, equipment, notes, default_type, allowed, target, refs, progress_metric'
      const loadExercises = (columns: string) => client.from('exercises').select(columns).eq('user_id', user.id).order('name', { ascending: true })
      let { data, error } = await loadExercises(`${baseColumns}, repeat_days`)
      // If the API hasn't been redeployed with habit repeat days yet, load without them instead of failing.
      if (error) ({ data, error } = await loadExercises(baseColumns))

      if (!active || authUserRef.current !== ownerId || error) return

      if (!data || data.length === 0) {
        const payload = starterExercises.map((exercise) => exerciseRow(exercise, user.id))
        const { error: seedError } = await client.from('exercises').upsert(payload)
        if (seedError || !active || authUserRef.current !== ownerId) return
        serverExerciseIdsRef.current = new Set(payload.map((row) => row.id))
        setState((current) => ({ ...current, exercises: starterExercises }))
        setSelectedExerciseId((current) => current ?? starterExercises[0]?.id ?? null)
        setExerciseEditorMode((current) => current === 'new' ? current : (starterExercises[0] ? 'existing' : 'new'))
        return
      }

      const remoteExercises = data.map(mapExerciseRow)
      if (authUserRef.current !== ownerId) return
      serverExerciseIdsRef.current = new Set(remoteExercises.map((exercise) => exercise.id))
      setState((current) => ({ ...current, exercises: remoteExercises }))
      setSelectedExerciseId((current) => current && remoteExercises.some((exercise) => exercise.id === current) ? current : remoteExercises[0]?.id ?? null)
      setExerciseEditorMode((current) => current === 'new' ? current : (remoteExercises[0] ? 'existing' : 'new'))
    }

    void syncExercises()

    return () => {
      active = false
    }
  }, [user, starterExercises])
  useEffect(() => {
    if (!supabase || !user || state.exercises.length === 0) return

    let active = true
    const client = supabase
    const ownerId = user.id
    const syncPlans = async () => {
      const { data: planRows, error: planError } = await client
        .from('plans')
        .select('id, name, focus')
        .eq('user_id', user.id)
        .order('name', { ascending: true })

      if (!active || authUserRef.current !== ownerId || planError) return

      if (!planRows || planRows.length === 0) {
        setState((current) => ({ ...current, plans: [] }))
        setSelectedPlanId(null)
        setPlanForm(emptyPlanForm())
        return
      }

      const planIds = planRows.map((row) => row.id)
      const [{ data: dayRows, error: dayError }, { data: itemRows, error: itemError }] = await Promise.all([
        client.from('plan_days').select('id, plan_id, day_number, notes').eq('user_id', user.id).in('plan_id', planIds).order('day_number', { ascending: true }),
        client.from('plan_items').select('id, plan_day_id, exercise_id, type, target, ref').eq('user_id', user.id),
      ])

      if (!active || authUserRef.current !== ownerId || dayError || itemError || !dayRows || !itemRows) return

      const remotePlans = mapPlanRows(planRows, dayRows, itemRows)
      if (authUserRef.current !== ownerId) return
      serverPlanIdsRef.current = new Set(remotePlans.map((plan0) => plan0.id))
      const activePlan = selectedPlanId ? remotePlans.find((plan0) => plan0.id === selectedPlanId) ?? remotePlans[0] ?? null : remotePlans[0] ?? null
      setState((current) => ({ ...current, plans: remotePlans }))
      setSelectedPlanId(activePlan?.id ?? null)
      if (activePlan) {
        setPlanForm(formFromPlan(activePlan))
      }
    }

    void syncPlans()

    return () => {
      active = false
    }
  }, [user, state.exercises.length, persistPlans, selectedPlanId])
  useEffect(() => {
    if (!supabase || !user || state.exercises.length === 0) return

    let active = true
    const client = supabase
    const ownerId = user.id
    const syncSchedule = async () => {
      const syncRevision = scheduleLoadRevisionRef.current
      const [{ data: runRows, error: runError }, { data: dayRows, error: dayError }, { data: itemRows, error: itemError }, { data: logRows, error: logError }, serverRevision] = await Promise.all([
        client.from('runs').select('id, plan_id, start_date, name, status, completed_at').eq('user_id', user.id).order('start_date', { ascending: true }),
        client.from('schedule_days').select('id, date, notes, skipped, run_id, day_no').eq('user_id', user.id).order('date', { ascending: true }),
        client.from('schedule_items').select('id, schedule_day_id, exercise_id, type, target, ref, done, result').eq('user_id', user.id),
        client.from('logs').select('id, source_item_id, exercise_id, date, type, target, result').eq('user_id', user.id).order('date', { ascending: true }),
        loadScheduleRevision(),
      ])

      if (!active || authUserRef.current !== ownerId || scheduleLoadRevisionRef.current !== syncRevision || runError || dayError || itemError || logError || !runRows || !dayRows || !itemRows || !logRows) return
      scheduleServerRevisionRef.current = serverRevision

      if (runRows.length === 0 && dayRows.length === 0 && itemRows.length === 0 && logRows.length === 0) {
        const localSchedule = localScheduleRef.current.schedule
        const localRuns = localScheduleRef.current.runs
        const localLogs = localScheduleRef.current.logs
        if (localSchedule.length === 0 && localRuns.length === 0 && localLogs.length === 0) return
        const seeded = await persistScheduleData(localSchedule, localRuns, localLogs)
        if (!seeded || !active || authUserRef.current !== ownerId || scheduleLoadRevisionRef.current !== syncRevision) return
        setState((current) => ({ ...current, schedule: localSchedule.map(normalizeScheduleDay), runs: localRuns, logs: localLogs }))
        return
      }

      const remoteRuns = mapRunRows(runRows)
      const remoteSchedule = mapScheduleRows(dayRows, itemRows)
      const remoteLogs = mapLogRows(logRows)
      if (authUserRef.current !== ownerId || scheduleLoadRevisionRef.current !== syncRevision) return
      const storedPlanIds = new Set(remoteRuns.map((run) => run.planId).filter((planId): planId is string => Boolean(planId)))
      savedScheduleRowsRef.current = fingerprintScheduleRows(buildScheduleRows(remoteSchedule.map(normalizeScheduleDay), remoteRuns, remoteLogs, ownerId, storedPlanIds))
      let pendingRaw: string | null = null
      try {
        pendingRaw = sessionStorage.getItem(PENDING_CHANGES_KEY)
        sessionStorage.removeItem(PENDING_CHANGES_KEY)
      } catch {
        pendingRaw = null
      }
      if (pendingRaw && !replayedPendingRef.current) {
        replayedPendingRef.current = true
        try {
          const pending = JSON.parse(pendingRaw) as { at: number; userId: string; changes: Parameters<typeof saveScheduleChanges>[0] }
          if (pending.userId === ownerId && Date.now() - pending.at < 86400000) {
            scheduleServerRevisionRef.current = await saveScheduleChanges({ ...pending.changes, expectedRevision: serverRevision })
            setPendingReplayNotice('Saved the change you made before signing in.')
            if (active) void syncSchedule()
            return
          }
        } catch (error) {
          console.error('replaying unsaved changes failed', error)
          setPendingReplayNotice('Couldn’t save the change from before you signed in. Please redo it.')
        }
      }
      setState((current) => ({ ...current, runs: remoteRuns, schedule: remoteSchedule, logs: remoteLogs }))
    }

    void syncSchedule()

    return () => {
      active = false
    }
  }, [user, state.exercises.length, persistScheduleData])
  const openDayFromCalendar = (date: string) => {
    openTab('schedule')
    focusDay(date)
  }
  const planSubNav = <div className="segmented subNav" role="group" aria-label="Plan sections">
    {([['plans', 'Program'], ['calendar', 'Calendar'], ['exercises', 'Library']] as const).map(([id0, label]) => <button key={id0} type="button" className={tab === id0 ? 'segment active' : 'segment'} aria-pressed={tab === id0} onClick={() => openTab(id0)}>{label}</button>)}
  </div>
  const focusDay = (date: string, jumpToDetail = false) => {
    setSelected(date)
    setMonth(monthKey(date))
    if (jumpToDetail) {
      window.setTimeout(() => dayDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40)
    }
  }
  const focusExerciseEditor = () => {
    window.setTimeout(() => exerciseDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40)
  }
  const focusPlanEditor = () => {
    window.setTimeout(() => planDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40)
  }
  const userAvatar = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? null
  // Remember unsaved edits across the sign-in redirect; they're replayed once the schedule reloads.
  const signInToSave = () => {
    const saved = savedScheduleRowsRef.current
    if (saved && user) {
      const current = localScheduleRef.current
      const changes = diffScheduleRows(saved, buildScheduleRows(current.schedule, current.runs, current.logs, user.id, new Set(state.plans.map((plan0) => plan0.id))))
      if (scheduleChangeCount(changes) > 0) {
        try {
          sessionStorage.setItem(PENDING_CHANGES_KEY, JSON.stringify({ at: Date.now(), userId: user.id, changes }))
        } catch (error) {
          console.error('could not keep unsaved changes', error)
        }
      }
    }
    startSignIn()
  }
  useEffect(() => {
    const onOnline = () => {
      if (saveBlockedRef.current === 'offline') void retryScheduleSave()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  })
  const retryScheduleSave = async () => {
    const current = localScheduleRef.current
    const ok = await persistScheduleData(current.schedule, current.runs, current.logs, state.plans)
    if (!ok) pushToast('The schedule still could not be saved.')
  }
  const signInWithGoogle = async () => {
    if (!supabase) return
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    })
    if (error) {
      pushToast('Google sign-in could not start.')
    }
  }
  const signOut = async () => {
    if (!supabase) return
    authUserRef.current = null
    savedScheduleRowsRef.current = null
    serverExerciseIdsRef.current = new Set()
    serverPlanIdsRef.current = new Set()
    setUser(null)
    loadWorkspaceState(signedOutState())
    const { error } = await supabase.auth.signOut()
    if (error) {
      pushToast('Could not sign out.')
      return
    }
    pushToast('Signed out.')
  }
  const saveDailyHealth = async () => {
    if (!supabase || !user || dailyHealthSaving) return
    const values = {
      calories: parseOptionalWholeNumber(dailyHealthDraft.calories),
      protein: parseOptionalWholeNumber(dailyHealthDraft.protein),
      carbs: parseOptionalWholeNumber(dailyHealthDraft.carbs),
      fat: parseOptionalWholeNumber(dailyHealthDraft.fat),
      steps: parseOptionalWholeNumber(dailyHealthDraft.steps),
      weight: parseOptionalNumber(dailyHealthDraft.weight),
    }
    const invalidField = (Object.entries(dailyHealthDraft) as Array<[keyof DailyHealthDraft, string]>).find(([field, raw]) => {
      if (!raw.trim()) return false
      const rawValue = parseOptionalNumber(raw)
      return rawValue === null || rawValue < 0 || (field === 'weight' && rawValue <= 0)
    })
    if (invalidField) {
      pushToast(`Check the ${invalidField[0]} value.`)
      return
    }

    setDailyHealthSaving(true)
    const healthId = `daily-health-${user.id}-${selected}`
    const { error: healthError } = await supabase.from('daily_health').upsert({
      id: healthId,
      user_id: user.id,
      date: selected,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago',
      calories_kcal: values.calories,
      protein_g: values.protein,
      carbs_g: values.carbs,
      fat_g: values.fat,
      steps: values.steps,
      nutrition_source: 'manual',
      steps_source: 'manual',
      synced_at: new Date().toISOString(),
      provenance: {
        entry: 'web',
        manual_fields: [
          dailyHealthDraft.calories.trim() && 'calories_kcal',
          dailyHealthDraft.protein.trim() && 'protein_g',
          dailyHealthDraft.carbs.trim() && 'carbs_g',
          dailyHealthDraft.fat.trim() && 'fat_g',
          dailyHealthDraft.steps.trim() && 'steps',
        ].filter(Boolean),
      },
    })
    const weightId = `body-weight-${user.id}-${selected}-manual`
    const weightResult = values.weight === null
      ? await supabase.from('body_weight_entries').delete().eq('id', weightId)
      : await supabase.from('body_weight_entries').upsert({
          id: weightId,
          user_id: user.id,
          measured_at: d(selected).toISOString(),
          local_date: selected,
          weight_lb: values.weight,
          source: 'manual',
          source_record_id: `manual-${selected}`,
        })
    setDailyHealthSaving(false)
    if (healthError || weightResult.error) {
      console.error('daily health save failed', healthError ?? weightResult.error)
      pushToast('Could not save daily numbers.')
      return
    }
    setDailyHealthDraft((current) => ({
      ...current,
      calories: wholeNumberText(values.calories),
      protein: wholeNumberText(values.protein),
      carbs: wholeNumberText(values.carbs),
      fat: wholeNumberText(values.fat),
      steps: wholeNumberText(values.steps),
    }))
    setOpenDaySections((current) => ({ ...current, health: false, coach: true }))
    pushToast('Daily numbers saved.')
  }

  const submitDailyReview = async () => {
    if (!supabase || !user || dailyReviewSubmitting) return
    setDailyReviewSubmitting(true)
    const { data, error } = await supabase.functions.invoke('submit-daily-review', { body: { date: selected } })
    setDailyReviewSubmitting(false)
    const review = dailyReviewFromPayload(data && typeof data === 'object' && 'review' in data ? data.review : null)
    if (error || !review) {
      console.error('daily review failed', error)
      pushToast(`${error?.message || 'The coach could not review this day.'}${error?.diagnosticId ? ` Reference ${error.diagnosticId.slice(0, 8)}.` : ''}`)
      return
    }
    setDailyReview(review)
    setCoachMessages([])
    pushToast(dailyReview ? 'Daily review refreshed.' : 'Daily review ready.')
  }

  const decideRecommendation = async (recommendationIndex: number, action: 'apply' | 'dismiss') => {
    if (!supabase || !user || !dailyReview || recommendationDecisionSaving[recommendationIndex]) return
    const recommendation = dailyReview.exercise_recommendations[recommendationIndex]
    const planAction = recommendation?.plan_action
    if (!recommendation || !planAction) return
    setRecommendationDecisionSaving((current) => ({ ...current, [recommendationIndex]: action }))
    const { data, error } = await supabase.functions.invoke('coach-recommendation', {
      body: {
        date: selected,
        recommendationIndex,
        action,
        scheduleItemId: planAction.schedule_item_id,
        expectedType: planAction.current_type,
        expectedTarget: planAction.current_target,
      },
    })
    setRecommendationDecisionSaving((current) => {
      const next = { ...current }
      delete next[recommendationIndex]
      return next
    })
    const payload = data && typeof data === 'object' ? data as Record<string, unknown> : null
    const review = dailyReviewFromPayload(payload?.review)
    if (error || !review) {
      pushToast(error?.message || 'Could not update this recommendation.')
      return
    }
    setDailyReview(review)
    const updatedItem = payload?.updatedItem
    if (updatedItem && typeof updatedItem === 'object') {
      const row = updatedItem as Record<string, unknown>
      if (typeof row.id === 'string' && typeof row.date === 'string' && typeof row.type === 'string' && validTargetTypes.has(row.type as TT) && row.target && typeof row.target === 'object') {
        setState((current) => ({
          ...current,
          schedule: current.schedule.map((scheduledDay) => scheduledDay.date !== row.date ? scheduledDay : {
            ...scheduledDay,
            items: scheduledDay.items.map((item) => item.id === row.id ? { ...item, type: row.type as TT, target: clone(row.target as Target) } : item),
          }),
        }))
      }
    }
    pushToast(action === 'apply' ? 'Next session updated.' : 'Recommendation dismissed.')
  }

  const sendCoachMessage = async () => {
    if (!supabase || !user || !dailyReview || coachSending || !coachDraft.trim()) return
    const message = coachDraft.trim()
    setCoachSending(true)
    const { data, error } = await supabase.functions.invoke('coach-message', { body: { date: selected, message } })
    setCoachSending(false)
    const messages = data && typeof data === 'object' && 'messages' in data && Array.isArray(data.messages)
      ? data.messages.filter((entry: unknown): entry is CoachMessage => Boolean(entry) && typeof entry === 'object')
      : []
    if (error || messages.length !== 2) {
      console.error('coach message failed', error)
      pushToast(`${error?.message || 'The coach could not answer right now.'}${error?.diagnosticId ? ` Reference ${error.diagnosticId.slice(0, 8)}.` : ''}`)
      return
    }
    setCoachDraft('')
    setCoachMessages((current) => [...current, ...messages])
  }

  const sendProgramCoachMessage = async () => {
    if (!supabase || !user || programCoachSending || !programCoachDraft.trim()) return
    const message = programCoachDraft.trim()
    setProgramCoachSending(true)
    const { data, error } = await supabase.functions.invoke('program-coach-message', {
      body: { asOfDate: today, message, lookbackDays: programCoachLookback },
    })
    setProgramCoachSending(false)
    const messages = data && typeof data === 'object' && 'messages' in data && Array.isArray(data.messages)
      ? data.messages.filter((entry: unknown): entry is ProgramCoachMessage => Boolean(entry) && typeof entry === 'object')
      : []
    if (error || messages.length !== 2) {
      console.error('program coach message failed', error)
      pushToast(`${error?.message || 'The program coach could not answer right now.'}${error?.diagnosticId ? ` Reference ${error.diagnosticId.slice(0, 8)}.` : ''}`)
      return
    }
    setProgramCoachDraft('')
    setProgramCoachMessages((current) => [...current, ...messages])
  }

  const createMobilePairing = async () => {
    if (!supabase || !user || mobilePairingLoading) return
    setMobilePairingLoading(true)
    const { data, error } = await supabase.functions.invoke('create-mobile-pairing')
    setMobilePairingLoading(false)
    if (error || !data || typeof data.code !== 'string' || typeof data.expiresAt !== 'string' || typeof data.syncUrl !== 'string') {
      pushToast('Could not create a phone pairing code.')
      return
    }
    setMobilePairing(data as MobilePairing)
  }

  const launchHealthSync = () => {
    const fallback = 'https://fitness.aparishhouse.com/downloads/discipline-plus-sync.apk'
    const android = /Android/i.test(navigator.userAgent)
    if (!android) {
      window.location.assign(fallback)
      return
    }
    sessionStorage.setItem(HEALTH_SYNC_DATE_KEY, selected)
    window.location.assign(`intent://fitness.aparishhouse.com/sync-health?date=${encodeURIComponent(selected)}#Intent;scheme=https;package=com.aparishhouse.disciplineplus.sync;S.browser_fallback_url=${encodeURIComponent(fallback)};end`)
  }

  const upsertDay = async (date: string, fx: (d0: Day) => Day) => {
    const base = state.schedule.find((x) => x.date === date) ?? { date, notes: '', rest: true, skipped: false, items: [] }
    const next = normalizeScheduleDay(fx(base))
    const nextSchedule = state.schedule.some((x) => x.date === date) ? state.schedule.map((x) => x.date === date ? next : x) : [...state.schedule, next]
    await commitScheduleState(nextSchedule, state.runs, state.logs)
  }

  const addExerciseToDay = async (exerciseId: string, date: string) => {
    const ex = exById[exerciseId]
    if (!ex) return
    const itemId = id('it')
    await upsertDay(date, (d0) => ({ ...d0, skipped: false, items: [...d0.items, { id: itemId, exerciseId, type: ex.defaultType, target: clone(ex.target), ref: ex.refs[0] ?? 'last-result', done: false, result: {} }] }))
    setOpenDaySections((current) => ({ ...current, [ex.kind === 'habit' ? 'habits' : 'workout']: true }))
    pushUndoToast(`Added ${ex.name}.`, () => undoActionsRef.current?.removeItem(date, itemId) ?? Promise.resolve())
  }
  // Item-level edits below read localScheduleRef so they're safe to call from an Undo long after the click.
  const removeItemOnDate = async (date: string, itemId: string): Promise<RemovedItem | null> => {
    const snap = localScheduleRef.current
    const dayEntry = snap.schedule.find((entry) => entry.date === date)
    const index = dayEntry ? dayEntry.items.findIndex((item) => item.id === itemId) : -1
    if (!dayEntry || index < 0) return null
    const removed = { item: dayEntry.items[index], index, log: snap.logs.find((entry) => entry.sourceItemId === itemId) }
    const nextSchedule = snap.schedule.map((entry) => entry.date === date ? normalizeScheduleDay({ ...entry, items: entry.items.filter((item) => item.id !== itemId) }) : entry)
    const ok = await commitScheduleState(nextSchedule, snap.runs, snap.logs.filter((entry) => entry.sourceItemId !== itemId), { persistMode: 'immediate' })
    return ok ? removed : null
  }
  const restoreItemOnDate = async (date: string, removed: RemovedItem) => {
    const snap = localScheduleRef.current
    if (snap.schedule.some((entry) => entry.items.some((item) => item.id === removed.item.id))) return true
    const base = snap.schedule.find((entry) => entry.date === date) ?? emptyScheduleDay(date)
    const items = [...base.items]
    items.splice(Math.min(removed.index, items.length), 0, removed.item)
    const nextDay = normalizeScheduleDay({ ...base, items })
    const nextSchedule = snap.schedule.some((entry) => entry.date === date) ? snap.schedule.map((entry) => entry.date === date ? nextDay : entry) : [...snap.schedule, nextDay]
    const nextLogs = removed.log ? [...snap.logs.filter((entry) => entry.id !== removed.log?.id), removed.log] : snap.logs
    return commitScheduleState(nextSchedule, snap.runs, nextLogs, { persistMode: 'immediate' })
  }
  const putItemOnDate = async (date: string, nextItem: Item) => {
    const snap = localScheduleRef.current
    if (!snap.schedule.some((entry) => entry.date === date && entry.items.some((item) => item.id === nextItem.id))) return false
    const nextSchedule = snap.schedule.map((entry) => entry.date === date ? normalizeScheduleDay({ ...entry, items: entry.items.map((item) => item.id === nextItem.id ? nextItem : item) }) : entry)
    return commitScheduleState(nextSchedule, snap.runs, syncLog(snap.logs, date, nextItem), { persistMode: 'immediate' })
  }
  const markItemIncomplete = async (item: Item, ex: Exercise) => {
    const date = selected
    const saved = await updateItem(item.id, (current) => ({ ...current, done: false }), { persistMode: 'immediate' })
    if (saved) pushUndoToast(`${ex.name} marked not done.`, () => undoActionsRef.current?.putItem(date, item) ?? Promise.resolve())
  }

  const updateItemOnDate = async (date: string, itemId: string, fx: (x: Item) => Item, options?: { persistMode?: 'queued' | 'immediate' }): Promise<boolean> => {
    let updatedItem: Item | undefined
    const hasDay = state.schedule.some((x) => x.date === date)
    const schedule = hasDay
      ? state.schedule.map((day0) => {
          if (day0.date !== date) return day0
          return normalizeScheduleDay({
            ...day0,
            items: day0.items.map((item) => {
              if (item.id !== itemId) return item
              updatedItem = fx(item)
              return updatedItem
            }),
          })
        })
      : [...state.schedule, normalizeScheduleDay({ date, notes: '', rest: true, skipped: false, items: [] })]
    if (!updatedItem) return false
    return commitScheduleState(schedule, state.runs, syncLog(state.logs, date, updatedItem), { persistMode: options?.persistMode })
  }
  const updateItem = async (itemId: string, fx: (x: Item) => Item, options?: { persistMode?: 'queued' | 'immediate' }): Promise<boolean> => updateItemOnDate(selected, itemId, fx, options)
  const removeItem = async (itemId: string, name: string) => {
    const date = selected
    const removed = await removeItemOnDate(date, itemId)
    if (removed) pushUndoToast(`Removed ${name}.`, () => undoActionsRef.current?.restoreItem(date, removed) ?? Promise.resolve())
  }
  const revokeMobileSync = async () => {
    if (!supabase || !user) return
    const { error } = await supabase.functions.invoke('revoke-mobile-sync')
    if (error) {
      pushToast('Could not disconnect the phone.')
      return
    }
    setMobileSyncStatus(null)
    setMobilePairing(null)
    pushToast('Android phone disconnected.')
  }
  const swapScheduleDays = async (sourceDate: string, targetDate: string, quiet = false) => {
    if (sourceDate === targetDate) {
      pushToast('Choose a different date to swap.')
      return
    }
    const sourceHasWorkout = dayByDate[sourceDate] ? hasWorkoutContent(dayByDate[sourceDate]) : false
    const targetHasWorkout = dayByDate[targetDate] ? hasWorkoutContent(dayByDate[targetDate]) : false
    const rawSwap = sourceHasWorkout || targetHasWorkout ? swapScheduleDates(state.schedule, state.logs, sourceDate, targetDate, normalizeScheduleDay) : null
    if (!rawSwap) {
      pushToast('Neither date has a workout scheduled.')
      return
    }
    const swapped = keepHabitsOnDates(state.schedule, rawSwap.schedule, rawSwap.logs)
    const nextSchedule = swapped.schedule

    const nextRuns = state.runs.map((run) => {
      const firstDate = nextSchedule
        .filter((entry) => entry.runId === run.id)
        .map((entry) => entry.date)
        .sort()[0]
      return firstDate && firstDate !== run.startDate ? { ...run, startDate: firstDate } : run
    })
    const saved = await commitScheduleState(nextSchedule, nextRuns, swapped.logs, { persistMode: 'immediate' })
    if (saved && !quiet) pushUndoToast(`Swapped ${fmtShort(sourceDate)} and ${fmtShort(targetDate)}.`, () => undoActionsRef.current?.swapDays(targetDate, sourceDate, true) ?? Promise.resolve())
  }
  const moveScheduleDay = async (sourceDate: string, targetDate: string, placement: 'before' | 'after') => {
    if (sourceDate === targetDate) return
    const ordered = state.schedule.filter(hasWorkoutContent).sort((a, b) => a.date.localeCompare(b.date))
    const habitOnlyDays = state.schedule.filter((entry) => !hasWorkoutContent(entry))
    const sourceIndex = ordered.findIndex((entry) => entry.date === sourceDate)
    const targetIndex = ordered.findIndex((entry) => entry.date === targetDate)
    if (sourceIndex < 0 || targetIndex < 0) return

    let insertIndex = targetIndex + (placement === 'after' ? 1 : 0)
    const reordered = [...ordered]
    const [movedDay] = reordered.splice(sourceIndex, 1)
    if (!movedDay) return
    if (sourceIndex < insertIndex) {
      insertIndex -= 1
    }
    reordered.splice(insertIndex, 0, movedDay)

    const orderedDates = ordered.map((entry) => entry.date)
    const itemDateMap = new Map<string, string>()
    const movedDayIndex = reordered.findIndex((entry) => entry === movedDay)
    const movedSchedule = reordered.map((entry, index) => {
      const nextDate = orderedDates[index]
      entry.items.forEach((item) => itemDateMap.set(item.id, nextDate))
      return normalizeScheduleDay({ ...entry, date: nextDate })
    })
    const movedLogs = state.logs.map((entry) => {
      if (!entry.sourceItemId) return entry
      const nextDate = itemDateMap.get(entry.sourceItemId)
      return nextDate ? { ...entry, date: nextDate } : entry
    })
    const { schedule: nextSchedule, logs: nextLogs } = keepHabitsOnDates(state.schedule, [...movedSchedule, ...habitOnlyDays], movedLogs)
    const movedSelectedDate = sourceDate === selected && movedDayIndex >= 0 ? orderedDates[movedDayIndex] : selected

    await commitScheduleState(nextSchedule, state.runs, nextLogs, { selectedDate: movedSelectedDate, persistMode: 'immediate' })
  }
  const clearScheduleDragState = () => {
    if (scheduleTouchHoldRef.current) {
      window.clearTimeout(scheduleTouchHoldRef.current)
      scheduleTouchHoldRef.current = null
    }
    scheduleTouchDragRef.current = null
    setDraggedScheduleDayDate(null)
    setScheduleMoveTarget(null)
  }
  const beginScheduleDrag = (date: string, pointerId: number, startX: number, startY: number) => {
    scheduleTouchDragRef.current = { sourceDate: date, active: true, pointerId, startX, startY }
    setDraggedScheduleDayDate(date)
    setScheduleMoveTarget({ date, placement: 'before' })
    suppressScheduleDayClickRef.current = true
  }
  const handleScheduleDayPointerDown = (event: ReactPointerEvent<HTMLDivElement>, date: string) => {
    const cardElement = event.currentTarget
    if (event.pointerType === 'mouse') {
      cardElement.setPointerCapture(event.pointerId)
    }
    if (scheduleTouchHoldRef.current) {
      window.clearTimeout(scheduleTouchHoldRef.current)
    }
    scheduleTouchDragRef.current = { sourceDate: date, active: false, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY }
    if (event.pointerType !== 'mouse') {
      scheduleTouchHoldRef.current = window.setTimeout(() => {
        if (cardElement.isConnected) {
          cardElement.setPointerCapture(event.pointerId)
        }
        beginScheduleDrag(date, event.pointerId, event.clientX, event.clientY)
      }, 260)
    }
  }
  const handleScheduleDayPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activeDrag = scheduleTouchDragRef.current
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - activeDrag.startX
    const deltaY = event.clientY - activeDrag.startY
    const movedEnough = Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6
    if (!activeDrag.active) {
      if (event.pointerType === 'mouse' && movedEnough) {
        beginScheduleDrag(activeDrag.sourceDate, event.pointerId, activeDrag.startX, activeDrag.startY)
      } else if (event.pointerType !== 'mouse' && movedEnough && scheduleTouchHoldRef.current) {
        window.clearTimeout(scheduleTouchHoldRef.current)
        scheduleTouchHoldRef.current = null
      }
    }
    if (!scheduleTouchDragRef.current?.active) return
    event.preventDefault()
    updateScheduleMoveTargetFromPoint(event.clientY)
  }
  const finishScheduleDayPointer = async (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (scheduleTouchHoldRef.current) {
      window.clearTimeout(scheduleTouchHoldRef.current)
      scheduleTouchHoldRef.current = null
    }
    const activeDrag = scheduleTouchDragRef.current
    if (!activeDrag || activeDrag.pointerId !== event.pointerId || !activeDrag.active) {
      scheduleTouchDragRef.current = null
      return
    }

    const sourceDate = activeDrag.sourceDate
    const target = scheduleMoveTarget
    clearScheduleDragState()
    if (target && target.date !== sourceDate) {
      await moveScheduleDay(sourceDate, target.date, target.placement)
    }
  }
  const saveItemDraft = async (item: Item, exercise: Exercise, markComplete = false) => {
    const draft = itemDrafts[item.id] ?? makeItemDraft(item, exercise)
    const nextResult: Result = {}
    const parsedSeconds = parseSecs(draft.timeText)
    const parsedWeight = draft.weightText.trim() ? Number(draft.weightText) : undefined
    const parsedCount = draft.countText.trim() ? Number(draft.countText) : undefined
    const supportsSetResults = (draft.type === 'sets' || draft.type === 'weighted') && (draft.target.sets ?? 0) > 0
    const parsedSetReps = supportsSetResults && draft.setRepsText.trim() ? parseSetReps(draft.setRepsText) : []

    if (parsedSetReps.some((reps) => !Number.isInteger(reps) || reps < 0)) {
      pushToast('Enter set reps like 8 / 8 / 7 / 7.')
      return
    }

    if (draft.note.trim()) nextResult.note = draft.note.trim()
    if (draft.timeText.trim()) {
      nextResult.seconds = parsedSeconds
      nextResult.timeText = parsedSeconds !== undefined ? fmtSecs(parsedSeconds) : draft.timeText
    }
    if (parsedWeight !== undefined && !Number.isNaN(parsedWeight)) nextResult.weight = parsedWeight
    if (parsedCount !== undefined && !Number.isNaN(parsedCount)) nextResult.count = parsedCount
    if (parsedSetReps.length) {
      nextResult.sets = parsedSetReps.map((reps) => ({ reps, ...(nextResult.weight !== undefined ? { weight: nextResult.weight } : {}) }))
      nextResult.count = parsedSetReps.reduce((total, reps) => total + reps, 0)
    }
    if (draft.difficulty) nextResult.difficulty = draft.difficulty

    const saved = await updateItem(item.id, (x) => ({
      ...x,
      type: draft.type,
      target: clone(draft.target),
      result: nextResult,
      done: markComplete ? true : x.done,
    }), { persistMode: 'immediate' })

    if (saved !== false) {
      setItemDrafts((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
      setExpandedItems((current) => ({ ...current, [item.id]: false }))

      if (markComplete && !item.done) {
        const progressMetric = effectiveProgressMetric(exercise, draft.type)
        const priorRows = derivedHistory
          .filter((historyItem) => historyItem.exerciseId === item.exerciseId && historyItem.done && historyItem.sourceItemId !== item.id)
        const candidate: Log = {
          id: 'candidate',
          exerciseId: item.exerciseId,
          date: selected,
          type: draft.type,
          target: clone(draft.target),
          result: {
            ...nextResult,
            count: progressMetric === 'count' ? (nextResult.count ?? totalCount(draft.target)) : nextResult.count,
          },
          done: true,
        }
        const bestBefore = bestProgressEntry(priorRows, exercise)
        const candidateMetric = metric(progressMetric, candidate)
        const bestMetric = bestBefore ? metric(progressMetric, bestBefore) : undefined
        pushToast(`${exercise.name} complete.`)
        if (candidateMetric !== undefined && (bestMetric === undefined || (progressMetric === 'time' ? candidateMetric < bestMetric : candidateMetric > bestMetric))) {
          pushToast(`New PB for ${exercise.name}.`)
        }
        const currentWorkout = (dayByDate[selected]?.items ?? []).filter((existing) => !isHabitItem(existing))
        const doneCount = currentWorkout.filter((existing) => existing.done).length + 1
        if (exercise.kind !== 'habit' && currentWorkout.length > 0 && doneCount === currentWorkout.length) {
          pushToast('Day complete. Keep it moving.')
          setOpenDaySections((current) => ({ ...current, workout: false, health: true }))
        }
      } else if (markComplete) {
        pushToast(`${exercise.name} result updated.`)
      }
    }
  }
  function loadWorkspaceState(next: State) {
    daySectionsDateRef.current = ''
    setState(next)
    const nextToday = key(new Date())
    setSelected(nextToday)
    setMonth(monthKey(nextToday))
    setSelectedExerciseId(next.exercises[0]?.id ?? null)
    setExerciseEditorMode(next.exercises[0] ? 'existing' : 'new')
    setExerciseForm(next.exercises[0] ? formFromExercise(next.exercises[0]) : emptyExerciseForm())
    setSelectedPlanId(null)
    setPlanForm(emptyPlanForm())
    setApplyPlanId(null)
    setApplyStartDate(nextToday)
    setItemDrafts({})
  }
  const saveProfile = async () => {
    if (!supabase || !user || profileSaving) return
    const thisYear = new Date().getFullYear()
    const birthYear = profileDraft.birthYear.trim() ? Number(profileDraft.birthYear) : null
    if (birthYear !== null && (!Number.isInteger(birthYear) || birthYear < thisYear - 100 || birthYear > thisYear - 13)) {
      pushToast('Check the birth year.')
      return
    }
    const feet = profileDraft.heightFeet.trim() ? Number(profileDraft.heightFeet) : 0
    const inches = profileDraft.heightInches.trim() ? Number(profileDraft.heightInches) : 0
    const heightInches = feet || inches ? feet * 12 + inches : null
    if (heightInches !== null && (!Number.isFinite(heightInches) || heightInches < 48 || heightInches > 96)) {
      pushToast('Check the height.')
      return
    }
    const trainingSince = /^\d{4}-\d{2}$/.test(profileDraft.trainingSince) ? profileDraft.trainingSince : null
    if (trainingSince && trainingSince > today.slice(0, 7)) {
      pushToast('Lifting since can’t be in the future.')
      return
    }
    setProfileSaving(true)
    // The table requires goal_name on every write (NOT NULL is checked before an upsert updates), so carry the current one along.
    const { data: existingRows } = await supabase.from('coaching_profiles').select('id, goal_name').eq('user_id', user.id)
    const existing = existingRows?.[0] as { id?: string; goal_name?: string } | undefined
    const { error } = await supabase.from('coaching_profiles').upsert({
      id: existing?.id ?? `coach-profile-${user.id}`,
      user_id: user.id,
      goal_name: existing?.goal_name ?? 'General fitness',
      birth_year: birthYear,
      sex: profileDraft.sex || null,
      height_inches: heightInches,
      powerblock_colors: profileDraft.powerblockColors,
      training_since: trainingSince,
    })
    setProfileSaving(false)
    if (error) {
      pushToast('Could not save your profile.')
      return
    }
    const next: CoachProfile = { birthYear, sex: profileDraft.sex || null, heightInches, powerblockColors: profileDraft.powerblockColors, trainingSince }
    setCoachProfile(next)
    setProfileDraft(profileDraftFrom(next))
    pushToast('Profile saved.')
  }
  const exportData = () => {
    const stamp = new Date().toISOString().slice(0, 10)
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `discipline-plus-backup-${stamp}.json`
    link.click()
    URL.revokeObjectURL(url)
    pushToast('Backup exported.')
  }
  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as LegacyState
      setPendingImport(parsed)
      setConfirmState({ kind: 'import-data', title: 'Import backup?', body: 'This will replace the current app data with the selected backup file.' })
    } catch {
      pushToast('Could not import that file.')
    } finally {
      event.target.value = ''
    }
  }
  const importData = async () => {
    if (!pendingImport) return
    await replaceWorkspaceState(ensureAmpedData(pendingImport))
    setPendingImport(null)
    pushToast('Backup imported.')
  }
  const clearPlanImport = () => {
    setImportAnalysis(null)
    setImportWorkbook(null)
    if (planImportInputRef.current) {
      planImportInputRef.current.value = ''
    }
  }
  const handlePlanSpreadsheetImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!supabase || !user) {
      pushToast('Sign in to import a spreadsheet into a plan.')
      event.target.value = ''
      return
    }
    try {
      setImportBusy(true)
      setImportAnalysis(null)
      const workbook = await workbookPreviewFromFile(file)
      if (workbook.sheets.length === 0) {
        pushToast('That spreadsheet did not contain readable rows.')
        return
      }
      const { data, error } = await supabase.functions.invoke('analyze-plan-sheet', {
        body: {
          fileName: workbook.fileName,
          sheets: workbook.sheets,
          catalog: state.exercises.map((exercise) => ({
            name: exercise.name,
            kind: exercise.kind,
            category: exercise.category,
            defaultType: exercise.defaultType,
          })),
        },
      })
      if (error) {
        let detail = error.message
        const context = (error as { context?: Response }).context
        if (context) {
          try {
            const payload = await context.json() as { error?: unknown; details?: unknown }
            detail = typeof payload.details === 'string'
              ? `${typeof payload.error === 'string' ? payload.error : 'Function error'} ${payload.details}`
              : typeof payload.error === 'string'
                ? payload.error
                : JSON.stringify(payload)
          } catch {
            try {
              detail = await context.text()
            } catch {
              detail = error.message
            }
          }
        }
        pushToast(`Could not analyze that spreadsheet. ${detail}`)
        return
      }
      if (data && typeof data === 'object' && 'error' in data) {
        const details = typeof (data as { details?: unknown }).details === 'string' ? ` ${(data as { details: string }).details}` : ''
        pushToast(`${String((data as { error: unknown }).error)}${details}`)
        return
      }
      const parsed = parsedAnalysisFromResponse(data)
      if (!parsed) {
        pushToast(`The spreadsheet analysis came back in an unexpected format. ${JSON.stringify(data).slice(0, 180)}`)
        return
      }
      setImportWorkbook(workbook)
      setImportAnalysis(parsed)
      pushToast('Spreadsheet analyzed. Review the plan preview below.')
    } catch {
      pushToast('Could not read that spreadsheet.')
    } finally {
      setImportBusy(false)
      event.target.value = ''
    }
  }
  const createPlanFromImport = async () => {
    if (!importAnalysis) return
    setImportBusy(true)
    try {
      const nextExercises = [...state.exercises]
      const exerciseIdByNormalizedName = new Map<string, string>(sortedExercises.map((exercise) => [normalizeCatalogName(exercise.name), exercise.id]))
      const importedGroups = new Map<string, { item: ImportedAnalysisItem; types: Set<TT>; sampleTarget?: Target }>()
      importAnalysis.items.forEach((item) => {
        importedGroups.set(normalizeCatalogName(item.name), { item, types: new Set([item.defaultType]) })
      })
      importAnalysis.days.forEach((day0) => {
        day0.items.forEach((item) => {
          const key = normalizeCatalogName(item.name)
          const existing = importedGroups.get(key)
          if (existing) {
            existing.types.add(item.type)
            existing.sampleTarget ??= item.target
          }
        })
      })

      for (const [normalizedName, entry] of importedGroups.entries()) {
        if (exerciseIdByNormalizedName.has(normalizedName)) continue
        const defaultType = safeImportedType(entry.item.kind, entry.item.defaultType)
        const createdExercise: Exercise = {
          id: id('ex'),
          kind: entry.item.kind,
          name: entry.item.name,
          category: entry.item.category || defaultCategoryForKind(entry.item.kind),
          equipment: entry.item.kind === 'habit' ? '' : 'Open',
          notes: entry.item.notes,
          defaultType,
          allowed: allowedTypesFromImportedItems(entry.item.kind, [...entry.types], defaultType),
          target: targetForType(defaultType, entry.sampleTarget ?? blank(defaultType)),
          refs: ['last-result', 'personal-best'],
          progressMetric: entry.item.kind === 'habit' && entry.item.progressMetric === 'weight' ? (defaultType === 'duration' ? 'time' : 'count') : entry.item.progressMetric,
        }
        nextExercises.push(createdExercise)
        exerciseIdByNormalizedName.set(normalizedName, createdExercise.id)
      }

      const nextPlan: Plan = {
        id: id('plan'),
        name: importPlanName(),
        focus: importAnalysis.summary,
        days: importAnalysis.days.map((day0, index) => ({
          id: id('pd'),
          label: day0.label || `Day ${index + 1}`,
          rest: day0.items.length === 0,
          notes: day0.notes,
          items: day0.items.map((item) => ({
            id: id('pi'),
            exerciseId: exerciseIdByNormalizedName.get(normalizeCatalogName(item.name)) ?? '',
            type: item.type,
            target: targetForType(item.type, item.target),
            ref: item.ref,
          })).filter((item) => item.exerciseId),
        })),
      }

      const exercisesOk = await persistExercisesCollection(nextExercises)
      if (!exercisesOk) {
        pushToast('Could not save imported items.')
        return
      }
      const plansOk = await persistPlans([...state.plans, nextPlan], { changedPlanIds: [nextPlan.id] })
      if (!plansOk) {
        pushToast('Could not create imported plan.')
        return
      }
      setState((current) => ({ ...current, exercises: nextExercises, plans: [...current.plans, nextPlan] }))
      setSelectedPlanId(nextPlan.id)
      setPlanForm(formFromPlan(nextPlan))
      clearPlanImport()
      focusPlanEditor()
      pushToast(`${nextPlan.name} created.`)
    } finally {
      setImportBusy(false)
    }
  }

  const openPlanScheduler = (planIdToApply: string) => {
    const runIds = new Set(state.runs.filter((run) => run.planId === planIdToApply).map((run) => run.id))
    const latestScheduledDate = state.schedule.filter((day0) => day0.runId && runIds.has(day0.runId)).map((day0) => day0.date).sort().at(-1)
    const startDate = latestScheduledDate ? add(latestScheduledDate, 1) : today
    setApplyPlanId(planIdToApply)
    setApplyStartDate(startDate)
    const extending = state.runs.some((run) => run.planId === planIdToApply && run.status === 'active')
    setApplyScheduleMode(extending ? 'end-date' : 'cycles')
    setApplyTargetMode('latest')
    setApplyCycleCount(1)
    setApplyEndDate(add(startDate, extending ? 13 : 59))
  }

  const schedulePlanCycles = async () => {
    if (!planToApply || applyPlanSaving) return
    if (applyPlanPreview.error) {
      pushToast(applyPlanPreview.error)
      return
    }
    if (applyPlanPreview.conflicts.length) {
      pushToast('Resolve the calendar conflicts before scheduling this plan.')
      return
    }
    setApplyPlanSaving(true)
    const made: Day[] = []
    const nextRuns: Run[] = []
    applyPlanPreview.cycles.forEach((cycle) => {
      const runId = id('run')
      nextRuns.push({ id: runId, planId: planToApply.id, startDate: cycle.startDate, name: `${planToApply.name} · Cycle ${cycle.cycleNumber} starting ${fmtShort(cycle.startDate)}`, status: 'active' })
      cycle.days.forEach(({ date, dayNo, planDay }) => made.push({
        date,
        notes: planDay.notes || `${planToApply.name} - ${planDay.label}`,
        rest: planDay.rest,
        skipped: false,
        runId,
        dayNo,
        items: planDay.items.map((item) => {
          const exercise = exById[item.exerciseId]
          const target = applyTargetMode === 'latest' && exercise
            ? continuedTargetFromLatest(derivedHistory, exercise, item.type, item.target, applyPlanPreview.startDate)
            : clone(item.target)
          return { id: id('it'), exerciseId: item.exerciseId, type: item.type, target, ref: item.ref, done: false, result: {} }
        }),
      }))
    })
    const saved = await commitScheduleState(mergeDaysByDate([...state.schedule, ...made]), [...state.runs, ...nextRuns], state.logs, { persistMode: 'immediate' })
    setApplyPlanSaving(false)
    if (!saved) return
    setApplyPlanId(null)
    pushToast(`${extendingPlan ? 'Extended' : 'Scheduled'} through ${fmtShort(applyPlanPreview.endDate)}${applyTargetMode === 'latest' ? ', starting from your latest results' : ' using plan defaults'}.`)
  }

  const shiftPlan = async () => {
    if (!day.runId || !shift || shift < 1) return
    const shiftDays = Math.min(99, Math.floor(shift))
    const nextDate = add(selected, shiftDays)
    const isShifted = (x: Day) => x.runId === day.runId && x.date >= selected
    const shiftedDates = new Set(state.schedule.filter(isShifted).map((x) => add(x.date, shiftDays)))
    const overlaps = state.schedule.filter((x) => !isShifted(x) && shiftedDates.has(x.date) && hasWorkoutContent(x)).map((x) => x.date).sort()
    if (overlaps.length) {
      pushToast(`Pushing forward would overlap other workouts on ${overlaps.slice(0, 3).map(fmtShort).join(', ')}${overlaps.length > 3 ? '…' : ''}.`)
      return
    }
    const shiftedItems = new Map<string, string>()
    const movedSchedule = state.schedule.map((x) => {
      if (isShifted(x)) {
        const shiftedDate = add(x.date, shiftDays)
        x.items.forEach((item) => shiftedItems.set(item.id, shiftedDate))
        return { ...x, date: shiftedDate }
      }
      return x
    })
    const movedLogs = state.logs.map((entry) => entry.sourceItemId && shiftedItems.has(entry.sourceItemId) ? { ...entry, date: shiftedItems.get(entry.sourceItemId)! } : entry)
    const pinned = keepHabitsOnDates(state.schedule, movedSchedule, movedLogs)
    await commitScheduleState(
      mergeDaysByDate(pinned.schedule),
      state.runs.map((r) => r.id === day.runId ? { ...r, startDate: r.startDate >= selected ? add(r.startDate, shiftDays) : r.startDate } : r),
      pinned.logs,
      { selectedDate: nextDate },
    )
  }

  const toggleSkippedDay = async () => upsertDay(selected, (d0) => ({ ...d0, skipped: !d0.skipped }))

  const addPlanDayAt = async (index: number) => {
    if (!plan) return
    const nextPlans = state.plans.map((p) => p.id === plan.id ? { ...p, days: normalizePlanDaysData([...p.days.slice(0, index), { id: id('pd'), label: '', rest: true, items: [] }, ...p.days.slice(index)]) } : p)
    await commitPlans(nextPlans, { selectedPlanId: plan.id, changedPlanIds: [plan.id] })
  }
  const updatePlanDay = async (dayId: string, fx: (x: PlanDay) => PlanDay) => {
    if (!plan) return
    const nextPlans = state.plans.map((p) => p.id === plan.id ? { ...p, days: normalizePlanDaysData(p.days.map((x) => x.id === dayId ? fx(x) : x)) } : p)
    await commitPlans(nextPlans, { selectedPlanId: plan.id, changedPlanIds: [plan.id] })
  }
  const addExerciseToPlanDay = async (dayId: string, exerciseId: string) => {
    const ex = exById[exerciseId]
    if (!ex) return
    await updatePlanDay(dayId, (pd) => ({ ...pd, items: [...pd.items, { id: id('pi'), exerciseId, type: ex.defaultType, target: clone(ex.target), ref: ex.refs[0] ?? 'last-result' }] }))
  }
  const updatePlanItem = async (dayId: string, itemId: string, fx: (x: PlanDay['items'][number]) => PlanDay['items'][number]) => {
    await updatePlanDay(dayId, (pd) => ({ ...pd, items: pd.items.map((x) => x.id === itemId ? fx(x) : x) }))
  }
  const removePlanItem = async (dayId: string, itemId: string) => {
    await updatePlanDay(dayId, (pd) => ({ ...pd, items: pd.items.filter((x) => x.id !== itemId) }))
  }
  const savePlanMeta = async () => {
    if (!selectedPlanId || !plan) return
    const nextPlans = state.plans.map((p) => p.id === selectedPlanId ? { ...p, name: planForm.name.trim() || p.name, focus: planForm.focus } : p)
    await commitPlans(nextPlans, { selectedPlanId, changedPlanIds: [selectedPlanId] })
    setPlanEditing(false)
  }
  const startNewPlan = async () => {
    const nextPlan: Plan = { id: id('plan'), name: 'New plan', focus: '', days: [] }
    await commitPlans([...state.plans, nextPlan], { selectedPlanId: nextPlan.id, changedPlanIds: [nextPlan.id] })
    setPlanEditing(true)
    focusPlanEditor()
  }
  const selectPlan = (nextPlanId: string) => {
    const nextPlan = state.plans.find((p) => p.id === nextPlanId)
    if (!nextPlan) return
    setSelectedPlanId(nextPlanId)
    setPlanForm(formFromPlan(nextPlan))
    setPlanEditing(false)
    focusPlanEditor()
  }
  const deletePlan = async (planId: string) => {
    const remainingPlans = state.plans.filter((p) => p.id !== planId)
    const removedRunIds = new Set(state.runs.filter((run) => run.planId === planId).map((run) => run.id))
    const removedItemIds = new Set<string>()

    state.schedule.forEach((day0) => {
      if (!day0.runId || !removedRunIds.has(day0.runId)) return
      day0.items.forEach((item) => removedItemIds.add(item.id))
    })

    const nextSchedule = state.schedule.filter((day0) => !day0.runId || !removedRunIds.has(day0.runId))
      .sort((a, b) => a.date.localeCompare(b.date))
    const nextRuns = state.runs.filter((run) => run.planId !== planId)
    const nextLogs = state.logs.filter((entry) => !entry.sourceItemId || !removedItemIds.has(entry.sourceItemId))
    const nextPlan = remainingPlans[0] ?? null

    const plansOk = await commitPlans(remainingPlans, { selectedPlanId: nextPlan?.id ?? null, deletedPlanIds: [planId] })
    if (!plansOk) return
    await commitScheduleState(nextSchedule, nextRuns, nextLogs)
  }
  const deleteExercise = async (exerciseId: string) => {
    if (supabase && user) {
      const client = supabase
      const { error } = await client.from('exercises').delete().eq('id', exerciseId).eq('user_id', user.id)
      if (error) {
        pushToast('Could not delete item.')
        return
      }
    }
    const remainingExercises = state.exercises.filter((exercise) => exercise.id !== exerciseId)
    const nextExercise = remainingExercises[0] ?? null
    setState((s) => ({
      ...s,
      exercises: s.exercises.filter((exercise) => exercise.id !== exerciseId),
      schedule: s.schedule.map((day) => normalizeScheduleDay({ ...day, items: day.items.filter((item) => item.exerciseId !== exerciseId) })),
      plans: s.plans.map((plan) => ({ ...plan, days: normalizePlanDaysData(plan.days.map((day) => ({ ...day, items: day.items.filter((item) => item.exerciseId !== exerciseId) }))) })),
      logs: s.logs.filter((entry) => entry.exerciseId !== exerciseId),
    }))
    setSelectedExerciseId(nextExercise?.id ?? null)
    setExerciseEditorMode(nextExercise ? 'existing' : 'new')
    setExerciseForm(nextExercise ? formFromExercise(nextExercise) : emptyExerciseForm())
  }
  const deleteRuns = async (runIds: string[], options?: { keepCompletedDays?: boolean }) => {
    const keepCompletedDays = options?.keepCompletedDays ?? false
    const removing = new Set(runIds)
    const removedItemIds = new Set<string>()
    const keptDays: Day[] = []

    state.schedule.forEach((day0) => {
      if (!day0.runId || !removing.has(day0.runId)) return
      const workout = day0.items.filter((item) => !isHabitItem(item))
      const isCompleted = workout.length > 0 && workout.every((item) => item.done)
      // Habits logged on program days belong to you, not the program, so they always stay.
      const keptItems = keepCompletedDays && isCompleted ? day0.items : day0.items.filter(isHabitItem)
      day0.items.filter((item) => !keptItems.includes(item)).forEach((item) => removedItemIds.add(item.id))
      if (keptItems.length) keptDays.push(normalizeScheduleDay({ ...day0, items: keptItems, runId: undefined, dayNo: undefined, skipped: false }))
    })

    const nextSchedule = [...state.schedule.filter((day0) => !day0.runId || !removing.has(day0.runId)), ...keptDays]
      .sort((a, b) => a.date.localeCompare(b.date))
    const nextRuns = state.runs.filter((run) => !removing.has(run.id))
    const nextLogs = state.logs.filter((entry) => !entry.sourceItemId || !removedItemIds.has(entry.sourceItemId))
    await commitScheduleState(nextSchedule, nextRuns, nextLogs)
  }
  const setRunStatus = async (runIdOrIds: string | string[], status: RunStatus) => {
    const runIds = new Set(Array.isArray(runIdOrIds) ? runIdOrIds : [runIdOrIds])
    const nextRuns = state.runs.map((run) => runIds.has(run.id)
      ? { ...run, status, completedAt: status === 'completed' ? new Date().toISOString() : undefined }
      : run)
    const saved = await commitScheduleState(state.schedule, nextRuns, state.logs, { persistMode: 'immediate' })
    if (saved) pushToast(status === 'completed' ? 'Program moved to past programs. Every logged day was kept.' : 'Program reopened.')
  }
  const resetAllData = async () => {
    await replaceWorkspaceState(ensureAmpedData(seed()))
    pushToast('App data reset.')
  }
  const resetScheduleData = async () => {
    await commitScheduleState([], [], state.logs.filter((entry) => !entry.sourceItemId), { selectedDate: today })
    pushToast('Schedule and runs cleared.')
  }
  const resetProgressData = async () => {
    await commitScheduleState(
      state.schedule.map((day0) => ({
        ...day0,
        items: day0.items.map((item) => ({ ...item, done: false, result: {} })),
      })),
      state.runs,
      [],
    )
    pushToast('Progress history cleared.')
  }
  const confirmAction = async () => {
    if (!confirmState) return
    if (confirmState.kind === 'delete-run') await deleteRuns(confirmState.runIds, { keepCompletedDays: keepCompletedPlanDays })
    if (confirmState.kind === 'delete-plan') await deletePlan(confirmState.planId)
    if (confirmState.kind === 'delete-exercise') await deleteExercise(confirmState.exerciseId)
    if (confirmState.kind === 'import-data') await importData()
    if (confirmState.kind === 'reset-all-data') await resetAllData()
    if (confirmState.kind === 'reset-schedule-data') await resetScheduleData()
    if (confirmState.kind === 'reset-progress-data') await resetProgressData()
    if (confirmState.kind === 'revoke-mobile-sync') await revokeMobileSync()
    setConfirmState(null)
  }
  const cancelConfirm = () => {
    if (confirmState?.kind === 'import-data') {
      setPendingImport(null)
    }
    if (confirmState?.kind === 'delete-plan' || confirmState?.kind === 'delete-run') {
      setKeepCompletedPlanDays(true)
    }
    setConfirmState(null)
  }
  const movePlanDay = async (targetDayId: string) => {
    if (!plan || !draggedPlanDayId || draggedPlanDayId === targetDayId) return
    const nextPlans = state.plans.map((p) => {
      if (p.id !== plan.id) return p
      const days = [...p.days]
      const from = days.findIndex((day) => day.id === draggedPlanDayId)
      const to = days.findIndex((day) => day.id === targetDayId)
      if (from < 0 || to < 0) return p
      const [moved] = days.splice(from, 1)
      days.splice(to, 0, moved)
      return { ...p, days: normalizePlanDaysData(days) }
    })
    await commitPlans(nextPlans, { selectedPlanId: plan.id, changedPlanIds: [plan.id] })
    setDraggedPlanDayId(null)
  }
  const deletePlanDay = async (dayId: string) => {
    if (!plan) return
    const nextPlans = state.plans.map((p) =>
      p.id === plan.id
        ? { ...p, days: normalizePlanDaysData(p.days.filter((day) => day.id !== dayId)) }
        : p,
    )
    await commitPlans(nextPlans, { selectedPlanId: plan.id, changedPlanIds: [plan.id] })
  }
  const duplicatePlanDay = async (dayId: string) => {
    if (!plan) return
    const dayIndex = plan.days.findIndex((day0) => day0.id === dayId)
    if (dayIndex < 0) return
    const sourceDay = plan.days[dayIndex]
    const duplicatedDay: PlanDay = {
      ...sourceDay,
      id: id('pd'),
      items: sourceDay.items.map((item) => ({ ...item, id: id('pi'), target: clone(item.target) })),
    }
    const nextPlans = state.plans.map((p) =>
      p.id === plan.id
        ? { ...p, days: normalizePlanDaysData([...p.days.slice(0, dayIndex + 1), duplicatedDay, ...p.days.slice(dayIndex + 1)]) }
        : p,
    )
    await commitPlans(nextPlans, { selectedPlanId: plan.id, changedPlanIds: [plan.id] })
  }

  const saveExercise = async () => {
    if (!exerciseForm.name.trim()) {
      pushToast('Give it a name first.')
      return false
    }
    const isEditingExisting = exerciseEditorMode === 'existing' && !!selectedExerciseId
    const nextExerciseId = isEditingExisting && selectedExerciseId ? selectedExerciseId : id('ex')
    const nextKind = sanitizeExerciseKind(exerciseForm.kind)
    const nextDefaultType = sanitizeExerciseDefaultType(nextKind, exerciseForm.defaultType)
    const nextProgressMetric = nextKind === 'habit' && exerciseForm.progressMetric === 'weight'
      ? (nextDefaultType === 'duration' ? 'time' : 'count')
      : exerciseForm.progressMetric
    const nextExercise: Exercise = {
      id: nextExerciseId,
      kind: nextKind,
      name: exerciseForm.name.trim(),
      category: exerciseForm.category || defaultCategoryForKind(nextKind),
      equipment: nextKind === 'habit' ? '' : (exerciseForm.equipment || 'Open'),
      notes: exerciseForm.notes,
      defaultType: nextDefaultType,
      allowed: sanitizeAllowedTypes(nextKind, exerciseForm.allowed, nextDefaultType),
      target: clone(nextDefaultType === exerciseForm.defaultType ? exerciseForm.target : blank(nextDefaultType)),
      refs: exerciseForm.refs,
      progressMetric: nextProgressMetric,
      repeatDays: nextKind === 'habit' ? sanitizeRepeatDays(exerciseForm.repeatDays) : [],
    }

    if (supabase && user) {
      const client = supabase
      const { error } = await client.from('exercises').upsert(exerciseRow(nextExercise, user.id))
      if (error) {
        pushToast('Could not save item.')
        return false
      }
      serverExerciseIdsRef.current.add(nextExercise.id)
    }

    setState((s) => ({
      ...s,
      exercises: isEditingExisting
        ? s.exercises.map((ex) => ex.id === selectedExerciseId ? nextExercise : ex)
        : [...s.exercises, nextExercise],
    }))

    setLibraryFilter(nextExercise.kind)
    setSelectedExerciseId(nextExercise.id)
    setExerciseEditorMode('existing')
    setExerciseForm(formFromExercise(nextExercise))
    pushToast(isEditingExisting ? `${nextExercise.name} saved.` : `${nextExercise.name} added to your library.`)
    return true
  }

  const switchLibraryFilter = (nextFilter: TK) => {
    setLibraryFilter(nextFilter)
    if (exerciseEditorMode === 'new') {
      setExerciseForm((current) => current.kind === nextFilter ? current : emptyExerciseForm(nextFilter))
      return
    }
    const nextExercise = sortedExercises.find((exercise) => exercise.kind === nextFilter) ?? null
    setSelectedExerciseId(nextExercise?.id ?? null)
    setExerciseEditorMode(nextExercise ? 'existing' : 'new')
    setExerciseForm(nextExercise ? formFromExercise(nextExercise) : emptyExerciseForm(nextFilter))
  }

  const startNewExercise = () => {
    setSelectedExerciseId(null)
    setExerciseEditorMode('new')
    setExerciseForm(emptyExerciseForm(libraryFilter))
    focusExerciseEditor()
  }

  const selectExercise = (exerciseId: string) => {
    const exercise = exById[exerciseId]
    if (!exercise) return
    setLibraryFilter(exercise.kind)
    setSelectedExerciseId(exerciseId)
    setExerciseEditorMode('existing')
    setExerciseForm(formFromExercise(exercise))
    focusExerciseEditor()
  }

  const openPicker = (kind: TK) => {
    setPickerQuery('')
    setDaySheet({ mode: 'add', kind })
  }
  const closeDaySheet = () => setDaySheet(null)
  const quickHabitResult = (type: TT, target: Target): Result => type === 'duration'
    ? { seconds: target.seconds, ...(target.seconds !== undefined ? { timeText: fmtSecs(target.seconds) } : {}) }
    : { count: totalCount(target) }
  const habitMeta = (habit: Exercise, type: TT, target: Target) => {
    const minutes = type === 'duration' && target.seconds !== undefined && target.seconds % 60 === 0 ? target.seconds / 60 : undefined
    const times = type === 'count' && target.countUnit !== 'steps' ? totalCount(target) : undefined
    const parts = [minutes !== undefined ? `${minutes} min` : times !== undefined ? `${times} time${times === 1 ? '' : 's'}` : workoutSummary(type, target)]
    if (habit.repeatDays?.length) {
      const stats = habitStats(habit.repeatDays, habitDoneDates.get(habit.id) ?? new Set(), today)
      if (stats.streak > 1) parts.push(`${stats.streak}-day streak`)
      parts.push(`${stats.weekDone}/${stats.weekDue} this week`)
    }
    return parts.join(' · ')
  }
  const addHabitToDay = async (habit: Exercise, date: string, done: boolean) => {
    const item: Item = {
      id: id('it'),
      exerciseId: habit.id,
      type: habit.defaultType,
      target: clone(habit.target),
      ref: habit.refs[0] ?? 'last-result',
      done,
      result: done ? quickHabitResult(habit.defaultType, habit.target) : {},
    }
    const base = state.schedule.find((entry) => entry.date === date) ?? emptyScheduleDay(date)
    const nextDay = normalizeScheduleDay({ ...base, items: [...base.items, item] })
    const nextSchedule = state.schedule.some((entry) => entry.date === date)
      ? state.schedule.map((entry) => entry.date === date ? nextDay : entry)
      : [...state.schedule, nextDay]
    const saved = await commitScheduleState(nextSchedule, state.runs, syncLog(state.logs, date, item), { persistMode: 'immediate' })
    if (!saved) return
    if (done) {
      pushUndoToast(`${habit.name} done.`, () => undoActionsRef.current?.removeItem(date, item.id) ?? Promise.resolve())
    } else {
      setItemDrafts((current) => ({ ...current, [item.id]: makeItemDraft(item, habit) }))
      setExpandedItems((current) => ({ ...current, [item.id]: true }))
    }
  }
  const toggleHabitItem = async (item: Item, habit: Exercise) => {
    if (item.done) {
      await markItemIncomplete(item, habit)
      return
    }
    const date = selected
    const saved = await updateItem(item.id, (current) => ({
      ...current,
      done: true,
      result: Object.keys(current.result).length ? current.result : quickHabitResult(current.type, current.target),
    }), { persistMode: 'immediate' })
    if (saved) pushUndoToast(`${habit.name} done.`, () => undoActionsRef.current?.putItem(date, item) ?? Promise.resolve())
  }
  const renderDayItem = (item: Item) => {
            const ex = exById[item.exerciseId]; if (!ex) return null
            const expanded = expandedItems[item.id] ?? false
            const draft = itemDrafts[item.id] ?? makeItemDraft(item, ex)
            const progressMetric = effectiveProgressMetric(ex, draft.type)
            const supportsSetResults = (draft.type === 'sets' || draft.type === 'weighted') && (draft.target.sets ?? 0) > 0
            const metricActions = ex.refs.map((r) => <button key={r} className="miniAction" onClick={() => setItemDrafts((current) => ({ ...current, [item.id]: applyReferenceToDraft(exerciseHistory(ex.id), ex, r, current[item.id] ?? makeItemDraft(item, ex)) }))}>{r === 'last-result' ? 'Last' : 'PB'} {referenceSummary(exerciseHistory(ex.id), ex, r, draft.type)}</button>)
            const lastResult = referenceSummary(exerciseHistory(ex.id), ex, 'last-result', draft.type)
            const loggedSets = item.done ? resultSetSummary(item.result) : ''
            const showPowerBlock = coachProfile.powerblockColors && ex.kind === 'exercise' && effectiveProgressMetric(ex, item.type) === 'weight'
            const previousLog = showPowerBlock ? exerciseHistory(ex.id).filter((entry) => entry.sourceItemId !== item.id).at(-1) : undefined
            const plannedWeight = item.done ? loggedWeight(item) : item.target.weight ?? (previousLog ? loggedWeight(previousLog) : undefined)
            const draftWeight = draft.weightText.trim() ? Number(draft.weightText) : plannedWeight
            return <article key={item.id} className={item.done ? 'workoutItem workoutItemDone' : 'workoutItem'}>
              <div className="workoutItemRow">
                <button className="workoutItemMain" onClick={() => {
                  if (!expanded) {
                    setItemDrafts((current) => current[item.id] ? current : { ...current, [item.id]: makeItemDraft(item, ex) })
                  }
                  setExpandedItems((current) => ({ ...current, [item.id]: !expanded }))
                }} aria-expanded={expanded}>
                  <div className="workoutItemHeading">
                    <h3>{ex.name}</h3>
                    {showPowerBlock && <PowerBlockBadge weight={plannedWeight} compact />}
                  </div>
                  <span className="workoutItemMeta">{ex.kind === 'habit' ? habitMeta(ex, item.type, item.target) : <>{loggedSets ? `Logged ${loggedSets}` : workoutSummary(item.type, item.target)}{lastResult !== 'none' ? ` · Last ${lastResult}` : ''}</>}</span>
                </button>
                {ex.kind === 'habit'
                  ? <button className={item.done ? 'logButton doneLogButton' : 'logButton'} aria-label={item.done ? `Mark ${ex.name} not done` : `Mark ${ex.name} done`} onClick={() => void toggleHabitItem(item, ex)}>{item.done ? '✓ Done' : 'Done'}</button>
                  : <button className={item.done ? 'logButton doneLogButton' : 'logButton'} onClick={() => {
                    if (!expanded) setItemDrafts((current) => current[item.id] ? current : { ...current, [item.id]: makeItemDraft(item, ex) })
                    setExpandedItems((current) => ({ ...current, [item.id]: !expanded }))
                  }}>{item.done ? '✓ Done' : 'Log'}</button>}
              </div>
              {expanded && <div className="loggerPanel">
                <div className="loggerHeading"><div><span className="fieldLabel">Log result</span><p>Target: {workoutSummary(draft.type, draft.target)}</p></div><button className="textButton" onClick={() => setExpandedItems((current) => ({ ...current, [item.id]: false }))}>Close</button></div>
                <div className="detailCompactRow resultRow">
                  {progressMetric === 'time' && <label className="field compactMetricField"><span>Time logged</span><input placeholder="mm:ss or minutes" value={draft.timeText} onChange={(e) => setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), timeText: e.target.value } }))} onBlur={() => setItemDrafts((current) => {
                    const activeDraft = current[item.id] ?? makeItemDraft(item, ex)
                    const parsed = parseSecs(activeDraft.timeText)
                    return { ...current, [item.id]: { ...activeDraft, timeText: parsed !== undefined ? fmtSecs(parsed) : activeDraft.timeText } }
                  })} /></label>}
                  {progressMetric === 'weight' && <label className="field compactMetricField"><span>Weight used</span><input type="text" inputMode="decimal" placeholder="0" value={draft.weightText} onChange={(e) => setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), weightText: e.target.value } }))} /></label>}
                  {progressMetric === 'weight' && showPowerBlock && <div className="powerBlockHint"><span>PowerBlock</span><PowerBlockBadge weight={draftWeight} /></div>}
                  {supportsSetResults && <label className="field setRepsField"><span>Reps by set</span><div className="setRepsInputWrap"><input ref={(node) => { setRepsInputRefs.current[item.id] = node }} type="text" inputMode="numeric" placeholder="8 / 8 / 7 / 7" value={draft.setRepsText} onChange={(e) => setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), setRepsText: e.target.value } }))} /><button type="button" className="setSeparatorButton" aria-label="Add separator between sets" onPointerDown={(event) => event.preventDefault()} onClick={() => {
                    let nextText = ''
                    setItemDrafts((current) => {
                    const activeDraft = current[item.id] ?? makeItemDraft(item, ex)
                    const trimmed = activeDraft.setRepsText.trimEnd().replace(/\/+$/, '').trimEnd()
                    nextText = trimmed ? `${trimmed} / ` : ''
                    return { ...current, [item.id]: { ...activeDraft, setRepsText: nextText } }
                    })
                    window.requestAnimationFrame(() => {
                      const input = setRepsInputRefs.current[item.id]
                      input?.focus()
                      input?.setSelectionRange(nextText.length, nextText.length)
                    })
                  }}>/</button></div></label>}
                  {progressMetric === 'count' && !supportsSetResults && draft.type !== 'duration' && draft.type !== 'for-time' && <label className="field compactMetricField"><span>Actual {countUnitLabel(draft.target)}</span><input type="text" inputMode="numeric" placeholder={`${totalCount(draft.target)}`} value={draft.countText} onChange={(e) => setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), countText: e.target.value } }))} /></label>}
                  <div className="targetActions">{metricActions}</div>
                </div>
                <label className="field compactDifficultyField"><span>How did it feel?</span><select value={draft.difficulty} onChange={(e) => setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), difficulty: e.target.value as '' | EffortRating } }))}><option value="">Not rated</option><option value="easy">Easy</option><option value="moderate">Moderate</option><option value="hard">Hard</option><option value="limit">At my limit</option></select></label>
                <label className="field"><span>Completion note</span><input value={draft.note} onChange={(e) => setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), note: e.target.value } }))} placeholder="Optional note for this day" /></label>
                <button className="primary completeExerciseButton" onClick={() => void saveItemDraft(item, ex, true)}>{item.done ? 'Update result' : ex.kind === 'habit' ? 'Complete habit' : 'Complete exercise'}</button>
                <details className="secondaryTools itemOptions">
                  <summary>Edit target & options</summary>
                  <div className="stack compactStack">
                    <div className="detailCompactRow targetEditRow">
                      <label className="field compactSelectField"><span>Target type</span><select value={draft.type} onChange={(e) => {
                        const nextType = e.target.value as TT
                        const nextTarget = blank(nextType)
                        setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), type: nextType, target: nextTarget, timeText: '', weightText: '', countText: '', setRepsText: nextTarget.sets && nextTarget.reps ? Array.from({ length: nextTarget.sets }, () => nextTarget.reps).join(' / ') : '', note: draft.note } }))
                      }}>{ex.allowed.map((t) => <option key={t} value={t}>{TT_LABEL[t]}</option>)}</select></label>
                      <TargetEditor type={draft.type} target={draft.target} layout="detail" durationIn={ex.kind === 'habit' ? 'minutes' : 'seconds'} onChange={(target) => setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), target } }))} />
                    </div>
                    <div className="nav">
                      <button className="pill" onClick={() => void saveItemDraft(item, ex)}>Save target</button>
                      {item.done && <button className="pill" onClick={() => void markItemIncomplete(item, ex)}>Mark not done</button>}
                      <button className="textButton dangerTextButton" onClick={() => void removeItem(item.id, ex.name)}>Remove from day</button>
                    </div>
                  </div>
                </details>
              </div>}
            </article>

  }

  useEffect(() => {
    if (!pendingReplayNotice) return
    pushToast(pendingReplayNotice)
    setPendingReplayNotice('')
  }, [pendingReplayNotice])
  useEffect(() => {
    undoActionsRef.current = {
      restoreItem: restoreItemOnDate,
      putItem: putItemOnDate,
      removeItem: removeItemOnDate,
      swapDays: swapScheduleDays,
    }
  })

  return (
    <div className="app">
      <header className="hero simpleHero appShellHeader">
        <div className="headerLead">
          <div className="brandLockup">
            <span className="brandMark" aria-hidden="true" />
            <h1>Discipline<span className="brandPlus">+</span></h1>
          </div>

          <div className="profileDock">
            {hasSupabaseEnv && user && scheduleSaveStatus !== 'idle' && <button
              className={`saveIndicator ${scheduleSaveStatus}`}
              type="button"
              aria-live="polite"
              onClick={() => scheduleSaveStatus === 'conflict' ? window.location.reload() : scheduleSaveStatus === 'signin' ? signInToSave() : scheduleSaveStatus === 'error' || scheduleSaveStatus === 'offline' ? void retryScheduleSave() : undefined}
              disabled={scheduleSaveStatus === 'saving' || scheduleSaveStatus === 'saved'}
              title={scheduleSaveStatus === 'conflict' ? 'Reload to reconcile changes from another tab or device.' : scheduleSaveStatus === 'error' ? 'Retry saving.' : undefined}
            >{{ saving: 'Saving…', saved: 'Saved', error: 'Save failed · Retry', conflict: 'Changed elsewhere · Reload', signin: 'Sign in to save', offline: 'Offline · Retry', idle: '' }[scheduleSaveStatus]}</button>}
            {hasSupabaseEnv && !user && !authLoading && <button className="pill authButton" onClick={signInWithGoogle}>Sign in</button>}
            {hasSupabaseEnv && user ? <button className={tab === 'settings' ? 'avatarButton activeAvatar' : 'avatarButton'} onClick={() => openTab('settings')} aria-label="Settings and profile">
              {userAvatar ? <img src={userAvatar} alt="" className="avatarImage" /> : <span className="avatarFallback">{(user.email ?? 'U').slice(0, 1).toUpperCase()}</span>}
            </button> : <button className={tab === 'settings' ? 'iconPill activeIconPill settingsButton' : 'iconPill settingsButton'} onClick={() => openTab('settings')} aria-label="Open settings">
              <svg className="settingsGlyph" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 8.7a3.3 3.3 0 1 0 0 6.6a3.3 3.3 0 0 0 0-6.6Zm9 3.3l-2.1-.7c-.1-.4-.2-.8-.4-1.2l1-2L17.9 6l-2 .9c-.4-.2-.8-.3-1.2-.4L14 4h-4l-.7 2.5c-.4.1-.8.2-1.2.4l-2-.9L4.5 8.1l1 2c-.2.4-.3.8-.4 1.2L3 12l.7 2.1c.1.4.2.8.4 1.2l-1 2L6.1 18l2-.9c.4.2.8.3 1.2.4L10 20h4l.7-2.5c.4-.1.8-.2 1.2-.4l2 .9l1.6-1.9l-1-2c.2-.4.3-.8.4-1.2L21 12Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>}
          </div>
        </div>

        <nav className="topNav" aria-label="Primary navigation">
          {(['schedule', 'progress', 'plans', 'coach'] as const).map((x) => {
            const active = x === 'plans' ? (PLAN_TABS as readonly string[]).includes(tab) : tab === x
            return <button key={x} className={active ? 'topNavButton active' : 'topNavButton'} aria-current={active ? 'page' : undefined} onClick={() => openTab(x)}>{{ schedule: 'Today', progress: 'Progress', plans: 'Plan', coach: 'Coach' }[x]}</button>
          })}
        </nav>
      </header>

      {tab === 'schedule' && <main className="todayPage">
        <section ref={dayDetailRef} className="panel stack scheduleDetailPanel">
          <WeekStrip selected={selected} today={today} statusFor={weekDayStatus} onSelect={(date) => focusDay(date)} />
          <div className="dayDetailHeader">
            <div className="dayDetailTopRow">
              <p className="eyebrow">{selected === today ? 'Today' : 'Workout'}</p>
              <button type="button" className="pill dayOptionsButton" onClick={() => setDaySheet({ mode: 'actions' })} aria-haspopup="dialog">Day options</button>
            </div>
            <h2>{fmtDay(selected)}</h2>
            {selectedDayPlanLabel && <p className="dayDetailMeta">{selectedDayPlanLabel}</p>}
          </div>
          {day.skipped && <p className="status warn">This plan day is marked skipped.</p>}
          {(habitTotal > 0 || hasHabitLibrary) && <section className={`dayFlowSection habitSection ${openDaySections.habits ? '' : 'collapsedSection'}`}>
            <button type="button" className="collapsibleSectionHeader" onClick={() => toggleDaySection('habits')} aria-expanded={openDaySections.habits} aria-controls="habit-section-content">
              <div><p className="eyebrow">Habits</p><h3>{habitTotal > 0 && habitDone === habitTotal ? 'All habits done' : 'Daily habits'}</h3></div>
              <div className="sectionHeaderStatus"><span>{habitTotal > 0 ? `${habitDone} of ${habitTotal}` : 'None today'}</span><span className="sectionChevron" aria-hidden="true">⌄</span></div>
            </button>
            {openDaySections.habits && <div id="habit-section-content" className="collapsibleSectionContent">
              <div className="workoutList">
                {habitItems.map(renderDayItem)}
                {dueHabits.map((habit) => <article key={`due-${habit.id}`} className="workoutItem">
                  <div className="workoutItemRow">
                    <button className="workoutItemMain" onClick={() => void addHabitToDay(habit, selected, false)} aria-label={`Log details for ${habit.name}`}>
                      <div className="workoutItemHeading"><h3>{habit.name}</h3></div>
                      <span className="workoutItemMeta">{habitMeta(habit, habit.defaultType, habit.target)}</span>
                    </button>
                    <button className="logButton" aria-label={`Mark ${habit.name} done`} onClick={() => void addHabitToDay(habit, selected, true)}>Done</button>
                  </div>
                </article>)}
              </div>
              <button type="button" className="addItemButton" onClick={() => openPicker('habit')}><span aria-hidden="true">+</span> Add habit</button>
            </div>}
          </section>}
          <section className={`dayFlowSection workoutSection ${openDaySections.workout ? '' : 'collapsedSection'}`}>
            <button type="button" className="collapsibleSectionHeader" onClick={() => toggleDaySection('workout')} aria-expanded={openDaySections.workout} aria-controls="workout-section-content">
              <div><p className="eyebrow">Workout</p><h3>{isRestDay ? 'Rest day' : `${workoutItems.length} exercise${workoutItems.length === 1 ? '' : 's'}`}</h3></div>
              <div className="sectionHeaderStatus"><span>{isRestDay ? 'Recovery' : workoutComplete ? 'Complete' : `${completedWorkoutItems} of ${workoutItems.length}`}</span><span className="sectionChevron" aria-hidden="true">⌄</span></div>
            </button>
            {openDaySections.workout && <div id="workout-section-content" className="collapsibleSectionContent">
          {isRestDay && <div className="restState">
            <span className="restIcon" aria-hidden="true">☾</span>
            <div><h3>Rest day</h3><p>Recover today. Your next session will be ready when you are.</p></div>
            {nextWorkoutDay && <button className="pill" onClick={() => focusDay(nextWorkoutDay.date, true)}>View next workout</button>}
          </div>}
          {!isRestDay && <>
            <div className="workoutList">{workoutItems.map(renderDayItem)}</div>
          </>}
          <button type="button" className="addItemButton" onClick={() => openPicker('exercise')}><span aria-hidden="true">+</span> Add exercise</button>
            </div>}
          </section>
          <section className={`dailyHealthCard ${openDaySections.health ? '' : 'collapsedSection'}`} aria-labelledby="daily-health-title">
            <button type="button" className="dailyHealthHeading collapsibleSectionHeader" onClick={() => toggleDaySection('health')} aria-expanded={openDaySections.health} aria-controls="daily-health-content">
              <div><p className="eyebrow">Daily numbers</p><h3 id="daily-health-title" className={dailyNumbersSummary ? 'dailySummaryLine' : undefined}>{dailyNumbersSummary || 'Nutrition, activity & weight'}</h3></div>
              <div className="sectionHeaderStatus"><span>{dailyNumbersSummary ? (openDaySections.health ? 'Close' : 'Edit') : 'Add'}</span><span className="sectionChevron" aria-hidden="true">⌄</span></div>
            </button>
            {openDaySections.health && <div id="daily-health-content" className="collapsibleSectionContent">
            {dailyHealthLoading ? <p className="mutedCopy">Loading daily numbers...</p> : <>
              <div className="dailyHealthGrid">
                {([
                  ['calories', 'Calories', 'kcal', 'numeric', 5],
                  ['protein', 'Protein', 'g', 'numeric', 4],
                  ['carbs', 'Carbs', 'g', 'numeric', 4],
                  ['fat', 'Fat', 'g', 'numeric', 4],
                  ['steps', 'Steps', '', 'numeric', 6],
                  ['weight', 'Weight', 'lb', 'decimal', 5],
                ] as const).map(([field, label, unit, inputMode, maxLength]) => <label key={field} className="field dailyMetricField"><span>{label}</span><div className="metricInputWrap"><input type="text" inputMode={inputMode} maxLength={maxLength} placeholder="—" value={dailyHealthDraft[field]} onChange={(event) => setDailyHealthDraft((current) => ({ ...current, [field]: event.target.value }))} />{unit && <small>{unit}</small>}</div></label>)}
              </div>
              <div className="dailyHealthActions">
                <div className="dailyHealthButtons">
                  <button className="primary" onClick={() => void saveDailyHealth()} disabled={dailyHealthSaving}>{dailyHealthSaving ? 'Saving...' : 'Save daily numbers'}</button>
                  <button className="pill syncHealthButton" onClick={launchHealthSync}>Sync health data</button>
                </div>
                <div className="syncStatusSummary">
                  {mobileSyncStatusLoading ? <p>Checking phone sync...</p> : mobileSyncStatus ? <>
                    <p><strong>Last health sync:</strong> {syncTimeLabel(mobileSyncStatus.last_sync_success_at ?? mobileSyncStatus.last_used_at)}</p>
                    {mobileSyncStatus.last_sync_status === 'missing_permission' && <p className="syncWarning">Automatic access needs attention in the helper.</p>}
                    {mobileSyncStatus.last_sync_status === 'failed' && <p className="syncWarning">Last attempt failed{mobileSyncStatus.last_sync_error ? `: ${mobileSyncStatus.last_sync_error}` : '.'}</p>}
                    {mobileSyncStatus.app_version && <small>{mobileSyncStatus.name} · Helper {mobileSyncStatus.app_version} · {mobileSyncStatus.background_permission ? 'Background access on' : 'Background access not confirmed'}</small>}
                  </> : <p>Pair the Android helper to sync Health Connect.</p>}
                </div>
              </div>
            </>}
            </div>}
          </section>
          <section className={`coachReviewCard ${openDaySections.coach ? '' : 'collapsedSection'}`} aria-labelledby="daily-review-title">
            <button type="button" className="coachReviewHeading collapsibleSectionHeader" onClick={() => toggleDaySection('coach')} aria-expanded={openDaySections.coach} aria-controls="daily-review-content">
              <div><p className="eyebrow">AI coach</p><h3 id="daily-review-title">Daily review</h3></div>
              <div className="sectionHeaderStatus">{dailyReview && <span className="sourceBadge">Saved</span>}<span className="sectionChevron" aria-hidden="true">⌄</span></div>
            </button>
            {openDaySections.coach && <div id="daily-review-content" className="collapsibleSectionContent">
            {dailyReviewLoading ? <p className="mutedCopy">Loading your saved review...</p> : dailyReview ? <>
              <div className="coachReviewBody">
                <h4>{dailyReview.headline}</h4>
                {dailyReview.overall && <p>{dailyReview.overall}</p>}
                <div className="coachReviewSections">
                  {dailyReview.training && <div><strong>Training</strong><p>{dailyReview.training}</p></div>}
                  {dailyReview.nutrition && <div><strong>Nutrition & activity</strong><p>{dailyReview.nutrition}</p></div>}
                  {dailyReview.trends && <div><strong>Trend</strong><p>{dailyReview.trends}</p></div>}
                  {dailyReview.tomorrow && <div><strong>Next up</strong><p>{dailyReview.tomorrow}</p></div>}
                </div>
                {dailyReview.action_items.length > 0 && <div className="coachActions"><strong>Do this next</strong><ul>{dailyReview.action_items.map((action, index) => <li key={`${action}-${index}`}>{action}</li>)}</ul></div>}
                {dailyReview.exercise_recommendations.length > 0 && <details className="coachExerciseRecommendations"><summary>Exercise recommendations</summary><div className="stack compactStack">{dailyReview.exercise_recommendations.map((recommendation, index) => {
                  const planAction = recommendation.plan_action
                  const currentSummary = planAction?.current_type && planAction.current_target ? workoutSummary(planAction.current_type, planAction.current_target) : ''
                  const proposedSummary = planAction?.proposed_type && planAction.proposed_target ? workoutSummary(planAction.proposed_type, planAction.proposed_target) : ''
                  const savingAction = recommendationDecisionSaving[index]
                  return <div key={`${recommendation.exercise}-${index}`} className={`coachRecommendationCard ${planAction?.status === 'dismissed' ? 'dismissedRecommendation' : ''}`}>
                    <div className="coachRecommendationHeading"><strong>{recommendation.exercise}</strong>{planAction && planAction.status !== 'pending' && <span className="recommendationStatus">{planAction.status === 'no_change' ? 'No change' : planAction.status}</span>}</div>
                    <p>{recommendation.recommendation}</p>
                    <small>{recommendation.reason}</small>
                    {planAction ? <div className="recommendationPlanAction">
                      {currentSummary && proposedSummary && <div className="targetChangePreview"><span>{planAction.next_date ? fmtShort(planAction.next_date) : 'Next session'}</span><strong>{currentSummary} → {proposedSummary}</strong></div>}
                      {!currentSummary && planAction.message && <p className="recommendationActionMessage">{planAction.message}</p>}
                      {(planAction.status === 'pending' || planAction.status === 'no_change' || planAction.status === 'unavailable') && <div className="recommendationButtons">
                        {planAction.can_apply && <button className="primary" onClick={() => void decideRecommendation(index, 'apply')} disabled={Boolean(savingAction)}>{savingAction === 'apply' ? 'Applying...' : 'Apply to next session'}</button>}
                        <button className="pill" onClick={() => void decideRecommendation(index, 'dismiss')} disabled={Boolean(savingAction)}>{savingAction === 'dismiss' ? 'Dismissing...' : 'Dismiss'}</button>
                      </div>}
                    </div> : <p className="recommendationActionMessage">Refresh this review to enable plan actions.</p>}
                  </div>
                })}</div></details>}
              </div>
              <button className="pill coachRefreshButton" onClick={() => void submitDailyReview()} disabled={dailyReviewSubmitting}>{dailyReviewSubmitting ? 'Reviewing...' : 'Refresh review'}</button>
              <div className="coachConversation">
                <div><strong>Ask the coach</strong><p>Follow up on this day, a recommendation, or your next session.</p></div>
                {coachMessages.length > 0 && <div className="coachMessages">{coachMessages.map((message) => <div key={message.id} className={`coachMessage ${message.role}`}><span>{message.role === 'assistant' ? 'Coach' : 'You'}</span><p>{message.content}</p></div>)}</div>}
                <div className="coachComposer"><textarea rows={2} value={coachDraft} onChange={(event) => setCoachDraft(event.target.value)} placeholder="Ask a follow-up..." maxLength={4000} /><button className="primary" onClick={() => void sendCoachMessage()} disabled={coachSending || !coachDraft.trim()}>{coachSending ? 'Thinking...' : 'Send'}</button></div>
              </div>
            </> : <div className="coachReviewEmpty">
              <p>When the day is ready, the coach will compare it with your recent training, nutrition, activity, weight trend, and saved coaching notes.</p>
              <button className="primary submitReviewButton" onClick={() => void submitDailyReview()} disabled={dailyReviewSubmitting}>{dailyReviewSubmitting ? 'Reviewing your day...' : 'Submit day for review'}</button>
              <small>Save any manual daily-number changes first. Workout results are saved as you log them.</small>
            </div>}
            </div>}
          </section>
        </section>
      </main>}

      {daySheet?.mode === 'add' && <Sheet title={daySheet.kind === 'habit' ? 'Add a habit' : 'Add an exercise'} subtitle={fmtDay(selected)} onClose={closeDaySheet}>
        <div className="nav sheetKindToggle">{(['exercise', 'habit'] as const).map((kind) => <button key={kind} type="button" className={daySheet.kind === kind ? 'pill active' : 'pill'} aria-pressed={daySheet.kind === kind} onClick={() => setDaySheet({ mode: 'add', kind })}>{TRACKABLE_KIND_LABEL[kind]}s</button>)}</div>
        <label className="field"><span className="srOnly">Search</span><input type="search" placeholder={daySheet.kind === 'habit' ? 'Search habits' : 'Search exercises'} value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} /></label>
        <div className="pickerList">
          {pickerItems.map((exercise) => {
            const last = exercise.kind === 'exercise' ? referenceSummary(exerciseHistory(exercise.id), exercise, 'last-result', exercise.defaultType) : 'none'
            return <button key={exercise.id} type="button" className="pickerRow" onClick={() => {
              closeDaySheet()
              void addExerciseToDay(exercise.id, selected)
            }}>
              <span className="pickerRowText"><strong>{exercise.name}</strong><span>{exercise.category}{last !== 'none' ? ` · Last ${last}` : ''}</span></span>
              {onSelectedDay.has(exercise.id) ? <span className="kindBadge subtleBadge">On this day</span> : <span className="pickerAdd" aria-hidden="true">+</span>}
            </button>
          })}
          {pickerItems.length === 0 && <p className="mutedCopy">Nothing matches. Create it in the Library first.</p>}
        </div>
        {daySheet.kind === 'habit' && <p className="mutedCopy sheetFootnote">Want a habit every day? Set <strong>Repeat on</strong> in the <button type="button" className="textButton inlineTextButton" onClick={() => { closeDaySheet(); switchLibraryFilter('habit'); openTab('exercises') }}>Library</button> and it will show up on its own.</p>}
      </Sheet>}

      {daySheet?.mode === 'actions' && <Sheet title="Day options" subtitle={fmtDay(selected)} onClose={closeDaySheet}>
        <div className="sheetGroup">
          <label className="field"><span>Notes</span><textarea className="shortTextarea" rows={2} placeholder="Optional notes for this day" value={day.notes} onChange={(e) => upsertDay(selected, (d0) => ({ ...d0, notes: e.target.value }))} /></label>
        </div>
        <div className="sheetGroup">
          <div className="sheetGroupText"><strong>Swap with another day</strong><p>Trades this day’s workout with the date you pick. Habits stay on their own dates.</p></div>
          <div className="sheetInlineRow">
            <label className="field sheetDateField"><span className="srOnly">Date to swap with</span><input type="date" value={swapDate} onChange={(event) => setSwapDate(event.target.value)} /></label>
            <button type="button" className="primary" onClick={() => { closeDaySheet(); void swapScheduleDays(selected, swapDate) }} disabled={!swapDate || swapDate === selected}>Swap</button>
          </div>
        </div>
        {day.runId && <div className="sheetGroup">
          <div className="sheetGroupText"><strong>{day.skipped ? 'Unskip this plan day' : 'Skip this plan day'}</strong><p>{day.skipped ? 'Puts it back to normal.' : 'Marks it skipped without moving anything else.'}</p></div>
          <button type="button" className="pill" onClick={() => { closeDaySheet(); void toggleSkippedDay() }}>{day.skipped ? 'Unskip' : 'Skip day'}</button>
        </div>}
        {day.runId && <div className="sheetGroup">
          <div className="sheetGroupText"><strong>Push the program back</strong><p>Moves this day and every later day of this program forward.</p></div>
          <div className="sheetInlineRow">
            <label className="field pushDaysField"><input type="number" min={1} max={99} inputMode="numeric" value={numberInputValue(shift)} onChange={(e) => setShift(parseNumberInput(e.target.value))} aria-label="Days to push forward" /><span>days</span></label>
            <button type="button" className="pill" onClick={() => { closeDaySheet(); void shiftPlan() }} disabled={!shift || shift < 1}>Push</button>
          </div>
        </div>}
      </Sheet>}

      {confirmState && <div className="overlay">
        <div className="confirmCard">
          <h3>{confirmState.title}</h3>
          <p>{confirmState.body}</p>
          {confirmState.kind === 'delete-run' && <label className="inline confirmOption">
            <input type="checkbox" checked={keepCompletedPlanDays} onChange={(e) => setKeepCompletedPlanDays(e.target.checked)} />
            <span>Keep already completed scheduled days as standalone history</span>
          </label>}
          <div className="nav">
            <button className="primary" onClick={confirmAction}>Confirm</button>
            <button className="pill" onClick={cancelConfirm}>Cancel</button>
          </div>
        </div>
      </div>}

      <div className={daySheet || confirmState ? 'toastStack toastStackTop' : 'toastStack'} aria-live="polite">
        {toasts.map((toast) => <div key={toast.id} className={toast.action ? 'toast toastWithAction' : 'toast'}>
          <span>{toast.message}</span>
          {toast.action && <button type="button" className="toastAction" onClick={() => {
            setToasts((current) => current.filter((entry) => entry.id !== toast.id))
            toast.action?.run()
          }}>{toast.action.label}</button>}
        </div>)}
      </div>

      {tab === 'calendar' && <main className="stack planGroupPage">
        {planSubNav}
        <section className="panel scheduleCalendarPanel">
          <div className="row scheduleOverviewHeader">
            <div><p className="eyebrow">Calendar</p><h3>Your schedule</h3><p className="mutedCopy">Tap a day to open it. In the list, press and hold a day to drag it somewhere else.</p></div>
          </div>
          <div className="scheduleBrowser stack">
          <div className="nav scheduleToggle">{(['calendar', 'list'] as const).map((x) => <button key={x} className={scheduleView === x ? 'pill active' : 'pill'} onClick={() => { setScheduleView(x); if (x === 'list') setVisibleListCount(5) }}>{x === 'calendar' ? 'Month' : 'List'}</button>)}</div>
          {scheduleView === 'calendar' ? <div className="calendarWrap">
            <div className="row"><button className="pill" onClick={() => setMonth(add(month, -28))}>Previous</button><h3>{fmtMonth(month)}</h3><button className="pill" onClick={() => setMonth(add(month, 35))}>Next</button></div>
            <div className="week">{DAYS.map((x) => <span key={x}>{x}</span>)}</div>
            <div className="calendar">{monthDays.map((date) => {
              const x = dayByDate[date], sameMonth = date.startsWith(month.slice(0, 7))
              const workout = x ? x.items.filter((i) => !isHabitItem(i)) : []
              const isComplete = workout.length > 0 && workout.every((i) => i.done)
              const isRest = workout.length === 0
              return <button key={date} className={['day', date === selected && 'selected', date === today && 'todayMark', !sameMonth && 'dim', isComplete && 'completeDay'].filter(Boolean).join(' ')} onClick={() => openDayFromCalendar(date)}>
                <span>{d(date).getDate()}</span>
                <small>{x?.skipped ? 'Skipped' : isRest ? 'Rest' : isComplete ? 'Done' : `${workout.filter((i) => i.done).length}/${workout.length}`}</small>
              </button>
            })}</div>
          </div> : <div className="stack">{visibleDays.map((x) => {
            const workout = x.items.filter((i) => !isHabitItem(i))
            const habitsLogged = x.items.filter((i) => isHabitItem(i) && i.done).length
            const isComplete = workout.length > 0 && workout.every((i) => i.done)
            const isRest = workout.length === 0
            const planLabel = scheduledPlanLabel(x, state.runs, state.plans)
            const isDragging = draggedScheduleDayDate === x.date
            const beforeTargetOn = !!draggedScheduleDayDate && draggedScheduleDayDate !== x.date && scheduleMoveTarget?.date === x.date && scheduleMoveTarget.placement === 'before'
            const afterTargetOn = !!draggedScheduleDayDate && draggedScheduleDayDate !== x.date && scheduleMoveTarget?.date === x.date && scheduleMoveTarget.placement === 'after'
            const sourceIndex = visibleDays.findIndex((day0) => day0.date === draggedScheduleDayDate)
            const targetIndex = scheduleMoveTarget ? visibleDays.findIndex((day0) => day0.date === scheduleMoveTarget.date) : -1
            const insertIndex = targetIndex < 0 ? -1 : targetIndex + (scheduleMoveTarget?.placement === 'after' ? 1 : 0)
            const currentIndex = visibleDays.findIndex((day0) => day0.date === x.date)
            const shiftUp = sourceIndex >= 0 && insertIndex > sourceIndex && currentIndex > sourceIndex && currentIndex < insertIndex
            const shiftDown = sourceIndex >= 0 && insertIndex >= 0 && insertIndex <= sourceIndex && currentIndex >= insertIndex && currentIndex < sourceIndex
            return <div
              key={x.date}
              className="agendaItemShell"
            >
              <div className={beforeTargetOn ? 'agendaInsertionLine activeInsertionLine' : 'agendaInsertionLine'} />
              <div
                data-schedule-card-date={x.date}
                ref={(node) => { scheduleCardRefs.current[x.date] = node }}
                className={[x.date === selected ? 'listItem activeItem agendaItem' : 'listItem agendaItem', isComplete ? 'completeDay' : '', isDragging ? 'draggingAgendaItem' : '', shiftUp ? 'agendaShiftUp' : '', shiftDown ? 'agendaShiftDown' : ''].filter(Boolean).join(' ')}
                onClick={() => {
                  if (draggedScheduleDayDate) return
                  if (suppressScheduleDayClickRef.current) {
                    suppressScheduleDayClickRef.current = false
                    return
                  }
                  openDayFromCalendar(x.date)
                }}
                onPointerDown={(event) => handleScheduleDayPointerDown(event, x.date)}
                onPointerMove={handleScheduleDayPointerMove}
                onPointerUp={(event) => { void finishScheduleDayPointer(event) }}
                onPointerCancel={() => clearScheduleDragState()}
              >
                <div className="agendaDateRow">
                  <div className="agendaOpenButton">
                    <strong>{fmtDay(x.date)}{planLabel && <span className="inlineDateMeta"> | {planLabel}</span>}</strong>
                    <span>{x.skipped ? 'Skipped' : isRest ? 'Rest' : isComplete ? 'Done' : `${workout.filter((i) => i.done).length}/${workout.length}`}</span>
                  </div>
                </div>
                {isRest ? <p className="mutedCopy">- Rest day{habitsLogged ? ` · ${habitsLogged} habit${habitsLogged === 1 ? '' : 's'} done` : ''}</p> : <div className="agendaBullets">
                  {workout.map((item) => {
                    const ex = exById[item.exerciseId]
                    if (!ex) return null
                    return <div key={item.id} className="agendaBullet">- {ex.name} | {sum(item.type, item.target)}</div>
                  })}
                  {habitsLogged > 0 && <div className="agendaBullet mutedCopy">- {habitsLogged} habit{habitsLogged === 1 ? '' : 's'} done</div>}
                </div>}
              </div>
              <div className={afterTargetOn ? 'agendaInsertionLine activeInsertionLine' : 'agendaInsertionLine'} />
            </div>
          })}</div>}
          {scheduleView === 'list' && <div className="nav loadMoreRow">
            {!showPastDays && pastDays.length > 0 && <button className="pill" onClick={() => { setShowPastDays(true); setVisibleListCount((current) => current + pastDays.length) }}>Load previous</button>}
            {listDays.length > visibleListCount && <button className="pill" onClick={() => setVisibleListCount((current) => current + 5)}>Load 5 more</button>}
          </div>}
          </div>
        </section>
      </main>}

      {tab === 'coach' && <main className="coachPage">
        <section className="panel programCoachPanel">
          <div className="programCoachHeader">
            <div><p className="eyebrow">Program coach</p><h2>Ask about the big picture</h2></div>
            <div className="segmented" role="group" aria-label="How much history to look at">
              {([28, 56, 84] as const).map((days) => <button key={days} type="button" className={programCoachLookback === days ? 'segment active' : 'segment'} aria-pressed={programCoachLookback === days} onClick={() => setProgramCoachLookback(days)}>{days / 7} wk</button>)}
            </div>
          </div>
          {programCoachLoading ? <div className="coachReviewEmpty"><p>Loading your conversation...</p></div> : <div className="programCoachConversation">
            {programCoachMessages.length === 0 ? <div className="programCoachEmpty">
              <p className="mutedCopy">Ask about exercise choices, progression, weekly structure, recovery, or whether your program should change. Try one of these:</p>
              <div className="programCoachStarters">
                {["Review my overall program now that I’m finishing my first four weeks.", 'Are these still the right exercises for my goal and equipment?', 'Should I change my number of lifting or cardio days?'].map((prompt) => <button key={prompt} type="button" className="starterPrompt" onClick={() => setProgramCoachDraft(prompt)}>{prompt}</button>)}
              </div>
            </div> : <div className="coachMessages programCoachMessages">{programCoachMessages.map((message) => <div key={message.id} className={`coachMessage ${message.role}`}><span>{message.role === 'assistant' ? 'Coach' : 'You'}{message.lookback_days ? ` · ${message.lookback_days / 7} wk` : ''}</span><p>{message.content}</p></div>)}</div>}
            <div className="programCoachComposer">
              <textarea rows={2} value={programCoachDraft} onChange={(event) => setProgramCoachDraft(event.target.value)} placeholder="Ask the coach…" maxLength={4000} aria-label="Message to the coach" />
              <button className="primary" onClick={() => void sendProgramCoachMessage()} disabled={programCoachSending || !programCoachDraft.trim()}>{programCoachSending ? 'Thinking…' : 'Send'}</button>
            </div>
            <details className="howItWorks">
              <summary>What the coach sees</summary>
              <p>Each question includes fresh app data: your plans and programs, every completed result, workout notes, nutrition and steps, weight trend, goals, equipment, safety notes, and recent daily reviews. Advice only — it won’t change your plan unless you choose to.</p>
            </details>
          </div>}
        </section>
      </main>}

      {tab === 'exercises' && <main className="stack planGroupPage">
        {planSubNav}
        <section className="panel stack">
          <div className="row">
            <div><p className="eyebrow">Library</p><h2>Find an item</h2></div>
            <button className="primary" onClick={() => { startNewExercise(); setLibraryEditorOpen(true) }}>New {libraryFilter}</button>
          </div>
          <div className="nav">
            {(['exercise', 'habit'] as const).map((kind) => <button key={kind} className={libraryFilter === kind ? 'pill active' : 'pill'} onClick={() => switchLibraryFilter(kind)}>{TRACKABLE_KIND_LABEL[kind]}s</button>)}
          </div>
          <label className="field librarySearch"><span>Search</span><input type="search" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder={`Search ${libraryFilter}s`} /></label>
          <div className="stack compactLibraryList">
            {filteredLibraryExercises.length === 0 && <div className="empty compactEmpty">No matching items.</div>}
            {Array.from(new Set(filteredLibraryExercises.map((ex) => ex.category))).sort(compareStrings).map((category) => <div key={category} className="libraryGroup">
              <p className="libraryGroupTitle">{category}</p>
              {filteredLibraryExercises.filter((ex) => ex.category === category).map((ex) => <button key={ex.id} className="libraryRow" onClick={() => { selectExercise(ex.id); setLibraryEditorOpen(true) }}>
                <span className="listItemContent"><strong>{ex.name}</strong>{ex.kind === 'habit' && ex.repeatDays?.length ? <span className="listMeta">{ex.repeatDays.length === 7 ? 'Every day' : ex.repeatDays.map((day0) => DAYS[day0]).join(', ')}</span> : ex.equipment && ex.kind === 'exercise' ? <span className="listMeta">{ex.equipment}</span> : null}</span>
                <span aria-hidden="true">›</span>
              </button>)}
            </div>)}
          </div>
        </section>
        {libraryEditorOpen && <Sheet title={exerciseEditorMode === 'existing' ? exerciseForm.name || 'Edit item' : `New ${exerciseForm.kind}`} subtitle={exerciseEditorMode === 'existing' ? `Edit ${exerciseForm.kind}` : undefined} onClose={() => setLibraryEditorOpen(false)}>
        <div ref={exerciseDetailRef} className="stack libraryEditor">
          <div><span className="fieldLabel">Type</span><div className="chips">{(['exercise', 'habit'] as const).map((kind) => { const on = exerciseForm.kind === kind; return <button key={kind} className={on ? 'pill active' : 'pill'} onClick={() => {
            setLibraryFilter(kind)
            setExerciseForm((current) => {
              const nextKind = kind
              const nextDefaultType = sanitizeExerciseDefaultType(nextKind, current.defaultType)
              return {
                ...current,
                kind: nextKind,
                category: current.kind === nextKind ? current.category : defaultCategoryForKind(nextKind),
                equipment: nextKind === 'habit' ? '' : current.equipment,
                defaultType: nextDefaultType,
                allowed: sanitizeAllowedTypes(nextKind, current.allowed, nextDefaultType),
                target: allowedTypesForKind(nextKind).includes(current.defaultType) ? current.target : blank(nextDefaultType),
                progressMetric: nextKind === 'habit' && current.progressMetric === 'weight' ? (nextDefaultType === 'duration' ? 'time' : 'count') : current.progressMetric,
              }
            })
          }}>{TRACKABLE_KIND_LABEL[kind]}</button> })}</div></div>
          <label className="field"><span>Name</span><input value={exerciseForm.name} onChange={(e) => setExerciseForm((x) => ({ ...x, name: e.target.value }))} /></label>
          <div className="split">
            <label className="field"><span>Category</span><select value={exerciseForm.category} onChange={(e) => setExerciseForm((x) => ({ ...x, category: e.target.value }))}>{Array.from(new Set([...(exerciseForm.kind === 'habit' ? HABIT_CATEGORY_OPTIONS : EXERCISE_CATEGORY_OPTIONS), ...state.exercises.filter((ex) => ex.kind === exerciseForm.kind).map((ex) => ex.category), exerciseForm.category])).filter(Boolean).map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
            {exerciseForm.kind === 'exercise' && <label className="field"><span>Equipment</span><input value={exerciseForm.equipment} onChange={(e) => setExerciseForm((x) => ({ ...x, equipment: e.target.value }))} /></label>}
          </div>
          <label className="field"><span>Notes</span><textarea rows={3} value={exerciseForm.notes} onChange={(e) => setExerciseForm((x) => ({ ...x, notes: e.target.value }))} /></label>
          {exerciseForm.kind === 'habit' && <div className="repeatDaysField">
            <span className="fieldLabel">Repeat on</span>
            <div className="chips">
              <button type="button" className={exerciseForm.repeatDays.length === 7 ? 'pill active' : 'pill'} aria-pressed={exerciseForm.repeatDays.length === 7} onClick={() => setExerciseForm((x) => ({ ...x, repeatDays: x.repeatDays.length === 7 ? [] : [0, 1, 2, 3, 4, 5, 6] }))}>Every day</button>
              {DAYS.map((label, weekday) => { const on = exerciseForm.repeatDays.includes(weekday); return <button key={label} type="button" className={on ? 'pill active' : 'pill'} aria-pressed={on} onClick={() => setExerciseForm((x) => ({ ...x, repeatDays: sanitizeRepeatDays(on ? x.repeatDays.filter((y) => y !== weekday) : [...x.repeatDays, weekday]) }))}>{label}</button> })}
            </div>
            <p className="mutedCopy">{exerciseForm.repeatDays.length ? 'Shows up on these days automatically, alongside any workout. Remember to save.' : 'Not repeating. Add it to a day by hand from Day options, or pick days above.'}</p>
          </div>}
          <label className="field"><span>Default target type</span><select value={exerciseForm.defaultType} onChange={(e) => setExerciseForm((x) => ({ ...x, defaultType: e.target.value as TT, allowed: Array.from(new Set([...x.allowed, e.target.value as TT])), target: blank(e.target.value as TT) }))}>{allowedTypesForKind(exerciseForm.kind).map((t) => <option key={t} value={t}>{TT_LABEL[t]}</option>)}</select></label>
          <TargetEditor type={exerciseForm.defaultType} target={exerciseForm.target} durationIn={exerciseForm.kind === 'habit' ? 'minutes' : 'seconds'} onChange={(target) => setExerciseForm((x) => ({ ...x, target }))} />
          <details className="advancedFields">
            <summary>Advanced</summary>
            <div className="stack">
          <label className="field"><span>Progress tracked by</span><select value={exerciseForm.progressMetric} onChange={(e) => setExerciseForm((x) => {
            const nextMetric = e.target.value as PM
            if (nextMetric === 'time' && !['duration', 'distance', 'for-time'].includes(x.defaultType)) {
              return {
                ...x,
                progressMetric: nextMetric,
                defaultType: 'duration',
                allowed: Array.from(new Set([...x.allowed, 'duration'])),
                target: blank('duration'),
              }
            }
            return { ...x, progressMetric: nextMetric }
          })}>{(exerciseForm.kind === 'habit' ? (['count', 'time'] as PM[]) : (Object.keys(PM_LABEL) as PM[])).map((metricOption) => <option key={metricOption} value={metricOption}>{PM_LABEL[metricOption]}</option>)}</select></label>
          <p className="mutedCopy">{progressMetricHint(exerciseForm)}</p>
          <div><span className="fieldLabel">Allowed target types</span><div className="chips">{allowedTypesForKind(exerciseForm.kind).map((t) => { const on = exerciseForm.allowed.includes(t); return <button key={t} className={on ? 'pill active' : 'pill'} onClick={() => setExerciseForm((x) => ({ ...x, allowed: on ? (x.allowed.filter((y) => y !== t).length ? x.allowed.filter((y) => y !== t) : [x.defaultType]) : [...x.allowed, t] }))}>{TT_LABEL[t]}</button> })}</div></div>
          <div><span className="fieldLabel">Reference choices</span><div className="chips">{(Object.keys(RM_LABEL) as RM[]).map((r) => { const on = exerciseForm.refs.includes(r); return <button key={r} className={on ? 'pill active' : 'pill'} onClick={() => setExerciseForm((x) => ({ ...x, refs: on ? x.refs.filter((y) => y !== r) : [...x.refs, r] }))}>{RM_LABEL[r]}</button> })}</div></div>
            </div>
          </details>
          <div className="nav">
            <button className="primary" onClick={() => { void saveExercise().then((saved) => { if (saved) setLibraryEditorOpen(false) }) }}>{exerciseEditorMode === 'existing' ? 'Save changes' : `Create ${exerciseForm.kind}`}</button>
            {exerciseEditorMode === 'existing' && selectedExerciseId && <button className="iconPill dangerPill destructiveIconButton" onClick={() => { setLibraryEditorOpen(false); setConfirmState({ kind: 'delete-exercise', exerciseId: selectedExerciseId, title: `Delete ${exerciseForm.kind}?`, body: 'This will remove the item from the library, plans, scheduled days, and progress history.' }) }} aria-label={`Delete ${exerciseForm.kind}`}><TrashIcon /></button>}
          </div>
        </div>
        </Sheet>}
      </main>}

      {tab === 'plans' && <main className="stack plansPage planGroupPage">
        {planSubNav}
        <section className="panel stack currentProgramPanel">
          <div><p className="eyebrow">Current program</p><h2>{activeProgramGroups.length ? (activeProgramGroups.length === 1 ? 'In progress' : `${activeProgramGroups.length} in progress`) : 'Nothing scheduled'}</h2></div>
          {activeProgramGroups.length === 0 && <div className="noticeCard"><p>Pick one of your plans below and choose <strong>Start</strong> to put it on the calendar.</p></div>}
          {activeProgramGroups.map((group) => {
            const groupRunIds = new Set(group.runs.map((run) => run.id))
            const runDays = state.schedule.filter((x) => x.runId && groupRunIds.has(x.runId)).sort((a, b) => a.date.localeCompare(b.date))
            const workoutDays = runDays.filter((day0) => day0.items.some((item) => !isHabitItem(item)))
            const isDone = (day0: Day) => day0.skipped || day0.items.filter((item) => !isHabitItem(item)).every((item) => item.done)
            const completedDays = workoutDays.filter(isDone).length
            const totalDays = workoutDays.length
            const progress = totalDays ? Math.round((completedDays / totalDays) * 100) : 0
            const firstRun = group.runs[0]
            const firstDate = runDays[0]?.date ?? firstRun.startDate
            const lastDate = runDays[runDays.length - 1]?.date ?? firstRun.startDate
            const totalWeeks = Math.max(1, Math.ceil((dateOrdinal(lastDate) - dateOrdinal(firstDate) + 1) / 7))
            const currentWeek = Math.min(totalWeeks, Math.max(1, Math.floor((dateOrdinal(today) - dateOrdinal(firstDate)) / 7) + 1))
            const nextDay = workoutDays.find((day0) => day0.date >= today && !isDone(day0))
            const nextNames = nextDay ? nextDay.items.filter((item) => !isHabitItem(item)).map((item) => exById[item.exerciseId]?.name).filter(Boolean) as string[] : []
            const title = group.plan?.name ?? runDisplayName(firstRun, state.plans, today)
            const runIdList = group.runs.map((run) => run.id)
            return <article key={group.key} className="programCard stack">
              <div className="row">
                <div>
                  <h3>{title}</h3>
                  <p className="mutedCopy">{today < firstDate ? `Starts ${fmtShort(firstDate)}` : `Week ${currentWeek} of ${totalWeeks}`} · {fmtDateRange(firstDate, lastDate)}</p>
                </div>
                <details className="secondaryTools compactMenu"><summary aria-label={`Options for ${title}`}>•••</summary>
                  {group.plan && <button className="textButton" onClick={() => openPlanScheduler(group.plan!.id)}>Extend</button>}
                  <button className="textButton" onClick={() => void setRunStatus(runIdList, 'completed')}>Mark finished</button>
                  <button className="textButton dangerTextButton" onClick={() => setConfirmState({ kind: 'delete-run', runIds: runIdList, title: 'Remove this program?', body: 'This removes the program and its scheduled days. Habits stay, and you can keep completed workouts on the calendar as history.' })}>Remove program</button>
                </details>
              </div>
              <div className="programProgress">
                <div className="progressTrack" aria-label={`${progress}% complete`}><div className="progressFill" style={{ width: `${progress}%` }} /></div>
                <span>{completedDays} of {totalDays} workouts</span>
              </div>
              {nextDay ? <button type="button" className="nextWorkoutRow" onClick={() => openDayFromCalendar(nextDay.date)}>
                <span><span className="fieldLabel">{nextDay.date === today ? 'Today' : 'Next workout'}</span><strong>{fmtDay(nextDay.date)}</strong><span className="mutedCopy">{nextNames.slice(0, 3).join(', ')}{nextNames.length > 3 ? ` +${nextNames.length - 3}` : ''}</span></span>
                <span aria-hidden="true">›</span>
              </button> : <p className="mutedCopy">All workouts are done. Extend it, or mark it finished from the ••• menu.</p>}
            </article>
          })}
        </section>
        <section className="panel stack">
          <div className="row">
            <div><p className="eyebrow">Plans</p><h2>Your plans</h2></div>
            <details className="secondaryTools compactMenu">
              <summary>Manage</summary>
              <div className="stack compactStack">
                <button className="pill" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); planImportInputRef.current?.click() }} disabled={importBusy || !hasSupabaseEnv}>{importBusy ? 'Analyzing...' : 'Import spreadsheet'}</button>
                <button className="pill" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); void startNewPlan() }}>Create new plan</button>
              </div>
            </details>
          </div>
          <input ref={planImportInputRef} className="hiddenInput" type="file" accept=".xlsx,.xls,.csv" onChange={handlePlanSpreadsheetImport} />
          {!hasSupabaseEnv && <p className="mutedCopy">Spreadsheet import becomes available once the Cloudflare backend is connected.</p>}
          {importAnalysis && <div className="card stack importPreviewCard">
            <div>
              <p className="eyebrow">Spreadsheet analysis</p>
              <h3>{importWorkbook?.fileName ?? 'Imported spreadsheet'}</h3>
              <p>{importAnalysis.summary}</p>
            </div>
            {importAnalysis.warnings.length > 0 && <div className="stack compactStack">
              {importAnalysis.warnings.map((warning) => <p key={warning} className="mutedCopy">Warning: {warning}</p>)}
            </div>}
            <div className="stack compactStack">
              <div><p className="eyebrow">Detected items</p></div>
              {importedItemMatches.map(({ item, existing }) => <div key={`${item.kind}-${item.name}`} className="listItem importAnalysisRow">
                <div className="listItemContent">
                  <strong>{existing ? item.name : `* ${item.name}`}</strong>
                  <span className="listMeta">{TRACKABLE_KIND_LABEL[item.kind]} / {item.category}{existing ? ` / In catalog as ${existing.name}` : ' / Needs added to catalog'}</span>
                </div>
                <span className={existing ? 'pill importMatchPill' : 'pill active importMatchPill'}>{item.usedOnDays.length} day{item.usedOnDays.length === 1 ? '' : 's'}</span>
              </div>)}
            </div>
            <div className="stack compactStack">
              <div><p className="eyebrow">Per day breakdown</p></div>
              {importAnalysis.days.map((day0) => <div key={day0.label} className="card stack planDayCard">
                <div>
                  <strong>{day0.label}</strong>
                  {day0.notes && <p>{day0.notes}</p>}
                </div>
                <div className="stack compactStack">
                  {day0.items.map((item, index) => {
                    const existing = catalogMatchesByNormalizedName.get(normalizeCatalogName(item.name))
                    return <div key={`${day0.label}-${item.name}-${index}`} className="importDayItemRow">
                      <span>{existing ? item.name : `* ${item.name}`}</span>
                      <strong>{sum(item.type, item.target)}</strong>
                    </div>
                  })}
                </div>
              </div>)}
            </div>
            <div className="nav">
              <button className="primary" onClick={() => void createPlanFromImport()} disabled={importBusy}>{importBusy ? 'Creating...' : 'Create plan'}</button>
              <button className="pill" onClick={clearPlanImport} disabled={importBusy}>Cancel</button>
            </div>
            <p className="mutedCopy">Missing items are marked with `*` and will be added to the catalog before the plan is created.</p>
          </div>}
          <div className="stack">
            {state.plans.map((p) => <div key={p.id} className={selectedPlanId === p.id ? 'listItem activeItem planListRow' : 'listItem planListRow'}>
              <button className="planListButton" onClick={() => selectPlan(p.id)}><strong>{p.name}</strong></button>
              <div className="planListActions">{activePlanIds.has(p.id) && <span className="status activePlanStatus">Active</span>}<button className="pill softActionPill" onClick={() => openPlanScheduler(p.id)} aria-label={`${activePlanIds.has(p.id) ? 'Extend' : 'Start'} ${p.name}`}>{activePlanIds.has(p.id) ? 'Extend' : 'Start'}</button></div>
            </div>)}
          </div>
          {applyPlanId && <div className="card stack planSchedulerCard">
            <div><p className="eyebrow">{extendingPlan ? 'Extend program' : 'Start plan'}</p><h3>{planToApply?.name ?? 'Plan'}</h3><p className="mutedCopy">{extendingPlan ? 'Adds more weeks right after your current schedule ends. It stays one program, and each exercise picks up from your latest results.' : 'Put this plan on your calendar. The plan itself doesn’t change, so you can run it again later.'}</p></div>
            {extendingPlan && applyScheduleMode === 'end-date' && <div className="nav quickExtend" role="group" aria-label="Quick lengths">
              {[1, 2, 4].map((weeks) => { const end = add(applyStartDate, weeks * 7 - 1); return <button key={weeks} type="button" className={applyEndDate === end ? 'pill active' : 'pill'} aria-pressed={applyEndDate === end} onClick={() => setApplyEndDate(end)}>+{weeks} week{weeks === 1 ? '' : 's'}</button> })}
            </div>}
            <div className="scheduleModePicker" role="group" aria-label="Scheduling method">
              <button className={applyScheduleMode === 'cycles' ? 'pill active' : 'pill'} onClick={() => setApplyScheduleMode('cycles')}>Number of cycles</button>
              <button className={applyScheduleMode === 'end-date' ? 'pill active' : 'pill'} onClick={() => setApplyScheduleMode('end-date')}>Through an end date</button>
            </div>
            <div className="planSchedulerFields">
              <label className="field"><span>Start date</span><input type="date" value={applyStartDate} onChange={(e) => setApplyStartDate(e.target.value)} /></label>
              {applyScheduleMode === 'cycles' ? <label className="field"><span>Cycles</span><input type="number" inputMode="numeric" min={1} max={12} value={applyCycleCount} onChange={(e) => setApplyCycleCount(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} /></label> : <label className="field"><span>Program end date</span><input type="date" value={applyEndDate} onChange={(e) => setApplyEndDate(e.target.value)} /></label>}
            </div>
            <div className="planTargetMode">
              <span className="fieldLabel">Starting targets</span>
              <div className="scheduleModePicker" role="group" aria-label="Starting targets">
                <button className={applyTargetMode === 'latest' ? 'pill active' : 'pill'} onClick={() => setApplyTargetMode('latest')}>Continue from latest</button>
                <button className={applyTargetMode === 'template' ? 'pill active' : 'pill'} onClick={() => setApplyTargetMode('template')}>Use plan defaults</button>
              </div>
              <p className="mutedCopy">{applyTargetMode === 'latest' ? 'Each exercise starts from your most recent completed result before this run. Exercises without history use the plan default.' : 'Every exercise starts from the reusable plan template.'}</p>
            </div>
            {applyPlanPreview.error ? <p className="status warn">{applyPlanPreview.error}</p> : <div className="schedulePreview">
              <div className="schedulePreviewSummary"><div><span>Date range</span><strong>{fmtDateRange(applyPlanPreview.startDate, applyPlanPreview.endDate)}</strong></div><div><span>Calendar days</span><strong>{applyPlanPreview.totalDays}</strong></div><div><span>Cycles</span><strong>{applyPlanPreview.cycles.length}</strong></div></div>
              <div className="cyclePreviewList">{applyPlanPreview.cycles.map((cycle) => <div key={`${cycle.cycleNumber}-${cycle.startDate}`}><span>Cycle {cycle.cycleNumber}</span><strong>{fmtDateRange(cycle.startDate, cycle.endDate)}{cycle.days.length < (planToApply?.days.length ?? 0) ? ` · ${cycle.days.length}-day partial cycle` : ''}</strong></div>)}</div>
              {applyPlanPreview.conflicts.length > 0 && <div className="scheduleConflictWarning"><strong>{applyPlanPreview.conflicts.length} calendar conflict{applyPlanPreview.conflicts.length === 1 ? '' : 's'}</strong><p>{applyPlanPreview.conflicts.slice(0, 5).map(fmtShort).join(', ')}{applyPlanPreview.conflicts.length > 5 ? ` and ${applyPlanPreview.conflicts.length - 5} more` : ''}. Choose another start date or adjust the existing schedule first.</p></div>}
            </div>}
            <div className="nav">
              <button className="primary" onClick={() => void schedulePlanCycles()} disabled={applyPlanSaving || Boolean(applyPlanPreview.error) || applyPlanPreview.conflicts.length > 0}>{applyPlanSaving ? 'Saving...' : extendingPlan ? `Extend through ${fmtShort(applyPlanPreview.endDate)}` : `Start ${applyPlanPreview.cycles.length > 1 ? `${applyPlanPreview.cycles.length} cycles` : 'program'}`}</button>
              <button className="pill" onClick={() => setApplyPlanId(null)} disabled={applyPlanSaving}>Cancel</button>
            </div>
          </div>}
          {completedRuns.length > 0 && <details className="secondaryTools completedRuns">
            <summary>Past programs ({completedRuns.length})</summary>
            <div className="stack completedRunList">
              {completedRuns.map((r) => {
                const runDays = state.schedule.filter((x) => x.runId === r.id)
                const workoutDays = runDays.filter((day) => day.items.length > 0)
                const completedDays = workoutDays.filter((day) => day.skipped || day.items.every((item) => item.done)).length
                return <article key={r.id} className="card completedRunCard">
                  <div>
                    <h3>{runDisplayName(r, state.plans, today)}</h3>
                    <p>{completedDays} of {workoutDays.length} workouts complete{r.completedAt ? ` · Closed ${fmtShort(r.completedAt.slice(0, 10))}` : ''}</p>
                  </div>
                  <div className="completedRunActions">
                    <button className="pill" onClick={() => void setRunStatus(r.id, 'active')}>Reopen</button>
                    <details className="secondaryTools compactMenu"><summary aria-label={`Options for ${r.name}`}>•••</summary><button className="textButton dangerTextButton" onClick={() => setConfirmState({ kind: 'delete-run', runIds: [r.id], title: 'Remove past program?', body: 'This removes the program and its scheduled days. Habits stay, and you can keep completed workouts on the calendar as history.' })}>Remove program</button></details>
                  </div>
                </article>
              })}
            </div>
          </details>}
        </section>
        {plan && <section ref={planDetailRef} className="panel stack planEditorPanel">
          {!planEditing ? <>
            <div className="row planOverviewHeader">
              <div><p className="eyebrow">Plan overview</p><h2>{plan.name}</h2></div>
              <button className="pill" onClick={() => setPlanEditing(true)}>Edit plan</button>
            </div>
            {plan.focus && <p className="planFocusCopy">{plan.focus}</p>}
            <div className="planOverviewDays">
              {plan.days.map((planDay, index) => <article key={planDay.id} className="planOverviewDay">
                <span className="planDayNumber">{index + 1}</span>
                <div><h3>{planDay.label}</h3><p>{planDay.items.length ? planDay.items.map((item) => {
                  const exercise = exById[item.exerciseId]
                  return exercise ? `${exercise.name} (${workoutSummary(item.type, item.target)})` : 'Exercise'
                }).join(' · ') : 'Rest day'}</p></div>
              </article>)}
            </div>
          </> : <>
            <div><p className="eyebrow">Manage plan</p><input className="planNameInput" value={planForm.name} onChange={(e) => setPlanForm((x) => ({ ...x, name: e.target.value }))} aria-label="Plan name" /></div>
            <label className="field"><span>Focus</span><textarea rows={2} value={planForm.focus} onChange={(e) => setPlanForm((x) => ({ ...x, focus: e.target.value }))} /></label>
            <div className="nav">
              <button className="primary" onClick={savePlanMeta}>Save plan</button>
              <button className="pill" onClick={() => { setPlanForm(formFromPlan(plan)); setPlanEditing(false) }}>Cancel</button>
              <details className="secondaryTools compactMenu"><summary>More</summary><button className="textButton dangerTextButton" onClick={() => {
                  if (!selectedPlanId) return
                  setKeepCompletedPlanDays(true)
                  setConfirmState({ kind: 'delete-plan', planId: selectedPlanId, title: 'Delete plan?', body: 'This will remove the plan template and any active runs tied to it.' })
                }}>Delete plan</button></details>
            </div>
            {plan.days.length === 0 && <button className="addDayButton" onClick={() => addPlanDayAt(0)}>+ Add day</button>}
            {plan.days.map((pd, index) => <div key={pd.id} className="planDayStack">
              <article
                className="card stack planDayCard"
                draggable
                onDragStart={() => setDraggedPlanDayId(pd.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => movePlanDay(pd.id)}
                onDragEnd={() => setDraggedPlanDayId(null)}
              >
                <div className="row planDayHeaderRow">
                  <button className="exerciseToggle" onClick={() => setExpandedPlanDays((current) => ({ ...current, [pd.id]: !(current[pd.id] ?? false) }))}>
                    <div className="grow planDaySummary">
                      <h3>{pd.label}</h3>
                      <p>{pd.items.length ? pd.items.map((it) => exById[it.exerciseId]?.name ?? 'Exercise').join(', ') : 'Rest day'}</p>
                    </div>
                  </button>
                  <details className="secondaryTools compactMenu dayEditMenu"><summary aria-label={`Options for ${pd.label}`}>...</summary><div className="stack compactStack">
                    <button className="textButton" onClick={() => addPlanDayAt(index + 1)}>Add day after</button>
                    <button className="textButton" onClick={() => duplicatePlanDay(pd.id)}>Duplicate day</button>
                    <button className="textButton dangerTextButton" onClick={() => deletePlanDay(pd.id)}>Delete day</button>
                  </div></details>
                </div>
                {expandedPlanDays[pd.id] && <>
                  <label className="field">
                    <span>Add item</span>
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        if (!event.target.value) return
                        addExerciseToPlanDay(pd.id, event.target.value)
                        event.target.value = ''
                      }}
                    >
                      <option value="">Select exercise or habit</option>
                      {sortedExercises.map((ex) => <option key={ex.id} value={ex.id}>{ex.name}{ex.kind === 'habit' ? ' (Habit)' : ''}</option>)}
                    </select>
                  </label>
                <div className="stack compactStack">{pd.items.length === 0 && <p className="mutedCopy">Rest day</p>}{pd.items.map((it) => {
                  const ex = exById[it.exerciseId]
                  if (!ex) return null
                  const expanded = expandedPlanItems[it.id] ?? false
                  const metricActions = ex.refs.map((r) => <button key={r} className="miniAction" onClick={() => updatePlanItem(pd.id, it.id, (x) => ({ ...x, target: referenceTarget(exerciseHistory(ex.id), ex, r, x.type, x.target) }))}>{r === 'last-result' ? 'Last' : 'PB'} {referenceSummary(exerciseHistory(ex.id), ex, r, it.type)}</button>)
                  return <article key={it.id} className="card stack planExerciseCard">
                    <div className="row">
                      <button className="exerciseToggle" onClick={() => setExpandedPlanItems((current) => ({ ...current, [it.id]: !expanded }))}>
                        <div className="grow"><strong>{ex.name}</strong><p>{ex.name} | {sum(it.type, it.target)}</p></div>
                      </button>
                      <details className="secondaryTools compactMenu"><summary aria-label={`Options for ${ex.name}`}>...</summary><button className="textButton dangerTextButton" onClick={() => removePlanItem(pd.id, it.id)}>Remove</button></details>
                    </div>
                    {expanded && <>
                      <label className="field"><span>Target type</span><select value={it.type} onChange={(e) => updatePlanItem(pd.id, it.id, (x) => ({ ...x, type: e.target.value as TT, target: blank(e.target.value as TT) }))}>{ex.allowed.map((t) => <option key={t} value={t}>{TT_LABEL[t]}</option>)}</select></label>
                      <TargetEditor
                        type={it.type}
                        target={it.target}
                        onChange={(target) => updatePlanItem(pd.id, it.id, (x) => ({ ...x, target }))}
                        actions={<div className="targetActions">{metricActions}</div>}
                      />
                    </>}
                  </article>
                })}</div>
                </>}
              </article>
            </div>)}
          </>}
        </section>}
        {!plan && <section className="panel empty planEmptyState">
          <p>Select a plan to review or edit it.</p>
        </section>}
      </main>}

      {tab === 'progress' && <ProgressScreen
        exercises={state.exercises}
        logs={derivedHistory}
        schedule={state.schedule}
        today={today}
        profile={{ sex: coachProfile.sex ?? undefined, birthYear: coachProfile.birthYear ?? undefined, heightInches: coachProfile.heightInches ?? undefined, equipmentMaxLb: 50, trainingSince: coachProfile.trainingSince ?? undefined }}
        bodyweights={bodyweights}
        onOpenDay={(date) => { openTab('schedule'); focusDay(date) }}
        onEditProfile={() => { setSettingsSection('profile'); openTab('settings') }}
      />}

      {tab === 'settings' && <main className="stack settingsPage">
        <section className="pageHeader">
          <div><p className="eyebrow">Settings</p><h2>Settings</h2></div>
          <div className="segmented" role="group" aria-label="Settings sections">
            {([['profile', 'Profile'], ['integrations', 'Connections'], ['data', 'Data']] as const).map(([section, label]) => <button key={section} type="button" className={settingsSection === section ? 'segment active' : 'segment'} aria-pressed={settingsSection === section} onClick={() => setSettingsSection(section)}>{label}</button>)}
          </div>
        </section>
        <section className="panel stack">
          {settingsSection === 'data' && <>
            <div><p className="eyebrow">Data</p><h2>Manage stored data</h2></div>
            <input ref={importInputRef} type="file" accept="application/json,.json" className="hiddenInput" onChange={handleImportFile} />
            <div className="card stack">
              <div><strong>Backup and restore</strong><p>Export the full app state to a backup file or import a previous backup.</p></div>
              <div className="nav">
                <button className="primary" onClick={exportData}>Export backup</button>
                <button className="pill" onClick={() => importInputRef.current?.click()}>Import backup</button>
              </div>
            </div>
            <details className="dangerZone">
              <summary>Reset options</summary>
              <div className="stack">
            <div className="card stack">
              <div><strong>Reset progress history</strong><p>This clears completion status, logged times, weights, counts, and progress history while keeping exercises, plans, and the schedule structure.</p></div>
              <button className="pill dangerPill" onClick={() => setConfirmState({ kind: 'reset-progress-data', title: 'Reset progress history?', body: 'This clears completion logs, PBs, and checked-off progress across the app.' })}>Reset progress</button>
            </div>
            <div className="card stack">
              <div><strong>Reset schedule and active runs</strong><p>This removes calendar days and active runs but keeps your exercise library, templates, and saved progress logs not tied to the schedule.</p></div>
              <button className="pill dangerPill" onClick={() => setConfirmState({ kind: 'reset-schedule-data', title: 'Reset schedule and runs?', body: 'This will clear the calendar and remove active and completed runs.' })}>Reset schedule</button>
            </div>
            <div className="card stack">
              <div><strong>Reset the app</strong><p>This resets the app back to a clean starting state.</p></div>
              <button className="pill dangerPill" onClick={() => setConfirmState({ kind: 'reset-all-data', title: 'Reset all app data?', body: 'This will remove exercises, plans, schedule data, runs, and progress history.' })}>Reset everything</button>
            </div>
              </div>
            </details>
          </>}
          {settingsSection === 'integrations' && <div className="stack">
            <div><p className="eyebrow">Integrations</p><h2>Connected services</h2></div>
            <div className="card stack">
              <div>
                <strong>Android Health Connect</strong>
                <p>Automatically import MacroFactor nutrition, phone and Pixel Watch steps, and body weight about hourly through the companion app.</p>
              </div>
              <a className="primary downloadButton" href="/downloads/discipline-plus-sync.apk" download>Install Android helper 1.3</a>
              {mobileSyncStatus && <div className="syncStatusSummary settingsSyncStatus">
                <p><strong>Last successful sync:</strong> {syncTimeLabel(mobileSyncStatus.last_sync_success_at ?? mobileSyncStatus.last_used_at)}</p>
                <small>{mobileSyncStatus.app_version ? `Installed helper last reported version ${mobileSyncStatus.app_version}.` : 'Install version 1.3, then open it once to enable diagnostics and one-tap sync.'}</small>
                {mobileSyncStatus.last_sync_error && <p className="syncWarning">{mobileSyncStatus.last_sync_error}</p>}
              </div>}
              {mobilePairing ? <div className="pairingCodeBox">
                <span>Enter this code on your phone</span>
                <strong>{mobilePairing.code}</strong>
                <small>Expires at {new Date(mobilePairing.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. It works once.</small>
              </div> : <p>Create a one-time code after installing the companion app.</p>}
              <div className="nav">
                <button className="primary" onClick={createMobilePairing} disabled={mobilePairingLoading || !user}>{mobilePairingLoading ? 'Creating code…' : mobilePairing ? 'Create a new code' : 'Pair Android phone'}</button>
                {mobileSyncStatus && <button className="pill dangerPill" onClick={() => setConfirmState({ kind: 'revoke-mobile-sync', title: 'Disconnect Android phone?', body: 'The current helper token will stop working. You can pair the phone again later with a new code.' })}>Disconnect phone</button>}
              </div>
            </div>
            <div className="card stack">
              <strong>Cloudflare</strong>
              <p>{hasSupabaseEnv ? `Connected backend: ${supabaseUrl}` : 'The Cloudflare backend is not configured in this build.'}</p>
              <span className={hasSupabaseEnv ? 'status' : 'status warn'}>{hasSupabaseEnv ? 'Workers + D1 ready' : 'Backend unavailable'}</span>
            </div>
            <div className="card stack">
              <strong>AI coach privacy</strong>
              <p>When you request a review or send a coach message, the relevant workout history, nutrition, activity, weight trends, goals, coaching notes, and your message are sent to OpenAI to generate the answer. Requests are configured with storage disabled. Diagnostics keep status and timing only—not prompts, health data, or responses.</p>
            </div>
            <div className="card stack">
              <div><strong>AI coach diagnostics</strong><p>Recent sanitized coach requests. Health data, prompts, responses, and API credentials are never included.</p></div>
              {aiDiagnosticsLoading ? <p>Loading diagnostics...</p> : aiDiagnostics.length ? <div className="aiDiagnosticList">
                {aiDiagnostics.map((entry) => <div className={`aiDiagnosticItem ${entry.status}`} key={entry.id}>
                  <div className="aiDiagnosticHeading"><strong>{entry.status === 'succeeded' ? 'Succeeded' : 'Failed'} · {entry.operation === 'daily_review' ? 'Daily review' : 'Coach message'}</strong><span>{syncTimeLabel(entry.created_at)}</span></div>
                  <p>{entry.message}</p>
                  <small>{entry.model}{entry.review_date ? ` · ${entry.review_date}` : ''}{entry.provider_status ? ` · HTTP ${entry.provider_status}` : ''}{entry.error_code ? ` · ${entry.error_code}` : ''} · {entry.duration_ms.toLocaleString()} ms</small>
                  {(entry.request_id || entry.response_id) && <small className="diagnosticReference">Reference: {entry.request_id || entry.response_id}</small>}
                </div>)}
              </div> : <p>No coach diagnostics have been recorded yet. The next review or follow-up will appear here.</p>}
            </div>
          </div>}
          {settingsSection === 'profile' && <div className="stack">
            <div className="card stack">
              <div><strong>About you</strong><p className="mutedCopy">Used to compare your lifts with norms for people your size and age, and shared with the coach.</p></div>
              <div className="profileFields">
                <label className="field"><span>Birth year</span><input type="number" inputMode="numeric" min={1920} max={new Date().getFullYear() - 13} placeholder="e.g. 1984" value={profileDraft.birthYear} onChange={(e) => setProfileDraft((x) => ({ ...x, birthYear: e.target.value }))} /></label>
                <div className="field"><span>Sex</span><div className="segmented" role="group" aria-label="Sex">
                  {(['male', 'female'] as const).map((option) => <button key={option} type="button" className={profileDraft.sex === option ? 'segment active' : 'segment'} aria-pressed={profileDraft.sex === option} onClick={() => setProfileDraft((x) => ({ ...x, sex: option }))}>{option === 'male' ? 'Male' : 'Female'}</button>)}
                </div></div>
                <div className="field"><span>Height</span><div className="heightInputs">
                  <label><input type="number" inputMode="numeric" min={3} max={8} value={profileDraft.heightFeet} onChange={(e) => setProfileDraft((x) => ({ ...x, heightFeet: e.target.value }))} aria-label="Height, feet" /><small>ft</small></label>
                  <label><input type="number" inputMode="numeric" min={0} max={11} value={profileDraft.heightInches} onChange={(e) => setProfileDraft((x) => ({ ...x, heightInches: e.target.value }))} aria-label="Height, inches" /><small>in</small></label>
                </div></div>
              </div>
              <label className="field"><span>Lifting since <small className="mutedCopy">(optional)</small></span><input type="month" max={today.slice(0, 7)} value={profileDraft.trainingSince} onChange={(e) => setProfileDraft((x) => ({ ...x, trainingSince: e.target.value }))} /><small className="mutedCopy">Sets which strength level is on track for you. Leave blank to use your first logged workout.</small></label>
              <label className="checkRow"><input type="checkbox" checked={profileDraft.powerblockColors} onChange={(e) => setProfileDraft((x) => ({ ...x, powerblockColors: e.target.checked }))} /><span><strong>Show PowerBlock colors</strong><small>A colored dot next to dumbbell exercises shows which rail to pin.</small></span></label>
              <div className="nav"><button className="primary" onClick={() => void saveProfile()} disabled={profileSaving}>{profileSaving ? 'Saving…' : 'Save profile'}</button></div>
              <p className="mutedCopy">Body weight comes from your weigh-ins (synced or entered on Today).</p>
            </div>
            <div className="card stack">
              <strong>Account</strong>
              <p>{hasSupabaseEnv ? (authLoading ? 'Checking your current session.' : user ? `Signed in as ${user.email ?? 'user'}` : 'Ready for Google sign-in.') : 'Cloudflare authentication is not configured for this build.'}</p>
              {hasSupabaseEnv && <div className="nav">
                {!user && !authLoading && <button className="primary" onClick={signInWithGoogle}>Continue with Google</button>}
                {user && <button className="pill dangerPill" onClick={signOut}>Sign out</button>}
              </div>}
            </div>
          </div>}
        </section>
      </main>}
    </div>
  )
}

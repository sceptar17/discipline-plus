import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import './App.css'
import { hasSupabaseEnv, supabase, supabaseUrl } from './lib/supabase'

type TT = 'count' | 'sets' | 'duration' | 'distance' | 'for-time' | 'weighted'
type RM = 'last-result' | 'personal-best'
type PM = 'count' | 'time' | 'weight'
type Target = { count?: number; sets?: number; reps?: number; seconds?: number; distance?: number; unit?: 'mi' | 'km'; weight?: number }
type Result = { seconds?: number; timeText?: string; weight?: number; count?: number; note?: string }
type Exercise = { id: string; name: string; category: string; equipment: string; notes: string; defaultType: TT; allowed: TT[]; target: Target; refs: RM[]; progressMetric: PM }
type Item = { id: string; exerciseId: string; type: TT; target: Target; ref: RM; done: boolean; result: Result }
type Day = { date: string; notes: string; rest: boolean; skipped: boolean; runId?: string; dayNo?: number; items: Item[] }
type PlanDay = { id: string; label: string; rest: boolean; notes?: string; items: Array<{ id: string; exerciseId: string; type: TT; target: Target; ref: RM }> }
type Plan = { id: string; name: string; focus: string; days: PlanDay[] }
type Run = { id: string; planId: string; startDate: string; name: string }
type Log = { id: string; sourceItemId?: string; exerciseId: string; date: string; type: TT; target: Target; result: Result; done: true }
type LegacyHist = { id: string; exerciseId: string; date: string; type: TT; target: Target; actualSeconds?: number; actualWeight?: number; actualCount?: number; done: boolean }
type LegacyItem = Omit<Item, 'result'> & { result?: Result; actualSeconds?: number; actualTimeText?: string; actualWeight?: number; actualCount?: number; note?: string }
type LegacyState = { exercises?: Exercise[]; schedule?: Array<Omit<Day, 'items'> & { items: LegacyItem[] }>; plans?: Plan[]; runs?: Run[]; history?: LegacyHist[]; logs?: Log[] }
type State = { exercises: Exercise[]; schedule: Day[]; plans: Plan[]; runs: Run[]; logs: Log[] }
type ExerciseForm = { name: string; category: string; equipment: string; notes: string; defaultType: TT; allowed: TT[]; target: Target; refs: RM[]; progressMetric: PM }
type PlanForm = { name: string; focus: string }
type Toast = { id: string; message: string }
type ItemDraft = { type: TT; target: Target; timeText: string; weightText: string; countText: string; note: string }
type ConfirmState =
  | { kind: 'delete-run'; runId: string; title: string; body: string }
  | { kind: 'delete-plan'; planId: string; title: string; body: string }
  | { kind: 'delete-exercise'; exerciseId: string; title: string; body: string }
  | { kind: 'import-data'; title: string; body: string }
  | { kind: 'reset-all-data'; title: string; body: string }
  | { kind: 'reset-schedule-data'; title: string; body: string }
  | { kind: 'reset-progress-data'; title: string; body: string }
  | null

const KEY = 'fitness-tracker-v1'
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CATEGORY_OPTIONS = ['Bodyweight', 'Dumbbell']
const TT_LABEL: Record<TT, string> = { count: 'Count', sets: 'Sets x reps', duration: 'Duration', distance: 'Distance', 'for-time': 'For time', weighted: 'Weighted sets' }
const RM_LABEL: Record<RM, string> = { 'last-result': 'Last result', 'personal-best': 'Personal best' }
const PM_LABEL: Record<PM, string> = { count: 'Count', time: 'Time', weight: 'Weight' }
const id = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`
const d = (k: string) => new Date(`${k}T12:00:00`)
const key = (dt: Date) => `${dt.getFullYear()}-${`${dt.getMonth() + 1}`.padStart(2, '0')}-${`${dt.getDate()}`.padStart(2, '0')}`
const add = (k: string, n: number) => { const x = d(k); x.setDate(x.getDate() + n); return key(x) }
const monthKey = (k: string) => `${k.slice(0, 7)}-01`
const fmtDay = (k: string) => d(k).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
const fmtShort = (k: string) => d(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const fmtMonth = (k: string) => d(k).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
const fmtSecs = (s?: number) => !s ? '--:--' : `${Math.floor(s / 60)}:${`${s % 60}`.padStart(2, '0')}`
const parseSecs = (v: string) => { if (!v.trim()) return undefined; if (v.includes(':')) { const [m, s] = v.split(':').map(Number); return Number.isNaN(m) || Number.isNaN(s) ? undefined : m * 60 + s } const n = Number(v); return Number.isNaN(n) ? undefined : n * 60 }
const blank = (t: TT): Target => t === 'count' ? { count: 25 } : t === 'sets' ? { sets: 4, reps: 10 } : t === 'duration' ? { seconds: 60 } : t === 'distance' ? { distance: 2, unit: 'mi' } : t === 'for-time' ? { count: 100 } : { sets: 4, reps: 8, weight: 30 }
const clone = (t: Target) => ({ ...t })
const sum = (t: TT, x: Target) => t === 'count' ? `${x.count ?? 0} reps` : t === 'sets' ? `${x.sets ?? 0} x ${x.reps ?? 0}` : t === 'duration' ? durationShort(x.seconds) : t === 'distance' ? `${x.distance ?? 0} ${x.unit ?? 'mi'}` : t === 'for-time' ? `${x.count ?? 0} reps for time` : `${x.sets ?? 0} x ${x.reps ?? 0} @ ${x.weight ?? 0} lb`
const totalCount = (target: Target) => target.count ?? ((target.sets ?? 0) * (target.reps ?? 0))
const metric = (progressMetric: PM, entry: Pick<Log, 'target' | 'result'>) => progressMetric === 'count' ? entry.result.count ?? totalCount(entry.target) : progressMetric === 'time' ? entry.result.seconds ?? entry.target.seconds : entry.result.weight ?? entry.target.weight
const durationShort = (seconds?: number) => seconds === undefined ? '0:00' : `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')}`
const compact = (t: TT, x: Target) => t === 'count' ? `${x.count ?? 0}` : t === 'sets' ? `${x.sets ?? 0}x${x.reps ?? 0}` : t === 'duration' ? durationShort(x.seconds) : t === 'distance' ? `${x.distance ?? 0} ${x.unit === 'km' ? 'km' : 'miles'}` : t === 'for-time' ? `${x.count ?? 0}` : `${x.sets ?? 0}x${x.reps ?? 0}`
const emptyExerciseForm = (): ExerciseForm => ({ name: '', category: CATEGORY_OPTIONS[0], equipment: '', notes: '', defaultType: 'count', allowed: ['count'], target: blank('count'), refs: ['last-result', 'personal-best'], progressMetric: 'count' })
const formFromExercise = (exercise: Exercise): ExerciseForm => ({ name: exercise.name, category: exercise.category, equipment: exercise.equipment, notes: exercise.notes, defaultType: exercise.defaultType, allowed: [...exercise.allowed], target: clone(exercise.target), refs: [...exercise.refs], progressMetric: exercise.progressMetric })
const emptyPlanForm = (): PlanForm => ({ name: '', focus: '' })
const formFromPlan = (plan: Plan): PlanForm => ({ name: plan.name, focus: plan.focus })
const progressMetricHint = (form: ExerciseForm) => {
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
    { id: id('ex'), name: 'Push-Ups', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Can be straight reps, sets, or for time.', defaultType: 'sets', allowed: ['count', 'sets', 'for-time'], target: { sets: 5, reps: 20 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), name: 'Wall Sit', category: 'Bodyweight', equipment: 'Wall', notes: 'Great timed hold.', defaultType: 'duration', allowed: ['duration'], target: { seconds: 90 }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
    { id: id('ex'), name: 'Dumbbell Curl', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Track weight progression.', defaultType: 'weighted', allowed: ['weighted', 'sets'], target: { sets: 4, reps: 8, weight: 32 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), name: 'Run', category: 'Bodyweight', equipment: 'Shoes', notes: 'Distance-focused by default.', defaultType: 'distance', allowed: ['distance', 'duration'], target: { distance: 3, unit: 'mi' }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
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
    runs: [{ id: runId, planId, startDate: today, name: 'Strength Base active run' }],
    logs: [
      { id: id('log'), exerciseId: ex[2].id, date: add(today, -3), type: 'weighted', target: { sets: 4, reps: 8, weight: 30 }, result: { weight: 30 }, done: true },
      { id: id('log'), exerciseId: ex[1].id, date: add(today, -5), type: 'duration', target: { seconds: 75 }, result: { seconds: 75, timeText: fmtSecs(75) }, done: true },
      { id: id('log'), exerciseId: ex[0].id, date: add(today, -7), type: 'sets', target: { sets: 5, reps: 18 }, result: { count: 90 }, done: true },
    ],
  }
}

function planItem(exerciseId: string, type: TT, target: Target, ref: RM = 'last-result') {
  return { id: id('pi'), exerciseId, type, target, ref }
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
    runs: (state.runs ?? []).filter((run) => !legacyRunIds.has(run.id)),
    schedule: normalizedSchedule.filter((day) => !day.runId || !legacyRunIds.has(day.runId)),
    logs: [...cleanedLegacyLogs, ...migratedHistoryLogs],
  }

  const withMetrics: Exercise[] = cleanedState.exercises.map((exercise) => {
    const refs = (exercise.refs ?? []).filter((ref): ref is RM => ref === 'last-result' || ref === 'personal-best')
    return {
      ...exercise,
      refs: refs.length ? refs : ['last-result', 'personal-best'],
      progressMetric: exercise.progressMetric ?? (exercise.defaultType === 'distance' || exercise.defaultType === 'duration' || exercise.defaultType === 'for-time' ? 'time' : exercise.defaultType === 'weighted' ? 'weight' : exercise.name.toLowerCase().includes('dumbbell') ? 'weight' : 'count'),
    }
  })
  const exerciseCatalog: Exercise[] = [
    { id: id('ex'), name: 'Push-Ups', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Straight sets, endurance blocks, and for-time work.', defaultType: 'sets', allowed: ['count', 'sets', 'for-time'], target: { sets: 5, reps: 20 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), name: 'Bent-Over Reverse Fly', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Rear delt dumbbell movement.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 3, reps: 12 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), name: 'Bird Dog', category: 'Bodyweight', equipment: 'Floor', notes: 'Core and stability movement.', defaultType: 'sets', allowed: ['sets', 'count'], target: { sets: 3, reps: 10 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), name: 'Burpees', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Full-body conditioning movement.', defaultType: 'count', allowed: ['count', 'for-time'], target: { count: 20 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), name: 'Calf Raises', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Can be bodyweight or weighted.', defaultType: 'sets', allowed: ['sets', 'count'], target: { sets: 3, reps: 20 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), name: 'Chest-Supported Row', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Back movement with chest support.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 3, reps: 10 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), name: 'Crunches', category: 'Bodyweight', equipment: 'Floor', notes: 'Abdominal isolation movement.', defaultType: 'count', allowed: ['count', 'sets'], target: { count: 30 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), name: 'Dead Bug', category: 'Bodyweight', equipment: 'Floor', notes: 'Core control movement.', defaultType: 'sets', allowed: ['sets', 'count'], target: { sets: 3, reps: 12 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), name: 'Dumbbell Floor Press', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Horizontal pressing movement.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 4, reps: 8 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), name: 'Dumbbell Romanian Deadlift', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Hip hinge lower-body movement.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 4, reps: 10 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), name: 'Dumbbell Row', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Single-arm row work.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 3, reps: 10 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), name: 'Plank', category: 'Bodyweight', equipment: 'Floor', notes: 'Timed hold.', defaultType: 'duration', allowed: ['duration'], target: { seconds: 120 }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
    { id: id('ex'), name: 'Glute Bridge', category: 'Bodyweight', equipment: 'Floor', notes: 'Posterior chain bodyweight movement.', defaultType: 'sets', allowed: ['sets', 'count'], target: { sets: 3, reps: 15 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), name: 'Run', category: 'Bodyweight', equipment: 'Shoes', notes: 'Distance or timed running.', defaultType: 'distance', allowed: ['distance', 'duration'], target: { distance: 2, unit: 'mi' }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
    { id: id('ex'), name: 'Goblet Squat', category: 'Dumbbell', equipment: 'Dumbbell', notes: 'Lower-body strength squat variation.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 4, reps: 10 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), name: 'Hammer Curl', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Neutral-grip dumbbell curl.', defaultType: 'weighted', allowed: ['weighted', 'sets'], target: { sets: 3, reps: 10, weight: 25 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), name: 'Jumping Jacks', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Simple conditioning movement.', defaultType: 'count', allowed: ['count', 'duration'], target: { count: 50 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), name: 'Lateral Raise', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Shoulder accessory movement.', defaultType: 'weighted', allowed: ['weighted', 'sets'], target: { sets: 3, reps: 12, weight: 15 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), name: 'Mountain Climbers', category: 'Bodyweight', equipment: 'Floor', notes: 'Core and conditioning movement.', defaultType: 'duration', allowed: ['duration', 'count'], target: { seconds: 60 }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
    { id: id('ex'), name: 'Dumbbell Lunges', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Weighted lunges.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 3, reps: 20 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), name: 'Pull-Ups', category: 'Bodyweight', equipment: 'Pull-up Bar', notes: 'Vertical pulling movement.', defaultType: 'count', allowed: ['count', 'sets'], target: { count: 10 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), name: 'Squats', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Bodyweight squat volume or for-time work.', defaultType: 'count', allowed: ['count', 'for-time'], target: { count: 100 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), name: 'Sit-Ups', category: 'Bodyweight', equipment: 'Floor', notes: 'Basic core movement.', defaultType: 'count', allowed: ['count', 'sets'], target: { count: 25 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), name: 'Step-Ups', category: 'Bodyweight', equipment: 'Bench or Step', notes: 'Lower-body step movement.', defaultType: 'sets', allowed: ['sets', 'count'], target: { sets: 3, reps: 12 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), name: 'Wall Sit', category: 'Bodyweight', equipment: 'Wall', notes: 'Timed wall sit hold.', defaultType: 'duration', allowed: ['duration'], target: { seconds: 60 }, refs: ['last-result', 'personal-best'], progressMetric: 'time' },
    { id: id('ex'), name: 'Dumbbell Shoulder Press', category: 'Dumbbell', equipment: 'Dumbbells', notes: 'Vertical pressing movement.', defaultType: 'sets', allowed: ['sets', 'weighted'], target: { sets: 3, reps: 10 }, refs: ['last-result', 'personal-best'], progressMetric: 'weight' },
    { id: id('ex'), name: 'Walking Lunges', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Traveling lunge variation.', defaultType: 'count', allowed: ['count', 'sets'], target: { count: 40 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
    { id: id('ex'), name: 'Lunges', category: 'Bodyweight', equipment: 'Bodyweight', notes: 'Bodyweight lunges.', defaultType: 'count', allowed: ['count', 'sets'], target: { count: 40 }, refs: ['last-result', 'personal-best'], progressMetric: 'count' },
  ]

  const existingByName = new Map(withMetrics.map((exercise) => [exercise.name, exercise]))
  const exercises = [...withMetrics]

  for (const exercise of exerciseCatalog) {
    if (!existingByName.has(exercise.name)) {
      exercises.push(exercise)
      existingByName.set(exercise.name, exercise)
    }
  }

  const getExerciseId = (name: string) => existingByName.get(name)?.id ?? ''

  const ampedDays: PlanDay[] = [
    { id: id('pd'), label: 'Day 1', rest: false, notes: 'Push day: 60 pushups (fewest sets), dumbbell floor press 4x8, dumbbell row 3x10 each side, plank 3x1 min, run 1 mile', items: [planItem(getExerciseId('Push-Ups'), 'count', { count: 60 }, 'personal-best'), planItem(getExerciseId('Dumbbell Floor Press'), 'sets', { sets: 4, reps: 8 }), planItem(getExerciseId('Dumbbell Row'), 'sets', { sets: 3, reps: 10 }), planItem(getExerciseId('Plank'), 'duration', { seconds: 180 }, 'personal-best'), planItem(getExerciseId('Run'), 'distance', { distance: 1, unit: 'mi' })] },
    { id: id('pd'), label: 'Day 2', rest: false, notes: 'Run 2.5 miles easy pace', items: [planItem(getExerciseId('Run'), 'distance', { distance: 2.5, unit: 'mi' })] },
    { id: id('pd'), label: 'Day 3', rest: false, notes: 'Lower body: goblet squat 4x10, dumbbell lunges 3x20, 100 squats for time, wall sit max', items: [planItem(getExerciseId('Goblet Squat'), 'sets', { sets: 4, reps: 10 }), planItem(getExerciseId('Dumbbell Lunges'), 'sets', { sets: 3, reps: 20 }), planItem(getExerciseId('Squats'), 'for-time', { count: 100 }, 'personal-best'), planItem(getExerciseId('Wall Sit'), 'duration', { seconds: 60 }, 'personal-best')] },
    { id: id('pd'), label: 'Day 4', rest: false, notes: 'Run 5k for time', items: [planItem(getExerciseId('Run'), 'distance', { distance: 5, unit: 'km' }, 'personal-best')] },
    { id: id('pd'), label: 'Day 5', rest: false, notes: 'Push endurance: 10 sets of 20 pushups with 60 sec rest, plank 2 min, 50 squats', items: [planItem(getExerciseId('Push-Ups'), 'sets', { sets: 10, reps: 20 }, 'personal-best'), planItem(getExerciseId('Plank'), 'duration', { seconds: 120 }, 'personal-best'), planItem(getExerciseId('Squats'), 'count', { count: 50 })] },
    { id: id('pd'), label: 'Day 6', rest: false, notes: 'Conditioning circuit (3 rounds): 40 pushups, 60 squats, 40 lunges, 1 min plank, 1/4 mile run', items: [planItem(getExerciseId('Push-Ups'), 'count', { count: 40 }), planItem(getExerciseId('Squats'), 'count', { count: 60 }), planItem(getExerciseId('Lunges'), 'count', { count: 40 }), planItem(getExerciseId('Plank'), 'duration', { seconds: 60 }), planItem(getExerciseId('Run'), 'distance', { distance: 0.25, unit: 'mi' })] },
    { id: id('pd'), label: 'Day 7', rest: false, notes: 'Recovery: 1.5 mile jog, plank 2 min, wall sit 1 min', items: [planItem(getExerciseId('Run'), 'distance', { distance: 1.5, unit: 'mi' }), planItem(getExerciseId('Plank'), 'duration', { seconds: 120 }), planItem(getExerciseId('Wall Sit'), 'duration', { seconds: 60 })] },
    { id: id('pd'), label: 'Day 8', rest: true, notes: 'Rest', items: [] },
    { id: id('pd'), label: 'Day 9', rest: false, notes: 'Strength push: 80 pushups total, dumbbell floor press 4x8, dumbbell shoulder press 3x10, dumbbell row 3x10, plank 3x1:15', items: [planItem(getExerciseId('Push-Ups'), 'count', { count: 80 }, 'personal-best'), planItem(getExerciseId('Dumbbell Floor Press'), 'sets', { sets: 4, reps: 8 }), planItem(getExerciseId('Dumbbell Shoulder Press'), 'sets', { sets: 3, reps: 10 }), planItem(getExerciseId('Dumbbell Row'), 'sets', { sets: 3, reps: 10 }), planItem(getExerciseId('Plank'), 'duration', { seconds: 225 }, 'personal-best')] },
    { id: id('pd'), label: 'Day 10', rest: false, notes: 'Run 3 miles steady', items: [planItem(getExerciseId('Run'), 'distance', { distance: 3, unit: 'mi' })] },
    { id: id('pd'), label: 'Day 11', rest: false, notes: 'Lower strength: goblet squat 4x12, dumbbell lunges 3x25, 150 squats for time, wall sit max', items: [planItem(getExerciseId('Goblet Squat'), 'sets', { sets: 4, reps: 12 }), planItem(getExerciseId('Dumbbell Lunges'), 'sets', { sets: 3, reps: 25 }), planItem(getExerciseId('Squats'), 'for-time', { count: 150 }, 'personal-best'), planItem(getExerciseId('Wall Sit'), 'duration', { seconds: 60 }, 'personal-best')] },
    { id: id('pd'), label: 'Day 12', rest: false, notes: 'Speed day: run 1 mile fast, rest 10 minutes, max lunges', items: [planItem(getExerciseId('Run'), 'distance', { distance: 1, unit: 'mi' }, 'personal-best'), planItem(getExerciseId('Lunges'), 'count', { count: 40 }, 'personal-best')] },
    { id: id('pd'), label: 'Day 13', rest: false, notes: 'Push challenge: 100 pushups for time, plank 3 min total', items: [planItem(getExerciseId('Push-Ups'), 'for-time', { count: 100 }, 'personal-best'), planItem(getExerciseId('Plank'), 'duration', { seconds: 180 }, 'personal-best')] },
    { id: id('pd'), label: 'Day 14', rest: false, notes: 'Conditioning circuit (3 rounds): 50 squats, 40 pushups, 30 lunges, 1/4 mile run', items: [planItem(getExerciseId('Squats'), 'count', { count: 50 }), planItem(getExerciseId('Push-Ups'), 'count', { count: 40 }), planItem(getExerciseId('Lunges'), 'count', { count: 30 }), planItem(getExerciseId('Run'), 'distance', { distance: 0.25, unit: 'mi' })] },
    { id: id('pd'), label: 'Day 15', rest: false, notes: 'Recovery jog: 1.5 miles, plank 2 min', items: [planItem(getExerciseId('Run'), 'distance', { distance: 1.5, unit: 'mi' }), planItem(getExerciseId('Plank'), 'duration', { seconds: 120 })] },
    { id: id('pd'), label: 'Day 16', rest: true, notes: 'Rest', items: [] },
    { id: id('pd'), label: 'Day 17', rest: false, notes: 'Max pushups test, max plank test', items: [planItem(getExerciseId('Push-Ups'), 'count', { count: 100 }, 'personal-best'), planItem(getExerciseId('Plank'), 'duration', { seconds: 180 }, 'personal-best')] },
    { id: id('pd'), label: 'Day 18', rest: false, notes: '200 squats for time', items: [planItem(getExerciseId('Squats'), 'for-time', { count: 200 }, 'personal-best')] },
    { id: id('pd'), label: 'Day 19', rest: false, notes: 'Run 2 miles fast', items: [planItem(getExerciseId('Run'), 'distance', { distance: 2, unit: 'mi' }, 'personal-best')] },
    { id: id('pd'), label: 'Day 20', rest: false, notes: 'Push ladder: 10-15-20-25-30-25-20-15-10 pushups', items: [planItem(getExerciseId('Push-Ups'), 'count', { count: 170 }, 'personal-best')] },
    { id: id('pd'), label: 'Day 21', rest: false, notes: 'Lower strength: goblet squat 5x10, dumbbell lunges 4x20', items: [planItem(getExerciseId('Goblet Squat'), 'sets', { sets: 5, reps: 10 }), planItem(getExerciseId('Dumbbell Lunges'), 'sets', { sets: 4, reps: 20 })] },
    { id: id('pd'), label: 'Day 22', rest: false, notes: 'Run 5k steady', items: [planItem(getExerciseId('Run'), 'distance', { distance: 5, unit: 'km' })] },
    { id: id('pd'), label: 'Day 23', rest: true, notes: 'Rest', items: [] },
    { id: id('pd'), label: 'Day 24', rest: false, notes: 'Run 5k for time (beat earlier attempt)', items: [planItem(getExerciseId('Run'), 'distance', { distance: 5, unit: 'km' }, 'personal-best')] },
    { id: id('pd'), label: 'Day 25', rest: false, notes: '100 pushups fewest sets possible', items: [planItem(getExerciseId('Push-Ups'), 'count', { count: 100 }, 'personal-best')] },
    { id: id('pd'), label: 'Day 26', rest: false, notes: '200 squats fewest sets possible', items: [planItem(getExerciseId('Squats'), 'count', { count: 200 }, 'personal-best')] },
    { id: id('pd'), label: 'Day 27', rest: false, notes: 'Max plank and max wall sit', items: [planItem(getExerciseId('Plank'), 'duration', { seconds: 180 }, 'personal-best'), planItem(getExerciseId('Wall Sit'), 'duration', { seconds: 120 }, 'personal-best')] },
    { id: id('pd'), label: 'Day 28', rest: false, notes: 'Max lunges then run 1.5 miles', items: [planItem(getExerciseId('Lunges'), 'count', { count: 50 }, 'personal-best'), planItem(getExerciseId('Run'), 'distance', { distance: 1.5, unit: 'mi' })] },
    { id: id('pd'), label: 'Day 29', rest: false, notes: 'Final test: 50 pushups, 100 squats, 50 lunges per leg, 2 min wall sit, 2 min plank, 2 mile run', items: [planItem(getExerciseId('Push-Ups'), 'count', { count: 50 }), planItem(getExerciseId('Squats'), 'count', { count: 100 }), planItem(getExerciseId('Lunges'), 'count', { count: 100 }), planItem(getExerciseId('Wall Sit'), 'duration', { seconds: 120 }), planItem(getExerciseId('Plank'), 'duration', { seconds: 120 }), planItem(getExerciseId('Run'), 'distance', { distance: 2, unit: 'mi' })] },
    { id: id('pd'), label: 'Day 30', rest: true, notes: 'Rest', items: [] },
  ]

  const ampedPlan: Plan = {
    id: cleanedState.plans.find((plan) => plan.name === 'Amped')?.id ?? id('plan'),
    name: 'Amped',
    focus: '30-day progression focused on push strength, lower body work, conditioning, and timed run benchmarks.',
    days: ampedDays,
  }

  const plans = cleanedState.plans.some((plan) => plan.name === 'Amped')
    ? cleanedState.plans.map((plan) => (plan.name === 'Amped' ? ampedPlan : plan))
    : [...cleanedState.plans, ampedPlan]

  const scheduleLogs = cleanedState.schedule.flatMap((day) => day.items.filter((item) => item.done).map((item) => logFromItem(day.date, item)))
  const logsById = new Map<string, Log>()
  for (const entry of [...cleanedState.logs, ...scheduleLogs]) {
    logsById.set(entry.id, entry)
  }

  return { ...cleanedState, exercises, plans, logs: [...logsById.values()] }
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
    : rows.reduce((acc, row) => {
        const a = metric(progressMetric, acc), b = metric(progressMetric, row)
        if (b === undefined) return acc
        if (a === undefined) return row
        return progressMetric === 'time' ? (b < a ? row : acc) : (b > a ? row : acc)
      }, rows[0])
  const next = clone(source.target)

  if (progressMetric === 'time' && source.result.seconds !== undefined) {
    next.seconds = source.result.seconds
  }
  if (progressMetric === 'weight' && source.result.weight !== undefined) {
    next.weight = source.result.weight
  }
  if (progressMetric === 'count' && source.result.count !== undefined) {
    next.count = source.result.count
  }

  return next
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
    : rows.reduce((acc, row) => {
        const a = metric(progressMetric, acc), b = metric(progressMetric, row)
        if (b === undefined) return acc
        if (a === undefined) return row
        return progressMetric === 'time' ? (b < a ? row : acc) : (b > a ? row : acc)
      }, rows[0])

  if (progressMetric === 'time') {
    return source.result.seconds !== undefined ? fmtSecs(source.result.seconds) : (source.target.seconds !== undefined ? fmtSecs(source.target.seconds) : 'none')
  }
  if (progressMetric === 'weight') {
    const value = source.result.weight ?? source.target.weight
    return value !== undefined ? `${value} lb` : 'none'
  }

  const value = source.result.count ?? totalCount(source.target)
  return value !== undefined ? `${value}` : 'none'
}

function metricDisplay(progressMetric: PM, entry: Log) {
  if (progressMetric === 'time') {
    const value = entry.result.seconds ?? entry.target.seconds
    return value !== undefined ? fmtSecs(value) : '--:--'
  }
  if (progressMetric === 'weight') {
    const value = entry.result.weight ?? entry.target.weight
    return value !== undefined ? `${value} lb` : '--'
  }
  const value = entry.result.count ?? totalCount(entry.target)
  return value !== undefined ? `${value}` : '--'
}

function bestProgressEntry(history: Log[], exercise: Exercise) {
  if (!history.length) return undefined
  const progressMetric = effectiveProgressMetric(exercise, history[0].type)
  return history.reduce((acc, row) => {
    const a = metric(progressMetric, acc)
    const b = metric(progressMetric, row)
    if (b === undefined) return acc
    if (a === undefined) return row
    return progressMetric === 'time' ? (b < a ? row : acc) : (b > a ? row : acc)
  }, history[0])
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

function scheduledPlanLabel(day: Day, runs: Run[], plans: Plan[]) {
  if (!day.runId || !day.dayNo) return ''
  const run = runs.find((entry) => entry.id === day.runId)
  if (!run?.planId) return ''
  const plan = plans.find((entry) => entry.id === run.planId)
  if (!plan) return ''
  return `${plan.name} - Day ${day.dayNo}`
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

function defaultResultForLog(log: Log, exercise: Exercise): Result {
  const progressMetric = effectiveProgressMetric(exercise, log.type)
  if (progressMetric === 'time') {
    return { ...log.result, timeText: log.result.timeText ?? (log.result.seconds !== undefined ? fmtSecs(log.result.seconds) : '') }
  }
  if (progressMetric === 'weight') {
    return { ...log.result, weight: log.result.weight ?? log.target.weight ?? 0 }
  }
  return { ...log.result, count: log.result.count ?? totalCount(log.target) }
}

function makeItemDraft(item: Item, exercise: Exercise): ItemDraft {
  const progressMetric = effectiveProgressMetric(exercise, item.type)
  return {
    type: item.type,
    target: clone(item.target),
    timeText: item.result.timeText ?? (item.result.seconds !== undefined ? fmtSecs(item.result.seconds) : ''),
    weightText: item.result.weight !== undefined ? String(item.result.weight) : (item.target.weight !== undefined ? String(item.target.weight) : ''),
    countText: item.result.count !== undefined ? String(item.result.count) : (progressMetric === 'count' && item.type !== 'duration' && item.type !== 'for-time' ? String(totalCount(item.target)) : ''),
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

function catalogExercisesFromSlices(plans: Plan[], runs: Run[], schedule: Day[], logs: Log[]) {
  return ensureAmpedData({
    exercises: [],
    plans,
    runs,
    schedule,
    logs,
  }).exercises
}

function catalogPlansFromSlices(exercises: Exercise[], runs: Run[], schedule: Day[], logs: Log[]) {
  return ensureAmpedData({
    exercises,
    plans: [],
    runs,
    schedule,
    logs,
  }).plans
}

function normalizePlanDaysData(days: PlanDay[]) {
  return days.map((day, index) => ({ ...day, label: `Day ${index + 1}`, rest: day.items.length === 0 }))
}

function mapExerciseRow(row: {
  id: string
  name: string
  category: string
  equipment: string
  notes: string
  default_type: string
  allowed: unknown
  target: unknown
  refs: unknown
  progress_metric: string
}): Exercise {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    equipment: row.equipment,
    notes: row.notes,
    defaultType: row.default_type as TT,
    allowed: Array.isArray(row.allowed) ? row.allowed as TT[] : ['count'],
    target: typeof row.target === 'object' && row.target ? row.target as Target : {},
    refs: Array.isArray(row.refs) ? row.refs as RM[] : ['last-result', 'personal-best'],
    progressMetric: row.progress_metric as PM,
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

function mapRunRows(rows: Array<{ id: string; plan_id: string | null; start_date: string; name: string }>): Run[] {
  return rows.map((row) => ({
    id: row.id,
    planId: row.plan_id ?? '',
    startDate: row.start_date,
    name: row.name,
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

function planHasContent(plan: Plan) {
  return plan.days.some((day0) => day0.items.length > 0)
}

function mergeStarterAmped(remotePlans: Plan[], starterPlans: Plan[]) {
  const starterAmped = starterPlans.find((plan0) => plan0.name === 'Amped')
  if (!starterAmped) return remotePlans

  const remoteAmped = remotePlans.find((plan0) => plan0.name === 'Amped')
  if (!remoteAmped) {
    return [...remotePlans, starterAmped]
  }

  if (planHasContent(remoteAmped)) {
    return remotePlans
  }

  return remotePlans.map((plan0) => (
    plan0.id === remoteAmped.id
      ? { ...starterAmped, id: remoteAmped.id }
      : plan0
  ))
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
  const [tab, setTab] = useState<'schedule' | 'exercises' | 'plans' | 'progress' | 'settings'>('schedule')
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(hasSupabaseEnv)
  const [selected, setSelected] = useState(today)
  const [month, setMonth] = useState(monthKey(today))
  const [scheduleView, setScheduleView] = useState<'calendar' | 'list'>('list')
  const [visibleListCount, setVisibleListCount] = useState(5)
  const [showPastDays, setShowPastDays] = useState(false)
  const [shift, setShift] = useState(1)
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(state.exercises[0]?.id ?? null)
  const [exerciseForm, setExerciseForm] = useState<ExerciseForm>(() => state.exercises[0] ? formFromExercise(state.exercises[0]) : emptyExerciseForm())
  const [selectedProgressExerciseId, setSelectedProgressExerciseId] = useState<string | null>(state.exercises[0]?.id ?? null)
  const [editingLogId, setEditingLogId] = useState<string | null>(null)
  const [progressEdit, setProgressEdit] = useState<Result>({})
  const [pendingImport, setPendingImport] = useState<LegacyState | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [planForm, setPlanForm] = useState<PlanForm>(() => emptyPlanForm())
  const [settingsSection, setSettingsSection] = useState<'data' | 'integrations' | 'profile'>('data')
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({})
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({})
  const [expandedPlanDays, setExpandedPlanDays] = useState<Record<string, boolean>>({})
  const [expandedPlanItems, setExpandedPlanItems] = useState<Record<string, boolean>>({})
  const [draggedPlanDayId, setDraggedPlanDayId] = useState<string | null>(null)
  const [applyPlanId, setApplyPlanId] = useState<string | null>(null)
  const [applyStartDate, setApplyStartDate] = useState(today)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmState, setConfirmState] = useState<ConfirmState>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const dayDetailRef = useRef<HTMLElement | null>(null)
  const exerciseDetailRef = useRef<HTMLElement | null>(null)
  const localScheduleRef = useRef({ schedule: state.schedule, runs: state.runs, logs: state.logs })
  const authUserRef = useRef<string | null>(null)
  const scheduleSaveTimerRef = useRef<number | null>(null)
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
    if (!toasts.length) return
    const timer = window.setTimeout(() => setToasts((current) => current.slice(1)), 2800)
    return () => window.clearTimeout(timer)
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
      setExerciseForm(next.exercises[0] ? formFromExercise(next.exercises[0]) : emptyExerciseForm())
      setSelectedProgressExerciseId(next.exercises[0]?.id ?? null)
      const nextPlan = next.plans.find((plan) => plan.name === 'Amped') ?? next.plans[0]
      setSelectedPlanId(nextPlan?.id ?? null)
      setPlanForm(nextPlan ? formFromPlan(nextPlan) : emptyPlanForm())
      setApplyPlanId(null)
      setApplyStartDate(nextToday)
      cancelLogEdit()
    }
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      authUserRef.current = data.session?.user?.id ?? null
      setUser(data.session?.user ?? null)
      if (data.session?.user) {
        await ensureProfile(data.session.user)
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
      } else {
        resetToSignedOutShell()
      }
    })

    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [])
  const exById = useMemo(() => Object.fromEntries(state.exercises.map((x) => [x.id, x])), [state.exercises])
  const sortedExercises = useMemo(() => [...state.exercises].sort((a, b) => a.name.localeCompare(b.name)), [state.exercises])
  const starterExercises = useMemo(() => catalogExercisesFromSlices(state.plans, state.runs, state.schedule, state.logs), [state.plans, state.runs, state.schedule, state.logs])
  const starterPlans = useMemo(() => catalogPlansFromSlices(state.exercises, state.runs, state.schedule, state.logs), [state.exercises, state.runs, state.schedule, state.logs])
  const dayByDate = useMemo(() => Object.fromEntries(state.schedule.map((x) => [x.date, x])), [state.schedule])
  const derivedHistory = useMemo(() => [...state.logs].sort((a, b) => a.date.localeCompare(b.date)), [state.logs])
  const progressExercises = useMemo(() => {
    const completedIds = new Set(state.logs.filter((entry) => entry.done).map((entry) => entry.exerciseId))
    return sortedExercises.filter((exercise) => completedIds.has(exercise.id))
  }, [sortedExercises, state.logs])
  useEffect(() => {
    setSelectedProgressExerciseId((current) => current && progressExercises.some((exercise) => exercise.id === current) ? current : progressExercises[0]?.id ?? null)
  }, [progressExercises])
  const day: Day = normalizeScheduleDay(dayByDate[selected] ?? { date: selected, notes: '', rest: true, skipped: false, items: [] })
  const plan = state.plans.find((p) => p.id === selectedPlanId) ?? state.plans[0]
  const progressExercise = progressExercises.find((exercise) => exercise.id === selectedProgressExerciseId) ?? progressExercises[0]
  const todayDay = today ? normalizeScheduleDay(dayByDate[today] ?? { date: today, notes: '', rest: true, skipped: false, items: [] }) : undefined
  const todayItems = todayDay?.items ?? []
  const selectedDayPlanLabel = scheduledPlanLabel(day, state.runs, state.plans)
  const todayPlanLabel = todayDay ? scheduledPlanLabel(todayDay, state.runs, state.plans) : ''
  const monthDays = useMemo(() => monthGrid(month), [month])
  const sortedDays = [...state.schedule].sort((a, b) => a.date.localeCompare(b.date))
  const futureDays = sortedDays.filter((day0) => day0.date >= today)
  const pastDays = sortedDays.filter((day0) => day0.date < today).reverse()
  const listDays = showPastDays ? [...pastDays, ...futureDays] : futureDays
  const visibleDays = scheduleView === 'list' ? listDays.slice(0, visibleListCount) : sortedDays
  const pushToast = (message: string) => setToasts((current) => [...current, { id: id('toast'), message }])
  const persistExercisesCollection = useCallback(async (nextExercises: Exercise[]) => {
    if (!supabase || !user) return true

    const client = supabase
    const exerciseRows = nextExercises.map((exercise) => ({
      id: exercise.id,
      user_id: user.id,
      name: exercise.name,
      category: exercise.category,
      equipment: exercise.equipment,
      notes: exercise.notes,
      default_type: exercise.defaultType,
      allowed: exercise.allowed,
      target: exercise.target,
      refs: exercise.refs,
      progress_metric: exercise.progressMetric,
    }))
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
      .filter((exercise) => requiredExerciseIds.has(exercise.id))
      .map((exercise) => ({
        id: exercise.id,
        user_id: user.id,
        name: exercise.name,
        category: exercise.category,
        equipment: exercise.equipment,
        notes: exercise.notes,
        default_type: exercise.defaultType,
        allowed: exercise.allowed,
        target: exercise.target,
        refs: exercise.refs,
        progress_metric: exercise.progressMetric,
      }))

    if (exercisesToEnsure.length) {
      const { error } = await client.from('exercises').upsert(exercisesToEnsure)
      if (error) {
        console.error('schedule dependency exercise upsert failed', error)
        return false
      }
    }

    const requiredPlanIds = new Set(nextRuns.map((run) => run.planId).filter(Boolean))
    const plansToEnsure = availablePlans
      .filter((plan0) => requiredPlanIds.has(plan0.id))
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
    }

    return true
  }, [state.exercises, state.plans, user])
  const persistPlans = useCallback(async (nextPlans: Plan[]) => {
    if (!supabase || !user) return true

    const client = supabase
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

    const [{ data: currentPlans }, { data: currentDays }, { data: currentItems }] = await Promise.all([
      client.from('plans').select('id').eq('user_id', user.id),
      client.from('plan_days').select('id').eq('user_id', user.id),
      client.from('plan_items').select('id').eq('user_id', user.id),
    ])

    const removedItemIds = (currentItems ?? []).map((row) => row.id).filter((id0) => !itemRows.some((row) => row.id === id0))
    if (removedItemIds.length) {
      const { error } = await client.from('plan_items').delete().eq('user_id', user.id).in('id', removedItemIds)
      if (error) {
        console.error('plan item delete failed', error)
        return false
      }
    }

    const removedDayIds = (currentDays ?? []).map((row) => row.id).filter((id0) => !dayRows.some((row) => row.id === id0))
    if (removedDayIds.length) {
      const { error } = await client.from('plan_days').delete().eq('user_id', user.id).in('id', removedDayIds)
      if (error) {
        console.error('plan day delete failed', error)
        return false
      }
    }

    const removedPlanIds = (currentPlans ?? []).map((row) => row.id).filter((id0) => !planRows.some((row) => row.id === id0))
    if (removedPlanIds.length) {
      const { error } = await client.from('plans').delete().eq('user_id', user.id).in('id', removedPlanIds)
      if (error) {
        console.error('plan delete failed', error)
        return false
      }
    }

    if (planRows.length) {
      const { error } = await client.from('plans').upsert(planRows)
      if (error) {
        console.error('plan upsert failed', error)
        return false
      }
    }
    if (dayRows.length) {
      const { error } = await client.from('plan_days').upsert(dayRows)
      if (error) {
        console.error('plan day upsert failed', error)
        return false
      }
    }
    if (itemRows.length) {
      const { error } = await client.from('plan_items').upsert(itemRows)
      if (error) {
        console.error('plan item upsert failed', error)
        return false
      }
    }

    return true
  }, [user])
  const persistScheduleData = useCallback(async (nextSchedule: Day[], nextRuns: Run[], nextLogs: Log[], availablePlans: Plan[] = state.plans) => {
    if (!supabase || !user) return true

    const dependenciesReady = await ensureScheduleDependencies(nextSchedule, nextRuns, nextLogs, availablePlans)
    if (!dependenciesReady) return false

    const client = supabase
    const validPlanIds = new Set(availablePlans.map((plan0) => plan0.id))
    const runRows = nextRuns.map((run) => ({
      id: run.id,
      user_id: user.id,
      plan_id: run.planId && validPlanIds.has(run.planId) ? run.planId : null,
      start_date: run.startDate,
      name: run.name,
    }))
    const dayRows = nextSchedule.map((day0) => ({
      id: scheduleDayId(day0.date),
      user_id: user.id,
      date: day0.date,
      notes: day0.notes,
      skipped: day0.skipped,
      run_id: day0.runId ?? null,
      day_no: day0.dayNo ?? null,
    }))
    const itemRows = nextSchedule.flatMap((day0) => day0.items.map((item) => ({
      id: item.id,
      user_id: user.id,
      schedule_day_id: scheduleDayId(day0.date),
      exercise_id: item.exerciseId,
      type: item.type,
      target: item.target,
      ref: item.ref,
      done: item.done,
      result: item.result,
    })))
    const logRows = nextLogs.map((entry) => ({
      id: entry.id,
      user_id: user.id,
      source_item_id: entry.sourceItemId ?? null,
      exercise_id: entry.exerciseId,
      date: entry.date,
      type: entry.type,
      target: entry.target,
      result: entry.result,
    }))

    const [{ data: currentRuns }, { data: currentDays }, { data: currentItems }, { data: currentLogs }] = await Promise.all([
      client.from('runs').select('id').eq('user_id', user.id),
      client.from('schedule_days').select('id').eq('user_id', user.id),
      client.from('schedule_items').select('id').eq('user_id', user.id),
      client.from('logs').select('id').eq('user_id', user.id),
    ])

    const removedLogIds = (currentLogs ?? []).map((row) => row.id).filter((id0) => !logRows.some((row) => row.id === id0))
    if (removedLogIds.length) {
      const { error } = await client.from('logs').delete().eq('user_id', user.id).in('id', removedLogIds)
      if (error) {
        console.error('log delete failed', error)
        return false
      }
    }

    const removedItemIds = (currentItems ?? []).map((row) => row.id).filter((id0) => !itemRows.some((row) => row.id === id0))
    if (removedItemIds.length) {
      const { error } = await client.from('schedule_items').delete().eq('user_id', user.id).in('id', removedItemIds)
      if (error) {
        console.error('schedule item delete failed', error)
        return false
      }
    }

    const removedDayIds = (currentDays ?? []).map((row) => row.id).filter((id0) => !dayRows.some((row) => row.id === id0))
    if (removedDayIds.length) {
      const { error } = await client.from('schedule_days').delete().eq('user_id', user.id).in('id', removedDayIds)
      if (error) {
        console.error('schedule day delete failed', error)
        return false
      }
    }

    const removedRunIds = (currentRuns ?? []).map((row) => row.id).filter((id0) => !runRows.some((row) => row.id === id0))
    if (removedRunIds.length) {
      const { error } = await client.from('runs').delete().eq('user_id', user.id).in('id', removedRunIds)
      if (error) {
        console.error('run delete failed', error)
        return false
      }
    }

    if (runRows.length) {
      const { error } = await client.from('runs').upsert(runRows)
      if (error) {
        console.error('run upsert failed', error)
        return false
      }
    }
    if (dayRows.length) {
      const { error } = await client.from('schedule_days').upsert(dayRows)
      if (error) {
        console.error('schedule day upsert failed', error)
        return false
      }
    }
    if (itemRows.length) {
      const { error } = await client.from('schedule_items').upsert(itemRows)
      if (error) {
        console.error('schedule item upsert failed', error)
        return false
      }
    }
    if (logRows.length) {
      const { error } = await client.from('logs').upsert(logRows)
      if (error) {
        console.error('log upsert failed', error)
        return false
      }
    }

    return true
  }, [ensureScheduleDependencies, state.plans, user])
  const commitPlans = async (nextPlans: Plan[], nextSelectedPlanId?: string | null) => {
    const normalizedPlans = nextPlans.map((plan0) => ({ ...plan0, days: normalizePlanDaysData(plan0.days) }))
    setState((current) => ({ ...current, plans: normalizedPlans }))
    const resolvedPlanId = nextSelectedPlanId === undefined ? selectedPlanId : nextSelectedPlanId
    const nextPlan = normalizedPlans.find((plan0) => plan0.id === resolvedPlanId) ?? normalizedPlans.find((plan0) => plan0.name === 'Amped') ?? normalizedPlans[0] ?? null
    setSelectedPlanId(nextPlan?.id ?? null)
    setPlanForm(nextPlan ? formFromPlan(nextPlan) : emptyPlanForm())

    const ok = await persistPlans(normalizedPlans)
    if (!ok) {
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
        if (!ok) {
          pushToast('Could not save schedule.')
        }
      })
      scheduleSaveTimerRef.current = null
    }, 250)
  }, [persistScheduleData])
  const commitScheduleState = async (nextSchedule: Day[], nextRuns: Run[], nextLogs: Log[], options?: { selectedDate?: string; persistMode?: 'queued' | 'immediate' }) => {
    const normalizedSchedule = nextSchedule.map(normalizeScheduleDay)
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
      if (!ok) {
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
    const plansOk = exercisesOk ? await persistPlans(normalized.plans) : false
    const scheduleOk = plansOk ? await persistScheduleData(normalized.schedule, normalized.runs, normalized.logs, normalized.plans) : false
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
      const { data, error } = await client
        .from('exercises')
        .select('id, name, category, equipment, notes, default_type, allowed, target, refs, progress_metric')
        .eq('user_id', user.id)
        .order('name', { ascending: true })

      if (!active || authUserRef.current !== ownerId || error) return

      if (!data || data.length === 0) {
        const payload = starterExercises.map((exercise) => ({
          id: exercise.id,
          user_id: user.id,
          name: exercise.name,
          category: exercise.category,
          equipment: exercise.equipment,
          notes: exercise.notes,
          default_type: exercise.defaultType,
          allowed: exercise.allowed,
          target: exercise.target,
          refs: exercise.refs,
          progress_metric: exercise.progressMetric,
        }))
        const { error: seedError } = await client.from('exercises').upsert(payload)
        if (seedError || !active || authUserRef.current !== ownerId) return
        setState((current) => ({ ...current, exercises: starterExercises }))
        setSelectedExerciseId((current) => current ?? starterExercises[0]?.id ?? null)
        setSelectedProgressExerciseId((current) => current ?? starterExercises[0]?.id ?? null)
        return
      }

      const remoteExercises = data.map(mapExerciseRow)
      if (authUserRef.current !== ownerId) return
      setState((current) => ({ ...current, exercises: remoteExercises }))
      setSelectedExerciseId((current) => current && remoteExercises.some((exercise) => exercise.id === current) ? current : remoteExercises[0]?.id ?? null)
      setSelectedProgressExerciseId((current) => current && remoteExercises.some((exercise) => exercise.id === current) ? current : remoteExercises[0]?.id ?? null)
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
        if (starterPlans.length === 0) return
        const nextPlans = starterPlans
        const dayRows = nextPlans.flatMap((plan0) => plan0.days.map((day0, index) => ({
          id: day0.id,
          user_id: user.id,
          plan_id: plan0.id,
          day_number: index + 1,
          notes: day0.notes ?? '',
        })))
        const itemRows = nextPlans.flatMap((plan0) => plan0.days.flatMap((day0) => day0.items.map((item) => ({
          id: item.id,
          user_id: user.id,
          plan_day_id: day0.id,
          exercise_id: item.exerciseId,
          type: item.type,
          target: item.target,
          ref: item.ref,
        }))))
        const { error: seedPlanError } = await client.from('plans').upsert(nextPlans.map((plan0) => ({
          id: plan0.id,
          user_id: user.id,
          name: plan0.name,
          focus: plan0.focus,
        })))
        if (seedPlanError || !active || authUserRef.current !== ownerId) return
        if (dayRows.length) {
          const { error: seedDayError } = await client.from('plan_days').upsert(dayRows)
          if (seedDayError || !active || authUserRef.current !== ownerId) return
        }
        if (itemRows.length) {
          const { error: seedItemError } = await client.from('plan_items').upsert(itemRows)
          if (seedItemError || !active || authUserRef.current !== ownerId) return
        }
        setState((current) => ({ ...current, plans: nextPlans }))
        setSelectedPlanId((current) => current && nextPlans.some((plan0) => plan0.id === current) ? current : null)
        return
      }

      const planIds = planRows.map((row) => row.id)
      const [{ data: dayRows, error: dayError }, { data: itemRows, error: itemError }] = await Promise.all([
        client.from('plan_days').select('id, plan_id, day_number, notes').eq('user_id', user.id).in('plan_id', planIds).order('day_number', { ascending: true }),
        client.from('plan_items').select('id, plan_day_id, exercise_id, type, target, ref').eq('user_id', user.id),
      ])

      if (!active || authUserRef.current !== ownerId || dayError || itemError || !dayRows || !itemRows) return

      const remotePlans = mapPlanRows(planRows, dayRows, itemRows)
      const repairedPlans = mergeStarterAmped(remotePlans, starterPlans)
      if (repairedPlans !== remotePlans) {
        const repaired = await persistPlans(repairedPlans)
        if (!repaired || !active || authUserRef.current !== ownerId) return
      }
      if (authUserRef.current !== ownerId) return
      setState((current) => ({ ...current, plans: repairedPlans }))
      setSelectedPlanId((current) => current && repairedPlans.some((plan0) => plan0.id === current) ? current : null)
    }

    void syncPlans()

    return () => {
      active = false
    }
  }, [user, starterPlans, state.exercises.length, persistPlans])
  useEffect(() => {
    if (!supabase || !user || state.exercises.length === 0) return

    let active = true
    const client = supabase
    const ownerId = user.id
    const syncSchedule = async () => {
      const [{ data: runRows, error: runError }, { data: dayRows, error: dayError }, { data: itemRows, error: itemError }, { data: logRows, error: logError }] = await Promise.all([
        client.from('runs').select('id, plan_id, start_date, name').eq('user_id', user.id).order('start_date', { ascending: true }),
        client.from('schedule_days').select('id, date, notes, skipped, run_id, day_no').eq('user_id', user.id).order('date', { ascending: true }),
        client.from('schedule_items').select('id, schedule_day_id, exercise_id, type, target, ref, done, result').eq('user_id', user.id),
        client.from('logs').select('id, source_item_id, exercise_id, date, type, target, result').eq('user_id', user.id).order('date', { ascending: true }),
      ])

      if (!active || authUserRef.current !== ownerId || runError || dayError || itemError || logError || !runRows || !dayRows || !itemRows || !logRows) return

      if (runRows.length === 0 && dayRows.length === 0 && itemRows.length === 0 && logRows.length === 0) {
        const localSchedule = localScheduleRef.current.schedule
        const localRuns = localScheduleRef.current.runs
        const localLogs = localScheduleRef.current.logs
        if (localSchedule.length === 0 && localRuns.length === 0 && localLogs.length === 0) return
        const seeded = await persistScheduleData(localSchedule, localRuns, localLogs)
        if (!seeded || !active || authUserRef.current !== ownerId) return
        setState((current) => ({ ...current, schedule: localSchedule.map(normalizeScheduleDay), runs: localRuns, logs: localLogs }))
        return
      }

      const remoteRuns = mapRunRows(runRows)
      const remoteSchedule = mapScheduleRows(dayRows, itemRows)
      const remoteLogs = mapLogRows(logRows)
      if (authUserRef.current !== ownerId) return
      setState((current) => ({ ...current, runs: remoteRuns, schedule: remoteSchedule, logs: remoteLogs }))
    }

    void syncSchedule()

    return () => {
      active = false
    }
  }, [user, state.exercises.length, persistScheduleData])
  const progressHistory = useMemo(() => {
    if (!progressExercise) return []
    return [...derivedHistory]
      .filter((entry) => entry.exerciseId === progressExercise.id && entry.done)
      .filter((entry) => metric(effectiveProgressMetric(progressExercise, entry.type), entry) !== undefined)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [derivedHistory, progressExercise])
  const editingLog = progressHistory.find((entry) => entry.id === editingLogId)
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
  const userAvatar = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? null
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
    setUser(null)
    loadWorkspaceState(signedOutState())
    const { error } = await supabase.auth.signOut()
    if (error) {
      pushToast('Could not sign out.')
      return
    }
    pushToast('Signed out.')
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
    await upsertDay(date, (d0) => ({ ...d0, skipped: false, items: [...d0.items, { id: id('it'), exerciseId, type: ex.defaultType, target: clone(ex.target), ref: ex.refs[0] ?? 'last-result', done: false, result: {} }] }))
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
  const removeItem = async (itemId: string) => {
    const nextSchedule = state.schedule.map((day0) => day0.date === selected ? normalizeScheduleDay({ ...day0, items: day0.items.filter((item) => item.id !== itemId) }) : day0)
    const nextLogs = state.logs.filter((entry) => entry.sourceItemId !== itemId)
    await commitScheduleState(nextSchedule, state.runs, nextLogs)
  }
  const beginLogEdit = (log: Log) => {
    const exercise = exById[log.exerciseId]
    if (!exercise) return
    setEditingLogId(log.id)
    setProgressEdit(defaultResultForLog(log, exercise))
  }
  const cancelLogEdit = () => {
    setEditingLogId(null)
    setProgressEdit({})
  }
  const saveItemDraft = async (item: Item, exercise: Exercise) => {
    const draft = itemDrafts[item.id] ?? makeItemDraft(item, exercise)
    const nextResult: Result = {}
    const parsedSeconds = parseSecs(draft.timeText)
    const parsedWeight = draft.weightText.trim() ? Number(draft.weightText) : undefined
    const parsedCount = draft.countText.trim() ? Number(draft.countText) : undefined

    if (draft.note.trim()) nextResult.note = draft.note.trim()
    if (draft.timeText.trim()) {
      nextResult.seconds = parsedSeconds
      nextResult.timeText = parsedSeconds !== undefined ? fmtSecs(parsedSeconds) : draft.timeText
    }
    if (parsedWeight !== undefined && !Number.isNaN(parsedWeight)) nextResult.weight = parsedWeight
    if (parsedCount !== undefined && !Number.isNaN(parsedCount)) nextResult.count = parsedCount

    const saved = await updateItem(item.id, (x) => ({
      ...x,
      type: draft.type,
      target: clone(draft.target),
      result: nextResult,
    }), { persistMode: 'immediate' })

    if (saved !== false) {
      setItemDrafts((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
    }
  }
  function loadWorkspaceState(next: State) {
    setState(next)
    const nextToday = key(new Date())
    setSelected(nextToday)
    setMonth(monthKey(nextToday))
    setSelectedExerciseId(next.exercises[0]?.id ?? null)
    setExerciseForm(next.exercises[0] ? formFromExercise(next.exercises[0]) : emptyExerciseForm())
    setSelectedProgressExerciseId(next.exercises[0]?.id ?? null)
    setSelectedPlanId(null)
    setPlanForm(emptyPlanForm())
    setApplyPlanId(null)
    setApplyStartDate(nextToday)
    setItemDrafts({})
    cancelLogEdit()
  }
  const saveLogEdit = async () => {
    if (!editingLog) return
    const exercise = exById[editingLog.exerciseId]
    if (!exercise) return
    const nextResult: Result = {
      seconds: progressEdit.seconds,
      timeText: progressEdit.timeText,
      weight: progressEdit.weight,
      count: progressEdit.count,
      note: progressEdit.note,
    }
    if (editingLog.sourceItemId) {
      await updateItemOnDate(editingLog.date, editingLog.sourceItemId, (item) => ({ ...item, result: nextResult, done: true }), { persistMode: 'immediate' })
    } else {
      await commitScheduleState(state.schedule, state.runs, state.logs.map((entry) => entry.id === editingLog.id ? { ...entry, result: nextResult } : entry), { persistMode: 'immediate' })
    }
    pushToast(`${exercise.name} log updated.`)
    cancelLogEdit()
  }
  const openLogDay = (log: Log) => {
    setTab('schedule')
    setSelected(log.date)
    setMonth(monthKey(log.date))
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

  const toggleDone = (date: string, item: Item) => {
    const nextDone = !item.done
    const exercise = exById[item.exerciseId]
    const progressMetric = exercise ? effectiveProgressMetric(exercise, item.type) : 'count'
    const priorRows = derivedHistory
      .filter((h) => h.exerciseId === item.exerciseId && h.done && h.sourceItemId !== item.id)
      .sort((a, b) => b.date.localeCompare(a.date))
    const nextItem = { ...item, done: nextDone }
    void updateItemOnDate(date, item.id, () => nextItem)

    if (nextDone && exercise) {
      pushToast(`${exercise.name} complete.`)
      const candidate: Log = {
        id: 'candidate',
        exerciseId: item.exerciseId,
        date,
        type: item.type,
        target: clone(item.target),
        result: {
          ...item.result,
          count: progressMetric === 'count' ? (item.result.count ?? totalCount(item.target)) : item.result.count,
        },
        done: true,
      }
      const bestBefore = priorRows.reduce<Log | undefined>((acc, row) => {
        if (!acc) return row
        const a = metric(progressMetric, acc)
        const b = metric(progressMetric, row)
        if (b === undefined) return acc
        if (a === undefined) return row
        return progressMetric === 'time' ? (b < a ? row : acc) : (b > a ? row : acc)
      }, undefined)
      const candidateMetric = metric(progressMetric, candidate)
      const bestMetric = bestBefore ? metric(progressMetric, bestBefore) : undefined
      if (candidateMetric !== undefined && (bestMetric === undefined || (progressMetric === 'time' ? candidateMetric < bestMetric : candidateMetric > bestMetric))) {
        pushToast(`New PB for ${exercise.name}.`)
      }

      const currentDay = dayByDate[date]
      const doneCount = (currentDay?.items.filter((existing) => existing.done).length ?? 0) + (item.done ? 0 : 1)
      const dayItemCount = currentDay?.items.length ?? 0
      if (dayItemCount > 0 && doneCount === dayItemCount) {
        pushToast('Day complete. Keep it moving.')
      }
    }
  }

  const applyPlanById = async (planIdToApply: string, startDate: string) => {
    const targetPlan = state.plans.find((p) => p.id === planIdToApply)
    if (!targetPlan) return
    const runId = id('run')
    const made: Day[] = targetPlan.days.map((pd, i) => ({ date: add(startDate, i), notes: pd.notes || `${targetPlan.name} - ${pd.label}`, rest: pd.rest, skipped: false, runId, dayNo: i + 1, items: pd.items.map((it) => ({ id: id('it'), exerciseId: it.exerciseId, type: it.type, target: clone(it.target), ref: it.ref, done: false, result: {} })) }))
    const replacedItemIds = new Set(state.schedule.filter((day0) => made.some((created) => created.date === day0.date)).flatMap((day0) => day0.items.map((item) => item.id)))
    await commitScheduleState(
      [...state.schedule.filter((x) => !made.some((m) => m.date === x.date)), ...made],
      [...state.runs, { id: runId, planId: targetPlan.id, startDate, name: `${targetPlan.name} starting ${fmtShort(startDate)}` }],
      state.logs.filter((entry) => !entry.sourceItemId || !replacedItemIds.has(entry.sourceItemId)),
    )
  }

  const shiftPlan = async () => {
    if (!day.runId || shift < 1) return
    const nextDate = add(selected, shift)
    const shiftedItems = new Map<string, string>()
    const nextSchedule = state.schedule.map((x) => {
      if (x.runId === day.runId && x.date >= selected) {
        const shiftedDate = add(x.date, shift)
        x.items.forEach((item) => shiftedItems.set(item.id, shiftedDate))
        return { ...x, date: shiftedDate }
      }
      return x
    })
    await commitScheduleState(
      nextSchedule,
      state.runs.map((r) => r.id === day.runId ? { ...r, startDate: r.startDate >= selected ? add(r.startDate, shift) : r.startDate } : r),
      state.logs.map((entry) => entry.sourceItemId && shiftedItems.has(entry.sourceItemId) ? { ...entry, date: shiftedItems.get(entry.sourceItemId)! } : entry),
      { selectedDate: nextDate },
    )
  }

  const skipPlanDay = async () => upsertDay(selected, (d0) => ({ ...d0, skipped: true }))

  const addPlanDayAt = async (index: number) => {
    if (!plan) return
    const nextPlans = state.plans.map((p) => p.id === plan.id ? { ...p, days: normalizePlanDaysData([...p.days.slice(0, index), { id: id('pd'), label: '', rest: true, items: [] }, ...p.days.slice(index)]) } : p)
    await commitPlans(nextPlans, plan.id)
  }
  const updatePlanDay = async (dayId: string, fx: (x: PlanDay) => PlanDay) => {
    if (!plan) return
    const nextPlans = state.plans.map((p) => p.id === plan.id ? { ...p, days: normalizePlanDaysData(p.days.map((x) => x.id === dayId ? fx(x) : x)) } : p)
    await commitPlans(nextPlans, plan.id)
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
    await commitPlans(nextPlans, selectedPlanId)
  }
  const startNewPlan = async () => {
    const nextPlan: Plan = { id: id('plan'), name: 'New plan', focus: '', days: [] }
    await commitPlans([...state.plans, nextPlan], nextPlan.id)
  }
  const selectPlan = (nextPlanId: string) => {
    const nextPlan = state.plans.find((p) => p.id === nextPlanId)
    if (!nextPlan) return
    setSelectedPlanId(nextPlanId)
    setPlanForm(formFromPlan(nextPlan))
  }
  const deletePlan = async () => {
    if (!selectedPlanId) return
    const remainingPlans = state.plans.filter((p) => p.id !== selectedPlanId)
    const nextPlan = remainingPlans[0] ?? null
    await commitPlans(remainingPlans, nextPlan?.id ?? null)
  }
  const deleteExercise = async (exerciseId: string) => {
    if (supabase && user) {
      const client = supabase
      const { error } = await client.from('exercises').delete().eq('id', exerciseId).eq('user_id', user.id)
      if (error) {
        pushToast('Could not delete exercise.')
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
    setSelectedProgressExerciseId((current) => current === exerciseId ? nextExercise?.id ?? null : current)
    setExerciseForm(nextExercise ? formFromExercise(nextExercise) : emptyExerciseForm())
  }
  const deleteRun = async (runId: string) => {
    const nextSchedule = state.schedule.filter((day0) => day0.runId !== runId)
    const nextRuns = state.runs.filter((run) => run.id !== runId)
    const nextLogs = state.logs.filter((entry) => {
      if (!entry.sourceItemId) return true
      return !state.schedule.some((day0) => day0.runId === runId && day0.items.some((item) => item.id === entry.sourceItemId))
    })
    await commitScheduleState(nextSchedule, nextRuns, nextLogs)
  }
  const resetAllData = async () => {
    await replaceWorkspaceState(ensureAmpedData(seed()))
    pushToast('App data reset.')
  }
  const resetScheduleData = async () => {
    await commitScheduleState([], [], state.logs.filter((entry) => !entry.sourceItemId), { selectedDate: today })
    cancelLogEdit()
    pushToast('Schedule and active runs cleared.')
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
    cancelLogEdit()
    pushToast('Progress history cleared.')
  }
  const confirmAction = async () => {
    if (!confirmState) return
    if (confirmState.kind === 'delete-run') await deleteRun(confirmState.runId)
    if (confirmState.kind === 'delete-plan') await deletePlan()
    if (confirmState.kind === 'delete-exercise') await deleteExercise(confirmState.exerciseId)
    if (confirmState.kind === 'import-data') await importData()
    if (confirmState.kind === 'reset-all-data') await resetAllData()
    if (confirmState.kind === 'reset-schedule-data') await resetScheduleData()
    if (confirmState.kind === 'reset-progress-data') await resetProgressData()
    setConfirmState(null)
  }
  const cancelConfirm = () => {
    if (confirmState?.kind === 'import-data') {
      setPendingImport(null)
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
    await commitPlans(nextPlans, plan.id)
    setDraggedPlanDayId(null)
  }
  const deletePlanDay = async (dayId: string) => {
    if (!plan) return
    const nextPlans = state.plans.map((p) =>
      p.id === plan.id
        ? { ...p, days: normalizePlanDaysData(p.days.filter((day) => day.id !== dayId)) }
        : p,
    )
    await commitPlans(nextPlans, plan.id)
  }

  const saveExercise = async () => {
    if (!exerciseForm.name.trim()) return
    const nextExercise: Exercise = {
      id: selectedExerciseId ?? id('ex'),
      name: exerciseForm.name.trim(),
      category: exerciseForm.category || CATEGORY_OPTIONS[0],
      equipment: exerciseForm.equipment || 'Open',
      notes: exerciseForm.notes,
      defaultType: exerciseForm.defaultType,
      allowed: exerciseForm.allowed,
      target: clone(exerciseForm.target),
      refs: exerciseForm.refs,
      progressMetric: exerciseForm.progressMetric,
    }

    if (supabase && user) {
      const client = supabase
      const { error } = await client.from('exercises').upsert({
        id: nextExercise.id,
        user_id: user.id,
        name: nextExercise.name,
        category: nextExercise.category,
        equipment: nextExercise.equipment,
        notes: nextExercise.notes,
        default_type: nextExercise.defaultType,
        allowed: nextExercise.allowed,
        target: nextExercise.target,
        refs: nextExercise.refs,
        progress_metric: nextExercise.progressMetric,
      })
      if (error) {
        pushToast('Could not save exercise.')
        return
      }
    }

    setState((s) => ({
      ...s,
      exercises: selectedExerciseId
        ? s.exercises.map((ex) => ex.id === selectedExerciseId ? nextExercise : ex)
        : [...s.exercises, nextExercise],
    }))

    setSelectedExerciseId(nextExercise.id)
    setExerciseForm(formFromExercise(nextExercise))
  }

  const startNewExercise = () => {
    setSelectedExerciseId(null)
    setExerciseForm(emptyExerciseForm())
    focusExerciseEditor()
  }

  const selectExercise = (exerciseId: string) => {
    const exercise = exById[exerciseId]
    if (!exercise) return
    setSelectedExerciseId(exerciseId)
    setExerciseForm(formFromExercise(exercise))
    focusExerciseEditor()
  }

  return (
    <div className="app">
      <header className="hero simpleHero">
        <div className="appHeaderRow">
          <div>
            <h1>Discipline +</h1>
          </div>
          <div className="profileDock">
            {hasSupabaseEnv && !user && !authLoading && <button className="pill" onClick={signInWithGoogle}>Sign in</button>}
            {hasSupabaseEnv && user && <button className="avatarButton" onClick={() => setTab('settings')} aria-label="Open profile settings">
              {userAvatar ? <img src={userAvatar} alt={user.email ?? 'Profile'} className="avatarImage" /> : <span className="avatarFallback">{(user.email ?? 'U').slice(0, 1).toUpperCase()}</span>}
            </button>}
            <button className={tab === 'settings' ? 'iconPill activeIconPill' : 'iconPill'} onClick={() => setTab('settings')} aria-label="Open settings">⚙</button>
          </div>
        </div>
      </header>

      <nav className="nav">
        {(['schedule', 'exercises', 'plans', 'progress'] as const).map((x) => <button key={x} className={tab === x ? 'pill active' : 'pill'} onClick={() => setTab(x)}>{x[0].toUpperCase() + x.slice(1)}</button>)}
      </nav>

      {tab === 'schedule' && <main className="grid">
        <section ref={dayDetailRef} className="panel stack scheduleDetailPanel">
            <div><p className="eyebrow">Day detail</p><h2>{fmtDay(selected)}</h2>{selectedDayPlanLabel && <p className="mutedCopy">{selectedDayPlanLabel}</p>}</div>
          {day.skipped && <p className="status warn">This plan day is marked skipped.</p>}
          <label className="field">
            <span>Add exercise to this day</span>
            <select
              defaultValue=""
              onChange={(event) => {
                if (!event.target.value) return
                void addExerciseToDay(event.target.value, selected)
                event.target.value = ''
              }}
            >
              <option value="">Select exercise</option>
              {sortedExercises.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
            </select>
          </label>
          {!day.rest && <>
            <div className="stack">{day.items.length === 0 && <div className="empty">No exercises yet.</div>}{day.items.map((item) => {
              const ex = exById[item.exerciseId]; if (!ex) return null
              const expanded = expandedItems[item.id] ?? false
              const draft = itemDrafts[item.id] ?? makeItemDraft(item, ex)
              const progressMetric = effectiveProgressMetric(ex, draft.type)
              const metricActions = ex.refs.map((r) => <button key={r} className="miniAction" onClick={() => setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), target: referenceTarget(derivedHistory, ex, r, draft.type, draft.target) } }))}>{r === 'last-result' ? 'Last' : 'PB'} {referenceSummary(derivedHistory, ex, r, draft.type)}</button>)
              return <article key={item.id} className="card">
                <div className="row top">
                  <button className={item.done ? 'ring done' : 'ring'} onClick={() => toggleDone(selected, item)} aria-label={`Mark ${ex.name} complete`}><span /></button>
                  <button className="exerciseToggle" onClick={() => {
                    if (!expanded) {
                      setItemDrafts((current) => current[item.id] ? current : { ...current, [item.id]: makeItemDraft(item, ex) })
                    }
                    setExpandedItems((current) => ({ ...current, [item.id]: !expanded }))
                  }}>
                    <div className="grow"><h3>{ex.name}</h3><p>{compact(item.type, item.target)}</p></div>
                    {expanded && <span>Hide</span>}
                  </button>
                  <button className="iconPill" onClick={() => removeItem(item.id)} aria-label={`Remove ${ex.name} from ${fmtDay(selected)}`}>🗑</button>
                </div>
                {expanded && <>
                  <div className="detailCompactRow">
                    <label className="field compactSelectField"><span>Target type</span><select value={draft.type} onChange={(e) => setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), type: e.target.value as TT, target: blank(e.target.value as TT), timeText: '', weightText: '', countText: '', note: draft.note } }))}>{ex.allowed.map((t) => <option key={t} value={t}>{TT_LABEL[t]}</option>)}</select></label>
                    <TargetEditor
                      type={draft.type}
                      target={draft.target}
                      layout="detail"
                      onChange={(target) => setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), target } }))}
                    />
                  </div>
                  <div className="detailCompactRow resultRow">
                    {progressMetric === 'time' && <label className="field compactMetricField"><span>Time logged</span><input placeholder="mm:ss or minutes" value={draft.timeText} onChange={(e) => setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), timeText: e.target.value } }))} onBlur={() => setItemDrafts((current) => {
                      const activeDraft = current[item.id] ?? makeItemDraft(item, ex)
                      const parsed = parseSecs(activeDraft.timeText)
                      return { ...current, [item.id]: { ...activeDraft, timeText: parsed !== undefined ? fmtSecs(parsed) : activeDraft.timeText } }
                    })} /></label>}
                    {progressMetric === 'weight' && <label className="field compactMetricField"><span>Weight used</span><input type="text" inputMode="decimal" placeholder="0" value={draft.weightText} onChange={(e) => setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), weightText: e.target.value } }))} /></label>}
                    {progressMetric === 'count' && draft.type !== 'duration' && draft.type !== 'for-time' && <label className="field compactMetricField"><span>Actual reps</span><input type="text" inputMode="numeric" placeholder={`${totalCount(draft.target)}`} value={draft.countText} onChange={(e) => setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), countText: e.target.value } }))} /></label>}
                    <div className="targetActions">{metricActions}</div>
                  </div>
                  <label className="field"><span>Completion note</span><input value={draft.note} onChange={(e) => setItemDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? makeItemDraft(item, ex)), note: e.target.value } }))} placeholder="Optional note for this day" /></label>
                  <div className="nav">
                    <button className="primary" onClick={() => saveItemDraft(item, ex)}>Save</button>
                  </div>
                </>}
              </article>
            })}</div>
            <label className="field"><span>Day notes</span><textarea rows={3} value={day.notes} onChange={(e) => upsertDay(selected, (d0) => ({ ...d0, notes: e.target.value }))} /></label>
            {day.runId && <div className="row wrap dayActions compactDayActions"><button className="pill" onClick={skipPlanDay}>Skip day</button><div className="inline compactInline"><input type="number" min={1} max={99} value={shift} onChange={(e) => setShift(Number(e.target.value))} /><button className="pill" onClick={shiftPlan}>Push forward</button></div></div>}
          </>}
          {day.rest && <label className="field"><span>Day notes</span><textarea rows={3} value={day.notes} onChange={(e) => upsertDay(selected, (d0) => ({ ...d0, notes: e.target.value }))} /></label>}
          {day.rest && day.runId && <div className="row wrap dayActions compactDayActions"><button className="pill" onClick={skipPlanDay}>Skip day</button><div className="inline compactInline"><input type="number" min={1} max={99} value={shift} onChange={(e) => setShift(Number(e.target.value))} /><button className="pill" onClick={shiftPlan}>Push forward</button></div></div>}
        </section>

        <section className="panel scheduleCalendarPanel">
          <div className="todaySummary">
            <div className="row">
              <div><p className="eyebrow">Today</p><h2>{fmtDay(today)}</h2>{todayPlanLabel && <p className="mutedCopy">{todayPlanLabel}</p>}</div>
              <button className="primary" onClick={() => focusDay(today, true)}>Open</button>
            </div>
            <div className="todayList">
              {todayItems.length === 0 && <p className="mutedCopy">No exercises scheduled for today.</p>}
              {todayItems.map((item) => {
                const ex = exById[item.exerciseId]
                if (!ex) return null
                return <div key={item.id} className={item.done ? 'todayEntry doneEntry todayRow' : 'todayEntry todayRow'}>
                  <button className={item.done ? 'ring done' : 'ring'} onClick={() => toggleDone(today, item)} aria-label={`Mark ${ex.name} complete from today`}><span /></button>
                  <button className="todayOpenButton" onClick={() => focusDay(today, true)}>
                    <span>{item.done ? `Completed - ${ex.name}` : ex.name}</span>
                    <strong>{compact(item.type, item.target)}</strong>
                  </button>
                </div>
              })}
            </div>
          </div>
          <div className="row">
            <div><p className="eyebrow">Calendar</p></div>
            <div className="nav scheduleToggle">{(['calendar', 'list'] as const).map((x) => <button key={x} className={scheduleView === x ? 'pill active' : 'pill'} onClick={() => { setScheduleView(x); if (x === 'list') setVisibleListCount(5) }}>{x === 'calendar' ? 'Month' : 'List'}</button>)}</div>
          </div>
          {scheduleView === 'calendar' ? <div className="calendarWrap">
            <div className="row"><button className="pill" onClick={() => setMonth(add(month, -28))}>Previous</button><h3>{fmtMonth(month)}</h3><button className="pill" onClick={() => setMonth(add(month, 35))}>Next</button></div>
            <div className="week">{DAYS.map((x) => <span key={x}>{x}</span>)}</div>
            <div className="calendar">{monthDays.map((date) => {
              const x = dayByDate[date], sameMonth = date.startsWith(month.slice(0, 7))
              const isComplete = !!x && !x.rest && x.items.length > 0 && x.items.every((i) => i.done)
              const isRest = !x || x.items.length === 0 || x.rest
              return <button key={date} className={['day', date === selected && 'selected', date === today && 'todayMark', !sameMonth && 'dim', isComplete && 'completeDay'].filter(Boolean).join(' ')} onClick={() => focusDay(date, true)}>
                <span>{d(date).getDate()}</span>
                <small>{x?.skipped ? 'Skipped' : isRest ? 'Rest' : isComplete ? 'Done' : x ? `${x.items.filter((i) => i.done).length}/${x.items.length}` : 'Open'}</small>
              </button>
            })}</div>
          </div> : <div className="stack">{visibleDays.map((x) => {
            const isComplete = !x.rest && x.items.length > 0 && x.items.every((i) => i.done)
            const isRest = x.items.length === 0 || x.rest
            const planLabel = scheduledPlanLabel(x, state.runs, state.plans)
            return <button key={x.date} className={[x.date === selected ? 'listItem activeItem agendaItem' : 'listItem agendaItem', isComplete ? 'completeDay' : ''].filter(Boolean).join(' ')} onClick={() => focusDay(x.date, true)}>
            <div className="agendaDateRow">
              <strong>{fmtDay(x.date)}</strong>
              <span>{x.skipped ? 'Skipped' : isRest ? 'Rest' : isComplete ? 'Done' : `${x.items.filter((i) => i.done).length}/${x.items.length}`}</span>
            </div>
            {planLabel && <p className="mutedCopy">{planLabel}</p>}
            {isRest ? <p className="mutedCopy">- Rest day</p> : <div className="agendaBullets">
              {x.items.map((item) => {
                const ex = exById[item.exerciseId]
                if (!ex) return null
                return <div key={item.id} className="agendaBullet">{item.done ? '• ' : '• '}{ex.name} | {sum(item.type, item.target)}</div>
              })}
            </div>}
          </button>
          })}</div>}
          {scheduleView === 'list' && <div className="nav loadMoreRow">
            {!showPastDays && pastDays.length > 0 && <button className="pill" onClick={() => { setShowPastDays(true); setVisibleListCount((current) => current + pastDays.length) }}>Load previous</button>}
            {listDays.length > visibleListCount && <button className="pill" onClick={() => setVisibleListCount((current) => current + 5)}>Load 5 more</button>}
          </div>}
        </section>
      </main>}

      {confirmState && <div className="overlay">
        <div className="confirmCard">
          <h3>{confirmState.title}</h3>
          <p>{confirmState.body}</p>
          <div className="nav">
            <button className="primary" onClick={confirmAction}>Confirm</button>
            <button className="pill" onClick={cancelConfirm}>Cancel</button>
          </div>
        </div>
      </div>}

      {toasts.length > 0 && <div className="toastStack">
        {toasts.map((toast) => <div key={toast.id} className="toast">{toast.message}</div>)}
      </div>}

      {tab === 'exercises' && <main className="grid">
        <section className="panel stack">
          <div className="row">
            <div><p className="eyebrow">Exercises</p><h2>Select an exercise to manage it</h2></div>
            <button className="pill" onClick={startNewExercise}>New exercise</button>
          </div>
          <div className="stack">
            {sortedExercises.map((ex) => <button key={ex.id} className={selectedExerciseId === ex.id ? 'listItem activeItem' : 'listItem'} onClick={() => selectExercise(ex.id)}><strong>{ex.name}</strong></button>)}
          </div>
        </section>
        <section ref={exerciseDetailRef} className="panel stack">
          <div><p className="eyebrow">Manage exercise</p><h2>{selectedExerciseId ? 'Update exercise' : 'Create exercise'}</h2></div>
          <label className="field"><span>Name</span><input value={exerciseForm.name} onChange={(e) => setExerciseForm((x) => ({ ...x, name: e.target.value }))} /></label>
          <div className="split">
            <label className="field"><span>Category</span><select value={exerciseForm.category} onChange={(e) => setExerciseForm((x) => ({ ...x, category: e.target.value }))}>{Array.from(new Set([...CATEGORY_OPTIONS, ...state.exercises.map((ex) => ex.category), exerciseForm.category])).filter(Boolean).map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
            <label className="field"><span>Equipment</span><input value={exerciseForm.equipment} onChange={(e) => setExerciseForm((x) => ({ ...x, equipment: e.target.value }))} /></label>
          </div>
          <label className="field"><span>Notes</span><textarea rows={3} value={exerciseForm.notes} onChange={(e) => setExerciseForm((x) => ({ ...x, notes: e.target.value }))} /></label>
          <label className="field"><span>Default target type</span><select value={exerciseForm.defaultType} onChange={(e) => setExerciseForm((x) => ({ ...x, defaultType: e.target.value as TT, allowed: Array.from(new Set([...x.allowed, e.target.value as TT])), target: blank(e.target.value as TT) }))}>{(Object.keys(TT_LABEL) as TT[]).map((t) => <option key={t} value={t}>{TT_LABEL[t]}</option>)}</select></label>
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
          })}>{(Object.keys(PM_LABEL) as PM[]).map((metricOption) => <option key={metricOption} value={metricOption}>{PM_LABEL[metricOption]}</option>)}</select></label>
          <p className="mutedCopy">{progressMetricHint(exerciseForm)}</p>
          <TargetEditor type={exerciseForm.defaultType} target={exerciseForm.target} onChange={(target) => setExerciseForm((x) => ({ ...x, target }))} />
          <div><span className="fieldLabel">Allowed target types</span><div className="chips">{(Object.keys(TT_LABEL) as TT[]).map((t) => { const on = exerciseForm.allowed.includes(t); return <button key={t} className={on ? 'pill active' : 'pill'} onClick={() => setExerciseForm((x) => ({ ...x, allowed: on ? (x.allowed.filter((y) => y !== t).length ? x.allowed.filter((y) => y !== t) : [x.defaultType]) : [...x.allowed, t] }))}>{TT_LABEL[t]}</button> })}</div></div>
          <div><span className="fieldLabel">Reference choices</span><div className="chips">{(Object.keys(RM_LABEL) as RM[]).map((r) => { const on = exerciseForm.refs.includes(r); return <button key={r} className={on ? 'pill active' : 'pill'} onClick={() => setExerciseForm((x) => ({ ...x, refs: on ? x.refs.filter((y) => y !== r) : [...x.refs, r] }))}>{RM_LABEL[r]}</button> })}</div></div>
          <div className="nav">
            <button className="primary" onClick={saveExercise}>{selectedExerciseId ? 'Save changes' : 'Create exercise'}</button>
            {selectedExerciseId && <button className="pill" onClick={() => setConfirmState({ kind: 'delete-exercise', exerciseId: selectedExerciseId, title: 'Delete exercise?', body: 'This will remove the exercise from the library, plans, scheduled days, and progress history.' })}>Delete exercise</button>}
          </div>
        </section>
      </main>}

      {tab === 'plans' && <main className="grid">
        <section className="panel stack">
          <div className="row">
            <div><p className="eyebrow">Plans</p><h2>Select a plan to manage it</h2></div>
            <button className="pill" onClick={startNewPlan}>New plan</button>
          </div>
          <div className="stack">
            {state.plans.map((p) => <div key={p.id} className={selectedPlanId === p.id ? 'listItem activeItem planListRow' : 'listItem planListRow'}>
              <button className="planListButton" onClick={() => selectPlan(p.id)}><strong>{p.name}</strong></button>
              <button className="iconPill" onClick={() => { setApplyPlanId(p.id); setApplyStartDate(today) }} aria-label={`Apply ${p.name}`}>Apply</button>
            </div>)}
          </div>
          {applyPlanId && <div className="card stack">
            <div><p className="eyebrow">Apply plan</p><h3>{state.plans.find((p) => p.id === applyPlanId)?.name ?? 'Plan'}</h3></div>
            <label className="field"><span>Start date</span><input type="date" value={applyStartDate} onChange={(e) => setApplyStartDate(e.target.value)} /></label>
            <div className="nav">
              <button className="primary" onClick={() => { applyPlanById(applyPlanId, applyStartDate); setApplyPlanId(null) }}>Apply to schedule</button>
              <button className="pill" onClick={() => setApplyPlanId(null)}>Cancel</button>
            </div>
          </div>}
          <div className="stack">
            <div><p className="eyebrow">Active runs</p></div>
            {state.runs.map((r) => {
              const runDays = state.schedule.filter((x) => x.runId === r.id)
              const completedDays = runDays.filter((day) => day.items.length > 0 && day.items.every((item) => item.done)).length
              const progress = runDays.length ? Math.round((completedDays / runDays.length) * 100) : 0
              return <article key={r.id} className="card stack">
                <div className="row">
                  <div><h3>{r.name} | {runStartLabel(r.startDate, today)}</h3><p>{completedDays} of {runDays.length} days complete</p></div>
                  <div className="dayRowActions"><button className="iconPill" onClick={() => setConfirmState({ kind: 'delete-run', runId: r.id, title: 'Remove active run?', body: 'This will remove the run and all of its scheduled days from the calendar.' })} aria-label={`Delete run ${r.name}`}>🗑</button></div>
                </div>
                <div className="progressTrack" aria-label={`${progress}% complete`}>
                  <div className="progressFill" style={{ width: `${progress}%` }} />
                </div>
              </article>
            })}
          </div>
        </section>
        <section className="panel stack">
          {plan ? <>
            <div><p className="eyebrow">Manage plan</p><input className="planNameInput" value={planForm.name} onChange={(e) => setPlanForm((x) => ({ ...x, name: e.target.value }))} aria-label="Plan name" /></div>
            <label className="field"><span>Focus</span><textarea rows={2} value={planForm.focus} onChange={(e) => setPlanForm((x) => ({ ...x, focus: e.target.value }))} /></label>
            <div className="nav">
              <button className="primary" onClick={savePlanMeta}>Save plan</button>
              <button className="pill" onClick={() => selectedPlanId && setConfirmState({ kind: 'delete-plan', planId: selectedPlanId, title: 'Delete plan?', body: 'This deletes the plan template. Existing active runs stay unless you remove them separately.' })}>Delete plan</button>
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
                <div className="row">
                  <button className="exerciseToggle" onClick={() => setExpandedPlanDays((current) => ({ ...current, [pd.id]: !(current[pd.id] ?? false) }))}>
                    <div className="grow">
                      <h3>{pd.label}</h3>
                      <p>{pd.items.length ? pd.items.map((it) => exById[it.exerciseId]?.name ?? 'Exercise').join(', ') : 'Rest day'}</p>
                    </div>
                  </button>
                  <div className="dayRowActions">
                    <button className="iconPill" onClick={() => addPlanDayAt(index + 1)} aria-label={`Add day after ${pd.label}`}>+</button>
                    <button className="iconPill" onClick={() => deletePlanDay(pd.id)} aria-label={`Delete ${pd.label}`}>🗑</button>
                  </div>
                </div>
                {expandedPlanDays[pd.id] && <>
                  <label className="field">
                    <span>Add exercise</span>
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        if (!event.target.value) return
                        addExerciseToPlanDay(pd.id, event.target.value)
                        event.target.value = ''
                      }}
                    >
                      <option value="">Select exercise</option>
                      {sortedExercises.map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
                    </select>
                  </label>
                <div className="stack compactStack">{pd.items.length === 0 && <p className="mutedCopy">Rest day</p>}{pd.items.map((it) => {
                  const ex = exById[it.exerciseId]
                  if (!ex) return null
                  const expanded = expandedPlanItems[it.id] ?? false
                  const metricActions = ex.refs.map((r) => <button key={r} className="miniAction" onClick={() => updatePlanItem(pd.id, it.id, (x) => ({ ...x, target: referenceTarget(derivedHistory, ex, r, x.type, x.target) }))}>{r === 'last-result' ? 'Last' : 'PB'} {referenceSummary(derivedHistory, ex, r, it.type)}</button>)
                  return <article key={it.id} className="card stack planExerciseCard">
                    <div className="row">
                      <button className="exerciseToggle" onClick={() => setExpandedPlanItems((current) => ({ ...current, [it.id]: !expanded }))}>
                        <div className="grow"><strong>{ex.name}</strong><p>{ex.name} | {sum(it.type, it.target)}</p></div>
                      </button>
                      <button className="pill" onClick={() => removePlanItem(pd.id, it.id)}>Remove</button>
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
          </> : <div className="empty">No plans yet. Create one from the left.</div>}
        </section>
      </main>}

      {tab === 'progress' && <main className="grid">
        <section className="panel stack">
          <div><p className="eyebrow">Progress</p><h2>Select an exercise</h2></div>
          <div className="stack">
            {progressExercises.length === 0 && <div className="empty">Complete an exercise to start tracking progress here.</div>}
            {progressExercises.map((exercise) => <button key={exercise.id} className={selectedProgressExerciseId === exercise.id ? 'listItem activeItem' : 'listItem'} onClick={() => { setSelectedProgressExerciseId(exercise.id); cancelLogEdit() }}><strong>{exercise.name}</strong></button>)}
          </div>
        </section>
        <section className="panel stack">
          {progressExercise ? <>
          <div>
            <p className="eyebrow">Exercise progress</p>
            <h2>{progressExercise.name}</h2>
            <p>{progressExercise.category} / {progressExercise.equipment}</p>
          </div>
          <div className="progressSummaryGrid">
            <div className="mini">
              <strong>Tracked by</strong>
              <span>{PM_LABEL[progressExercise.progressMetric]}</span>
            </div>
            <div className="mini">
              <strong>Last</strong>
              <span>{progressHistory.length ? metricDisplay(progressExercise.progressMetric, progressHistory[progressHistory.length - 1]) : 'No data yet'}</span>
            </div>
            <div className="mini">
              <strong>PB</strong>
              <span>{progressHistory.length ? metricDisplay(progressExercise.progressMetric, bestProgressEntry(progressHistory, progressExercise) ?? progressHistory[progressHistory.length - 1]) : 'No data yet'}</span>
            </div>
          </div>
          <div className="stack">
            <div><p className="eyebrow">Trend</p></div>
            {progressHistory.length === 0 && <div className="empty">No completed history yet for this exercise.</div>}
            {progressHistory.length > 0 && <div className="trendChart">
              {progressHistory.map((entry) => {
                const currentMetric = metric(progressExercise.progressMetric, entry)
                const allValues = progressHistory.map((historyEntry) => metric(progressExercise.progressMetric, historyEntry)).filter((value): value is number => value !== undefined)
                const maxValue = allValues.length ? Math.max(...allValues) : 1
                const minValue = allValues.length ? Math.min(...allValues) : 0
                const range = Math.max(maxValue - minValue, 1)
                const normalized = currentMetric === undefined ? 0.2 : progressExercise.progressMetric === 'time' ? (maxValue - currentMetric + 1) / (range + 1) : (currentMetric - minValue + 1) / (range + 1)
                return <div key={entry.id} className="trendBarWrap">
                  <div className="trendBar" style={{ height: `${Math.max(18, normalized * 96)}px` }} />
                  <span>{fmtShort(entry.date)}</span>
                </div>
              })}
            </div>}
          </div>
          <div className="stack">
            <div><p className="eyebrow">History</p></div>
            {progressHistory.length === 0 && <div className="empty">Complete this exercise to start a history.</div>}
            {progressHistory.slice().reverse().map((entry) => {
              const isEditing = editingLogId === entry.id
              const canOpenDay = !!entry.sourceItemId
              const entryMetric = effectiveProgressMetric(progressExercise, entry.type)
              return <div key={entry.id} className="card stack progressHistoryCard">
                <div className="row top">
                  <div className="grow">
                    <strong>{fmtDay(entry.date)}</strong>
                    <p>{metricDisplay(progressExercise.progressMetric, entry)} | {sum(entry.type, entry.target)}</p>
                  </div>
                  <div className="dayRowActions">
                    {canOpenDay && <button className="iconPill" onClick={() => openLogDay(entry)}>Open day</button>}
                    <button className="iconPill" onClick={() => isEditing ? cancelLogEdit() : beginLogEdit(entry)}>{isEditing ? 'Close' : 'Edit'}</button>
                  </div>
                </div>
                {isEditing && <div className="stack compactStack">
                  {entryMetric === 'time' && <label className="field"><span>Time logged</span><input placeholder="mm:ss or minutes" value={progressEdit.timeText ?? ''} onChange={(e) => setProgressEdit((current) => ({ ...current, timeText: e.target.value, seconds: parseSecs(e.target.value) }))} onBlur={() => setProgressEdit((current) => ({ ...current, timeText: current.seconds !== undefined ? fmtSecs(current.seconds) : current.timeText }))} /></label>}
                  {entryMetric === 'weight' && <label className="field compactMetricField"><span>Weight used</span><input type="number" min={0} value={progressEdit.weight ?? 0} onChange={(e) => setProgressEdit((current) => ({ ...current, weight: Number(e.target.value) }))} /></label>}
                  {entryMetric === 'count' && <label className="field compactMetricField"><span>Count logged</span><input type="number" min={0} value={progressEdit.count ?? 0} onChange={(e) => setProgressEdit((current) => ({ ...current, count: Number(e.target.value) }))} /></label>}
                  <label className="field"><span>Note</span><input value={progressEdit.note ?? ''} onChange={(e) => setProgressEdit((current) => ({ ...current, note: e.target.value }))} placeholder="Optional note" /></label>
                  <div className="nav">
                    <button className="primary" onClick={saveLogEdit}>Save log</button>
                    <button className="pill" onClick={cancelLogEdit}>Cancel</button>
                  </div>
                </div>}
              </div>
            })}
          </div>
          </> : <div className="empty">No completed exercise history yet.</div>}
        </section>
      </main>}

      {tab === 'settings' && <main className="grid">
        <section className="panel stack">
          <div><p className="eyebrow">Settings</p><h2>Workspace settings</h2></div>
          <div className="stack">
            {([
              { id: 'data', title: 'Data', detail: 'Reset and manage stored app data.' },
              { id: 'integrations', title: 'Integrations', detail: 'Calendar sync and plan sharing can live here.' },
              { id: 'profile', title: 'Profile', detail: 'Multiple users and personal preferences can live here.' },
            ] as const).map((section) => <button key={section.id} className={settingsSection === section.id ? 'listItem activeItem settingsNavItem' : 'listItem settingsNavItem'} onClick={() => setSettingsSection(section.id)}>
              <strong>{section.title}</strong>
              <span>{section.detail}</span>
            </button>)}
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
            <div className="card stack">
              <div><strong>Reset progress history</strong><p>This clears completion status, logged times, weights, counts, and progress history while keeping exercises, plans, and the schedule structure.</p></div>
              <button className="pill" onClick={() => setConfirmState({ kind: 'reset-progress-data', title: 'Reset progress history?', body: 'This clears completion logs, PBs, and checked-off progress across the app.' })}>Reset progress</button>
            </div>
            <div className="card stack">
              <div><strong>Reset schedule and active runs</strong><p>This removes calendar days and active runs but keeps your exercise library, templates, and saved progress logs not tied to the schedule.</p></div>
              <button className="pill" onClick={() => setConfirmState({ kind: 'reset-schedule-data', title: 'Reset schedule and active runs?', body: 'This will clear the calendar and remove active runs.' })}>Reset schedule</button>
            </div>
            <div className="card stack">
              <div><strong>Reset the app</strong><p>This resets the app back to a clean starting state.</p></div>
              <button className="pill" onClick={() => setConfirmState({ kind: 'reset-all-data', title: 'Reset all app data?', body: 'This will remove exercises, plans, schedule data, active runs, and progress history.' })}>Reset everything</button>
            </div>
          </>}
          {settingsSection === 'integrations' && <div className="stack">
            <div><p className="eyebrow">Integrations</p><h2>Coming next</h2></div>
            <div className="card stack">
              <strong>Supabase</strong>
              <p>{hasSupabaseEnv ? `Connected in app config: ${supabaseUrl}` : 'Supabase environment variables are not configured in this build.'}</p>
              <span className={hasSupabaseEnv ? 'status' : 'status warn'}>{hasSupabaseEnv ? 'Ready for schema + auth setup' : 'Missing env vars'}</span>
            </div>
            <div className="card stack">
              <strong>Calendar integration</strong>
              <p>Plan export and web-calendar sync can live here when we add it.</p>
            </div>
            <div className="card stack">
              <strong>Plan import / export</strong>
              <p>This is a natural place for sharing plans across devices or backing them up.</p>
            </div>
          </div>}
          {settingsSection === 'profile' && <div className="stack">
            <div><p className="eyebrow">Profile</p><h2>Account</h2></div>
            <div className="card stack">
              <strong>Google sign-in</strong>
              <p>{hasSupabaseEnv ? (authLoading ? 'Checking your current session.' : user ? `Signed in as ${user.email ?? 'user'}` : 'Ready for Google sign-in.') : 'Supabase is not configured for this build.'}</p>
              {hasSupabaseEnv && <div className="nav">
                {!user && !authLoading && <button className="primary" onClick={signInWithGoogle}>Continue with Google</button>}
                {user && <button className="pill" onClick={signOut}>Sign out</button>}
              </div>}
            </div>
            <div className="card stack">
              <strong>Multiple users</strong>
              <p>If you add household profiles later, this section is ready for it.</p>
            </div>
            <div className="card stack">
              <strong>Personal preferences</strong>
              <p>Defaults like units, encouragement style, and reminder behaviors can live here.</p>
            </div>
          </div>}
        </section>
      </main>}
    </div>
  )
}

function TargetEditor({ type, target, onChange, actions, layout = 'default' }: { type: TT; target: Target; onChange: (t: Target) => void; actions?: ReactNode; layout?: 'default' | 'detail' }) {
  if (type === 'count') {
    if (layout === 'detail') return <div className="targetRow"><label className="field compactMetricField compactControl"><span>Target count</span><input type="number" min={1} value={target.count ?? 0} onChange={(e) => onChange({ count: Number(e.target.value) })} /></label>{actions}</div>
    return <div className="targetRow"><label className="field grow"><span>Target count</span><input type="number" min={1} value={target.count ?? 0} onChange={(e) => onChange({ count: Number(e.target.value) })} /></label>{actions}</div>
  }
  if (type === 'sets') {
    if (layout === 'detail') return <div className="detailTargetFields"><label className="field microField compactControl"><span>Sets</span><input type="number" min={1} value={target.sets ?? 0} onChange={(e) => onChange({ ...target, sets: Number(e.target.value) })} /></label><label className="field microField compactControl"><span>Reps</span><input type="number" min={1} value={target.reps ?? 0} onChange={(e) => onChange({ ...target, reps: Number(e.target.value) })} /></label>{actions}</div>
    return <div className="targetInline"><div className="split compactSplit"><label className="field"><span>Sets</span><input type="number" min={1} value={target.sets ?? 0} onChange={(e) => onChange({ ...target, sets: Number(e.target.value) })} /></label><label className="field"><span>Reps</span><input type="number" min={1} value={target.reps ?? 0} onChange={(e) => onChange({ ...target, reps: Number(e.target.value) })} /></label></div>{actions}</div>
  }
  if (type === 'duration') {
    if (layout === 'detail') return <div className="targetRow"><label className="field compactMetricField compactControl"><span>Seconds</span><input type="number" min={10} value={target.seconds ?? 0} onChange={(e) => onChange({ seconds: Number(e.target.value) })} /></label>{actions}</div>
    return <div className="targetRow"><label className="field grow"><span>Target duration in seconds</span><input type="number" min={10} value={target.seconds ?? 0} onChange={(e) => onChange({ seconds: Number(e.target.value) })} /></label>{actions}</div>
  }
  if (type === 'distance') {
    if (layout === 'detail') {
      return <div className="targetInline"><div className="detailDistanceFields"><label className="field compactMetricField compactControl"><span>Distance</span><input type="number" min={0} step="0.1" value={target.distance ?? 0} onChange={(e) => onChange({ ...target, distance: Number(e.target.value) })} /></label><label className="field compactField compactControl"><span>Unit</span><select value={target.unit ?? 'mi'} onChange={(e) => onChange({ ...target, unit: e.target.value as 'mi' | 'km' })}><option value="mi">Miles</option><option value="km">Kilometers</option></select></label></div>{actions}</div>
    }
    return <div className="targetInline"><div className="split compactSplit"><label className="field"><span>Distance</span><input type="number" min={0} step="0.1" value={target.distance ?? 0} onChange={(e) => onChange({ ...target, distance: Number(e.target.value) })} /></label><label className="field compactField"><span>Unit</span><select value={target.unit ?? 'mi'} onChange={(e) => onChange({ ...target, unit: e.target.value as 'mi' | 'km' })}><option value="mi">Miles</option><option value="km">Kilometers</option></select></label></div>{actions}</div>
  }
  if (type === 'for-time') {
    if (layout === 'detail') return <div className="targetRow"><label className="field compactMetricField compactControl"><span>Fixed reps</span><input type="number" min={1} value={target.count ?? 0} onChange={(e) => onChange({ count: Number(e.target.value) })} /></label>{actions}</div>
    return <div className="targetRow"><label className="field grow"><span>Fixed reps</span><input type="number" min={1} value={target.count ?? 0} onChange={(e) => onChange({ count: Number(e.target.value) })} /></label>{actions}</div>
  }
  if (layout === 'detail') return <div className="detailTargetFields"><label className="field microField compactControl"><span>Sets</span><input type="number" min={1} value={target.sets ?? 0} onChange={(e) => onChange({ ...target, sets: Number(e.target.value) })} /></label><label className="field microField compactControl"><span>Reps</span><input type="number" min={1} value={target.reps ?? 0} onChange={(e) => onChange({ ...target, reps: Number(e.target.value) })} /></label><label className="field microField compactControl"><span>Weight</span><input type="number" min={0} value={target.weight ?? 0} onChange={(e) => onChange({ ...target, weight: Number(e.target.value) })} /></label>{actions}</div>
  return <div className="targetInline"><div className="split threeUp"><label className="field"><span>Sets</span><input type="number" min={1} value={target.sets ?? 0} onChange={(e) => onChange({ ...target, sets: Number(e.target.value) })} /></label><label className="field"><span>Reps</span><input type="number" min={1} value={target.reps ?? 0} onChange={(e) => onChange({ ...target, reps: Number(e.target.value) })} /></label><label className="field"><span>Weight</span><input type="number" min={0} value={target.weight ?? 0} onChange={(e) => onChange({ ...target, weight: Number(e.target.value) })} /></label></div>{actions}</div>
}

// Overall progress: per-lift strength trends, pace, and how each lift compares with norms.
import { dateOrdinal } from './format'
import { compareToNorm, estimatedOneRepMax, expectedLevelIndex, LEVEL_NAMES, pushUpRating, standardForExercise, STANDARDS, type Sex, type StandardId } from './standards'
import type { Day, Exercise, Log } from '../types'

export type Pace = 'fast' | 'steady' | 'flat' | 'slipping' | 'new'
export type LiftMeasure = 'e1rm' | 'reps' | 'seconds'
export type LiftPoint = { date: string; value: number; weight?: number; reps?: number }

export type LiftNorm =
  | { kind: 'percentile'; standard: StandardId; standardLabel: string; percentile: number; level: string; levelIndex: number; expectedLevel: string; below: boolean; next?: { level: string; value: number } }
  | { kind: 'pushups'; rating: string; below: boolean; averageAt: number; next?: { rating: string; reps: number } }

export type LiftSummary = {
  exerciseId: string
  name: string
  measure: LiftMeasure
  points: LiftPoint[]
  latest: LiftPoint
  current: number
  baseline?: LiftPoint
  changePct?: number
  weeklyPct?: number
  weeksMeasured?: number
  pace: Pace
  norm?: LiftNorm
  focusReason?: string
  atEquipmentMax: boolean
  roughEstimate: boolean
}

export type ProgressProfile = { sex?: Sex; age?: number; bodyweight?: number; equipmentMaxLb?: number; trainingMonths?: number }

export type OverallSummary = {
  lifts: LiftSummary[]
  verdict: Pace | 'none'
  medianWeeklyPct?: number
  medianChangePct?: number
  counts: { improving: number; flat: number; slipping: number; new: number }
  index: Array<{ date: string; value: number }>
  focus: LiftSummary[]
  belowNorm: LiftSummary[]
  bodyweight?: { start: number; latest: number; change: number }
  consistency: { workoutsPlanned: number; workoutsDone: number; habitDue: number; habitDone: number }
}

export const PACE_LABEL: Record<Pace, string> = { fast: 'Climbing fast', steady: 'Steady gains', flat: 'Holding steady', slipping: 'Slipping', new: 'Not enough data yet' }

function shiftDate(date: string, days: number) {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + days)).toISOString().slice(0, 10)
}

export function paceFor(weeklyPct: number | undefined): Pace {
  if (weeklyPct === undefined) return 'new'
  if (weeklyPct >= 1) return 'fast'
  if (weeklyPct >= 0.25) return 'steady'
  if (weeklyPct > -0.25) return 'flat'
  return 'slipping'
}

function bestSetReps(log: Log) {
  const sets = (log.result.sets ?? []).filter((set) => Number.isFinite(set.reps) && set.reps > 0)
  if (sets.length) return Math.max(...sets.map((set) => set.reps))
  return undefined
}

/** One strength reading for a log, or undefined if the log can't be scored. */
export function readingFor(log: Log, exercise: Exercise): { measure: LiftMeasure; point: LiftPoint } | undefined {
  const usesWeight = log.type === 'weighted' || (exercise.progressMetric === 'weight' && (log.type === 'sets' || log.type === 'count'))
  if (usesWeight) {
    const sets = (log.result.sets ?? []).filter((set) => set.reps > 0)
    const fallbackWeight = log.result.weight ?? log.target.weight
    let best: LiftPoint | undefined
    for (const set of sets) {
      const weight = set.weight ?? fallbackWeight
      const value = weight !== undefined ? estimatedOneRepMax(weight, set.reps) : undefined
      if (value !== undefined && (!best || value > best.value)) best = { date: log.date, value, weight, reps: set.reps }
    }
    if (!best && fallbackWeight !== undefined) {
      const reps = log.target.reps ?? log.result.count ?? log.target.count
      const value = reps ? estimatedOneRepMax(fallbackWeight, reps) : undefined
      if (value !== undefined) best = { date: log.date, value, weight: fallbackWeight, reps }
    }
    return best ? { measure: 'e1rm', point: best } : undefined
  }
  if (log.type === 'duration') {
    const seconds = log.result.seconds ?? log.target.seconds
    return seconds ? { measure: 'seconds', point: { date: log.date, value: seconds } } : undefined
  }
  if (log.type === 'count' || log.type === 'sets') {
    if (log.target.countUnit === 'steps') return undefined
    const reps = bestSetReps(log) ?? log.result.count ?? (log.type === 'count' ? log.target.count : log.target.reps)
    return reps ? { measure: 'reps', point: { date: log.date, value: reps, reps } } : undefined
  }
  return undefined
}

function summarizeLift(exercise: Exercise, logs: Log[], today: string, windowStart: string, profile: ProgressProfile): LiftSummary | undefined {
  const byDate = new Map<string, LiftPoint>()
  let measure: LiftMeasure | undefined
  for (const log of logs) {
    const reading = readingFor(log, exercise)
    if (!reading) continue
    // Mixed measures (e.g. switched from reps to weighted) — keep the most recent kind.
    if (measure && reading.measure !== measure) {
      byDate.clear()
    }
    measure = reading.measure
    const existing = byDate.get(log.date)
    if (!existing || reading.point.value > existing.value) byDate.set(log.date, reading.point)
  }
  if (!measure || byDate.size === 0) return undefined
  const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const latest = points[points.length - 1]
  const inWindow = points.filter((point) => point.date >= windowStart)
  const beforeWindow = points.filter((point) => point.date < windowStart)
  const baseline = beforeWindow.length ? beforeWindow[beforeWindow.length - 1] : inWindow[0]
  const recent = inWindow.slice(-2)
  const recentBest = recent.length ? recent.reduce((a, b) => (b.value > a.value ? b : a)) : undefined
  const recentDate = inWindow.length ? inWindow[inWindow.length - 1].date : undefined
  const fourWeeksAgo = shiftDate(today, -28)
  const current = Math.max(...points.filter((point) => point.date >= fourWeeksAgo).map((point) => point.value), latest.value)

  let changePct: number | undefined
  let weeklyPct: number | undefined
  let weeksMeasured: number | undefined
  if (baseline && recentBest && recentDate && inWindow.length >= (beforeWindow.length ? 1 : 2) && baseline.value > 0) {
    const days = dateOrdinal(recentDate) - dateOrdinal(baseline.date)
    if (days >= 7) {
      weeksMeasured = days / 7
      changePct = ((recentBest.value - baseline.value) / baseline.value) * 100
      weeklyPct = changePct / weeksMeasured
    }
  }
  const pace = paceFor(weeklyPct)

  let norm: LiftNorm | undefined
  const standard = standardForExercise(exercise.name)
  if (standard && profile.sex && profile.bodyweight) {
    if (standard === 'pushUps') {
      if (measure === 'reps' && profile.age) {
        const rating = pushUpRating(current, profile.sex, profile.age)
        norm = { kind: 'pushups', rating: rating.rating, below: rating.belowNorm, averageAt: rating.averageAt, next: rating.next }
      }
    } else {
      const expected = STANDARDS[standard].unit === 'reps' ? 'reps' : 'e1rm'
      if (measure === expected) {
        const result = compareToNorm(standard, current, profile.sex, profile.bodyweight, profile.age)
        const expected = expectedLevelIndex(profile.trainingMonths)
        // "Below norm" means behind the level typical for how long you've been training, not behind lifters in general.
        norm = { kind: 'percentile', standard, standardLabel: STANDARDS[standard].label, percentile: result.percentile, level: result.level, levelIndex: result.levelIndex, expectedLevel: LEVEL_NAMES[expected], below: result.levelIndex < expected, next: result.next }
      }
    }
  }

  const equipmentMax = profile.equipmentMaxLb ?? 50
  const atEquipmentMax = measure === 'e1rm' && (latest.weight ?? 0) >= equipmentMax
  const roughEstimate = measure === 'e1rm' && (latest.reps ?? 0) > 12

  let focusReason: string | undefined
  if (pace === 'slipping' && changePct !== undefined && weeksMeasured !== undefined) {
    focusReason = `Down ${Math.abs(changePct).toFixed(0)}% over ${Math.round(weeksMeasured)} week${Math.round(weeksMeasured) === 1 ? '' : 's'}.`
  } else if (norm?.below && pace !== 'fast') {
    focusReason = norm.kind === 'percentile' ? `Below ${norm.expectedLevel} level, which is typical for how long you’ve trained, and not closing the gap quickly.` : 'Below average for your age, and not closing the gap quickly.'
  } else if (atEquipmentMax && (pace === 'flat' || pace === 'slipping')) {
    focusReason = `At your ${equipmentMax} lb max — progress by adding reps or slowing the tempo.`
  }

  return {
    exerciseId: exercise.id,
    name: exercise.name,
    measure,
    points,
    latest,
    current,
    baseline,
    changePct,
    weeklyPct,
    weeksMeasured,
    pace,
    norm,
    focusReason,
    atEquipmentMax,
    roughEstimate,
  }
}

function median(values: number[]) {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function summarizeProgress(input: {
  exercises: Exercise[]
  logs: Log[]
  schedule: Day[]
  today: string
  windowWeeks: number
  profile: ProgressProfile
  bodyweights?: Array<{ date: string; weight: number }>
}): OverallSummary {
  const { exercises, logs, schedule, today, windowWeeks, profile } = input
  const windowStart = shiftDate(today, -7 * windowWeeks)
  const logsByExercise = new Map<string, Log[]>()
  for (const log of logs) {
    if (!log.done || log.date > today) continue
    const rows = logsByExercise.get(log.exerciseId) ?? []
    rows.push(log)
    logsByExercise.set(log.exerciseId, rows)
  }
  const lifts = exercises
    .filter((exercise) => exercise.kind === 'exercise')
    .map((exercise) => summarizeLift(exercise, (logsByExercise.get(exercise.id) ?? []).sort((a, b) => a.date.localeCompare(b.date)), today, windowStart, profile))
    .filter((lift): lift is LiftSummary => Boolean(lift))
    // Only lifts trained recently belong in "how am I doing now".
    .filter((lift) => lift.latest.date >= shiftDate(windowStart, -28))

  const measured = lifts.filter((lift) => lift.weeklyPct !== undefined)
  const medianWeeklyPct = median(measured.map((lift) => lift.weeklyPct as number))
  const medianChangePct = median(measured.map((lift) => lift.changePct as number))
  const counts = {
    improving: lifts.filter((lift) => lift.pace === 'fast' || lift.pace === 'steady').length,
    flat: lifts.filter((lift) => lift.pace === 'flat').length,
    slipping: lifts.filter((lift) => lift.pace === 'slipping').length,
    new: lifts.filter((lift) => lift.pace === 'new').length,
  }

  // Strength index: each lift relative to its baseline (100), averaged, sampled weekly.
  const index: Array<{ date: string; value: number }> = []
  const indexed = measured.filter((lift) => lift.baseline)
  if (indexed.length) {
    for (let week = 0; week <= windowWeeks; week += 1) {
      const date = week === windowWeeks ? today : shiftDate(windowStart, week * 7)
      const values = indexed.map((lift) => {
        const upTo = lift.points.filter((point) => point.date <= date && point.date >= (lift.baseline as LiftPoint).date)
        const point = upTo[upTo.length - 1]
        return point ? (point.value / (lift.baseline as LiftPoint).value) * 100 : undefined
      }).filter((value): value is number => value !== undefined)
      if (values.length) index.push({ date, value: values.reduce((total, value) => total + value, 0) / values.length })
    }
  }

  let bodyweight: OverallSummary['bodyweight']
  const weights = (input.bodyweights ?? []).filter((entry) => entry.date <= today).sort((a, b) => a.date.localeCompare(b.date))
  if (weights.length) {
    const inWindow = weights.filter((entry) => entry.date >= windowStart)
    const start = (weights.filter((entry) => entry.date < windowStart).pop() ?? inWindow[0] ?? weights[0]).weight
    const latest = weights[weights.length - 1].weight
    bodyweight = { start, latest, change: latest - start }
  }

  const habitIds = new Set(exercises.filter((exercise) => exercise.kind === 'habit').map((exercise) => exercise.id))
  let workoutsPlanned = 0
  let workoutsDone = 0
  let habitDone = 0
  for (const day of schedule) {
    if (day.date < windowStart || day.date > today) continue
    const workout = day.items.filter((item) => !habitIds.has(item.exerciseId))
    if (workout.length) {
      workoutsPlanned += 1
      if (workout.some((item) => item.done)) workoutsDone += 1
    }
    habitDone += day.items.filter((item) => habitIds.has(item.exerciseId) && item.done).length
  }
  let habitDue = 0
  for (const habit of exercises) {
    if (habit.kind !== 'habit' || !habit.repeatDays?.length) continue
    for (let date = windowStart; date <= today; date = shiftDate(date, 1)) {
      const weekday = new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay()
      if (habit.repeatDays.includes(weekday)) habitDue += 1
    }
  }

  const verdict: Pace | 'none' = medianWeeklyPct === undefined ? (lifts.length ? 'new' : 'none') : paceFor(medianWeeklyPct)
  return {
    lifts,
    verdict,
    medianWeeklyPct,
    medianChangePct,
    counts,
    index,
    focus: lifts.filter((lift) => lift.focusReason),
    belowNorm: lifts.filter((lift) => lift.norm?.below),
    bodyweight,
    consistency: { workoutsPlanned, workoutsDone, habitDue: Math.max(habitDue, habitDone), habitDone },
  }
}

/** Plain-language read on the overall pace, aware of a cut. */
export function verdictCopy(summary: OverallSummary, windowWeeks: number) {
  const cutting = summary.bodyweight !== undefined && summary.bodyweight.change <= -2
  const weekly = summary.medianWeeklyPct
  const pct = summary.medianChangePct
  switch (summary.verdict) {
    case 'none':
      return { headline: 'No lifts logged yet', detail: 'Complete a few workouts and your trend shows up here.' }
    case 'new':
      return { headline: 'Building a baseline', detail: 'Each lift needs two sessions at least a week apart before a trend is meaningful.' }
    case 'fast':
      return { headline: `Up about ${pct?.toFixed(0)}% in ${windowWeeks} weeks`, detail: `Your lifts are climbing about ${weekly?.toFixed(1)}% a week — the kind of pace typical early in training.${cutting ? ' Impressive while losing weight.' : ''}` }
    case 'steady':
      return { headline: `Up about ${pct?.toFixed(0)}% in ${windowWeeks} weeks`, detail: `About ${weekly?.toFixed(1)}% a week across your lifts — a reasonable pace once you're past the first few months.${cutting ? ' Gaining strength on a cut is a win.' : ''}` }
    case 'flat':
      return cutting
        ? { headline: 'Holding strength while cutting', detail: `You're down ${Math.abs(summary.bodyweight?.change ?? 0).toFixed(1)} lb and your lifts are holding — that's the goal on a cut.` }
        : { headline: 'Holding steady', detail: 'Your lifts have been mostly flat. If that lasts beyond a few weeks, add a rep or a little weight where sets feel easy.' }
    case 'slipping':
      return cutting
        ? { headline: 'Some strength loss on the cut', detail: 'A little is normal while losing weight. Keep protein high and avoid cutting volume on your main lifts.' }
        : { headline: 'Lifts are slipping', detail: 'Several lifts are down. Look at sleep, recovery, and whether sessions are being cut short.' }
  }
}

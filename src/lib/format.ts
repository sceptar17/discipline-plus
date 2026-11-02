// Date and formatting helpers shared across screens.
import type { Log, Target, TT } from '../types'

export const d = (k: string) => new Date(`${k}T12:00:00`)
export const key = (dt: Date) => `${dt.getFullYear()}-${`${dt.getMonth() + 1}`.padStart(2, '0')}-${`${dt.getDate()}`.padStart(2, '0')}`
export const add = (k: string, n: number) => { const x = d(k); x.setDate(x.getDate() + n); return key(x) }
export const dateOrdinal = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86400000
export const monthKey = (k: string) => `${k.slice(0, 7)}-01`
export const fmtDay = (k: string) => d(k).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
export const fmtShort = (k: string) => d(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
export const fmtMonth = (k: string) => d(k).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
export const fmtDateRange = (start: string, end: string) => start === end ? fmtShort(start) : `${fmtShort(start)}–${fmtShort(end)}`
export const fmtSecs = (s?: number) => !s ? '--:--' : `${Math.floor(s / 60)}:${`${s % 60}`.padStart(2, '0')}`
export const parseSecs = (v: string) => { if (!v.trim()) return undefined; if (v.includes(':')) { const [m, s] = v.split(':').map(Number); return Number.isNaN(m) || Number.isNaN(s) ? undefined : m * 60 + s } const n = Number(v); return Number.isNaN(n) ? undefined : n * 60 }
export const countUnitLabel = (target: Target) => target.countUnit === 'steps' ? 'steps' : 'reps'
export const totalCount = (target: Target) => target.count ?? ((target.sets ?? 0) * (target.reps ?? 0))
export const loggedWeight = (entry: Pick<Log, 'target' | 'result'>) => {
  if (entry.result.weight !== undefined) return entry.result.weight
  const setWeights = (entry.result.sets ?? []).map((set) => set.weight).filter((weight): weight is number => weight !== undefined)
  return setWeights.length ? Math.max(...setWeights) : entry.target.weight
}
export const loggedReps = (entry: Pick<Log, 'target' | 'result'>) => {
  const sets = (entry.result.sets ?? []).filter((set) => Number.isFinite(set.reps) && set.reps > 0)
  if (sets.length) return sets.reduce((total, set) => total + set.reps, 0)
  return entry.target.sets !== undefined && entry.target.reps !== undefined ? entry.target.sets * entry.target.reps : 0
}
export const loggedSetsLabel = (entry: Pick<Log, 'target' | 'result'>) => {
  const sets = (entry.result.sets ?? []).filter((set) => Number.isFinite(set.reps) && set.reps > 0)
  if (sets.length) {
    const reps = sets.map((set) => set.reps)
    return reps.every((rep) => rep === reps[0]) ? `${reps.length}x${reps[0]}` : reps.join('/')
  }
  return entry.target.sets && entry.target.reps ? `${entry.target.sets}x${entry.target.reps}` : ''
}
export const weightLabel = (entry: Pick<Log, 'target' | 'result'>) => {
  const weight = loggedWeight(entry)
  if (weight === undefined) return ''
  const sets = loggedSetsLabel(entry)
  return sets ? `${weight} lb / ${sets}` : `${weight} lb`
}
export const durationShort = (seconds?: number) => seconds === undefined ? '0:00' : `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')}`
export const workoutSummary = (t: TT, x: Target) => {
  if (t === 'sets' || t === 'weighted') {
    const volume = `${x.sets ?? 0} × ${x.reps ?? 0}`
    return x.weight !== undefined ? `${volume} · ${x.weight} lb` : volume
  }
  if (t === 'count') return `${x.count ?? 0} ${countUnitLabel(x)}`
  if (t === 'duration') return durationShort(x.seconds)
  if (t === 'distance') return `${x.distance ?? 0} ${x.unit ?? 'mi'}`
  return `${x.count ?? 0} reps for time`
}
export const parseNumberInput = (value: string) => value.trim() === '' ? undefined : Number(value)
export const numberInputValue = (value?: number) => value ?? ''

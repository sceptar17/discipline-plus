import { describe, expect, it } from 'vitest'
import { powerBlockSetting } from './powerblock'
import { summarizeProgress, verdictCopy } from './progress'
import { ageFactor, compareToNorm, estimatedOneRepMax, expectedLevelIndex, pushUpRating, standardForExercise, thresholdsFor } from './standards'
import type { Exercise, Log } from '../types'

describe('powerBlockSetting', () => {
  it('reads the chart without adders where possible', () => {
    expect(powerBlockSetting(25)?.label).toBe('Green')
    expect(powerBlockSetting(20)?.label).toBe('Purple')
    expect(powerBlockSetting(45)?.label).toBe('Black (last)')
    expect(powerBlockSetting(10)?.label).toBe('Black (first)')
  })

  it('uses adders for in-between weights and the top end', () => {
    expect(powerBlockSetting(22.5)?.label).toBe('Purple + 1 adder')
    expect(powerBlockSetting(12.5)?.label).toBe('Black (first) + 1 adder')
    expect(powerBlockSetting(50)?.label).toBe('Black (last) + 2 adders')
  })

  it('handles handle-only weights, rounding, and out-of-range', () => {
    expect(powerBlockSetting(5)?.label).toBe('Handle only')
    expect(powerBlockSetting(7.5)?.label).toBe('Handle + 1 adder')
    expect(powerBlockSetting(32)).toMatchObject({ weight: 32.5, exact: false })
    expect(powerBlockSetting(55)).toBeNull()
    expect(powerBlockSetting(undefined)).toBeNull()
  })
})

describe('standards', () => {
  it('maps library names to norms', () => {
    expect(standardForExercise('Dumbbell Floor Press')).toBe('bench')
    expect(standardForExercise('Hammer Curl')).toBe('curl')
    expect(standardForExercise('Chest-Supported Row')).toBe('row')
    expect(standardForExercise('Bent-Over Reverse Fly')).toBeNull()
    expect(standardForExercise('Pull-Ups')).toBe('pullUps')
    expect(standardForExercise('Push-Ups')).toBe('pushUps')
    expect(standardForExercise('Dumbbell Romanian Deadlift')).toBe('rdl')
  })

  it('interpolates between bodyweight rows and adjusts for age after 40', () => {
    expect(thresholdsFor('curl', 'male', 195)[2]).toBeCloseTo(52)
    expect(ageFactor(35)).toBe(1)
    expect(ageFactor(50)).toBeCloseTo(0.9)
    expect(thresholdsFor('curl', 'male', 200, 50)[2]).toBeCloseTo(53 * 0.9)
  })

  it('places a lift as a percentile of logged lifters', () => {
    // Intermediate (50th) for a 200 lb man curling is 53 lb.
    expect(compareToNorm('curl', 53, 'male', 200).percentile).toBe(50)
    expect(compareToNorm('curl', 35, 'male', 200)).toMatchObject({ percentile: 20, level: 'Novice' })
    expect(compareToNorm('curl', 10, 'male', 200).level).toBe('Below beginner')
  })

  it('estimates one-rep max with Epley', () => {
    expect(estimatedOneRepMax(50, 8)).toBeCloseTo(63.33, 1)
    expect(estimatedOneRepMax(50, 1)).toBe(50)
  })

  it('rates push-ups by age', () => {
    expect(pushUpRating(22, 'male', 42)).toMatchObject({ rating: 'Above average', belowNorm: false })
    expect(pushUpRating(13, 'male', 42)).toMatchObject({ rating: 'Below average', belowNorm: true })
  })
})

describe('summarizeProgress', () => {
  const curl: Exercise = { id: 'curl', kind: 'exercise', name: 'Hammer Curl', category: 'Dumbbell', equipment: 'Dumbbells', notes: '', defaultType: 'weighted', allowed: ['weighted'], target: { sets: 3, reps: 8, weight: 25 }, refs: ['last-result'], progressMetric: 'weight' }
  const row: Exercise = { ...curl, id: 'row', name: 'Dumbbell Row' }
  const log = (exerciseId: string, date: string, weight: number, reps: number): Log => ({ id: `${exerciseId}-${date}`, exerciseId, date, type: 'weighted', target: { sets: 3, reps, weight }, result: { weight, sets: [{ reps, weight }, { reps, weight }, { reps, weight }] }, done: true })

  it('computes pace, norms and an overall verdict', () => {
    const logs = [
      log('curl', '2026-09-10', 25, 8), log('curl', '2026-10-01', 30, 8), log('curl', '2026-10-29', 35, 8),
      log('row', '2026-09-10', 40, 10), log('row', '2026-10-29', 40, 10),
    ]
    const summary = summarizeProgress({ exercises: [curl, row], logs, schedule: [], today: '2026-11-02', windowWeeks: 8, profile: { sex: 'male', age: 42, bodyweight: 200 } })
    const curlSummary = summary.lifts.find((lift) => lift.exerciseId === 'curl')!
    expect(curlSummary.pace).toBe('fast')
    expect(curlSummary.norm).toMatchObject({ kind: 'percentile' })
    expect(summary.lifts.find((lift) => lift.exerciseId === 'row')!.pace).toBe('flat')
    expect(summary.index[0].value).toBe(100)
    expect(summary.index[summary.index.length - 1].value).toBeGreaterThan(100)
    expect(verdictCopy(summary, 8).headline).toMatch(/Up about/)
  })

  it('treats flat strength during a cut as a win', () => {
    const logs = [log('row', '2026-09-10', 40, 10), log('row', '2026-10-29', 40, 10)]
    const summary = summarizeProgress({ exercises: [row], logs, schedule: [], today: '2026-11-02', windowWeeks: 8, profile: {}, bodyweights: [{ date: '2026-09-08', weight: 199 }, { date: '2026-11-01', weight: 193 }] })
    expect(verdictCopy(summary, 8).headline).toBe('Holding strength while cutting')
  })

  it('flags lifts at the equipment max that have stalled', () => {
    const logs = [log('row', '2026-09-10', 50, 12), log('row', '2026-10-29', 50, 12)]
    const summary = summarizeProgress({ exercises: [row], logs, schedule: [], today: '2026-11-02', windowWeeks: 8, profile: {} })
    expect(summary.focus[0].focusReason).toMatch(/50 lb max/)
  })
})

describe('training-age expectations', () => {
  it('expects levels by training time, per Strength Level’s definitions', () => {
    expect(expectedLevelIndex(2)).toBe(0)
    expect(expectedLevelIndex(12)).toBe(1)
    expect(expectedLevelIndex(36)).toBe(2)
    expect(expectedLevelIndex(undefined)).toBe(1)
  })

  it('only flags a lift as below norm when it trails the level expected for training time', () => {
    const press: Exercise = { id: 'press', kind: 'exercise', name: 'Dumbbell Floor Press', category: 'Dumbbell', equipment: '', notes: '', defaultType: 'weighted', allowed: ['weighted'], target: {}, refs: ['last-result'], progressMetric: 'weight' }
    const logs: Log[] = [{ id: 'a', exerciseId: 'press', date: '2026-10-30', type: 'weighted', target: { sets: 3, reps: 8, weight: 50 }, result: { weight: 50, sets: [{ reps: 8, weight: 50 }] }, done: true }]
    const base = { exercises: [press], logs, schedule: [], today: '2026-11-02', windowWeeks: 8 }
    // 50 × 8 ≈ 63 lb max: between Beginner and Novice for a 193 lb, 42-year-old man.
    const newLifter = summarizeProgress({ ...base, profile: { sex: 'male', age: 42, bodyweight: 193, trainingMonths: 2 } }).lifts[0].norm
    const yearIn = summarizeProgress({ ...base, profile: { sex: 'male', age: 42, bodyweight: 193, trainingMonths: 12 } }).lifts[0].norm
    expect(newLifter).toMatchObject({ level: 'Beginner', below: false })
    expect(yearIn).toMatchObject({ level: 'Beginner', below: true, expectedLevel: 'Novice' })
  })
})

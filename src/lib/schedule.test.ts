import { describe, expect, it } from 'vitest'
import { habitStats, isCalendarDate, isDueOn, pinItemsToDates, swapScheduleDates } from './schedule'

describe('isCalendarDate', () => {
  it('accepts real ISO calendar dates', () => {
    expect(isCalendarDate('2026-09-19')).toBe(true)
    expect(isCalendarDate('2024-02-29')).toBe(true)
  })

  it('rejects rollover and malformed dates', () => {
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('09/19/2026')).toBe(false)
  })
})

describe('swapScheduleDates', () => {
  const normalize = <T extends { date: string; items: Array<{ id: string }> }>(day: T) => day

  it('swaps complete day payloads and moves linked log dates', () => {
    const result = swapScheduleDates(
      [
        { date: '2026-09-18', notes: 'Friday', items: [{ id: 'friday-item' }] },
        { date: '2026-09-19', notes: 'Saturday', items: [{ id: 'saturday-item' }] },
      ],
      [
        { sourceItemId: 'friday-item', date: '2026-09-18' },
        { sourceItemId: 'saturday-item', date: '2026-09-19' },
      ],
      '2026-09-18',
      '2026-09-19',
      normalize,
    )

    expect(result?.schedule.map((day) => [day.date, day.notes])).toEqual([
      ['2026-09-18', 'Saturday'],
      ['2026-09-19', 'Friday'],
    ])
    expect(result?.logs.map((log) => log.date)).toEqual(['2026-09-19', '2026-09-18'])
  })

  it('moves a scheduled day into an otherwise empty date without shifting later days', () => {
    const result = swapScheduleDates(
      [{ date: '2026-09-18', notes: 'Workout', items: [{ id: 'item' }] }],
      [{ sourceItemId: 'item', date: '2026-09-18' }],
      '2026-09-18',
      '2026-09-21',
      normalize,
    )
    expect(result?.schedule).toEqual([{ date: '2026-09-21', notes: 'Workout', items: [{ id: 'item' }] }])
    expect(result?.logs[0].date).toBe('2026-09-21')
  })
})

describe('pinItemsToDates', () => {
  type TestDay = { date: string; runId?: string; items: Array<{ id: string; habit?: boolean }> }
  const options = {
    isPinned: (item: { habit?: boolean }) => Boolean(item.habit),
    emptyDay: (date: string): TestDay => ({ date, items: [] }),
    isDisposable: (day: TestDay) => !day.runId,
    normalize: (day: TestDay) => day,
  }

  it('keeps a logged habit on its date when the workout day is swapped away', () => {
    const before: TestDay[] = [
      { date: '2026-11-02', runId: 'r', items: [{ id: 'squat' }, { id: 'prayer', habit: true }] },
      { date: '2026-11-03', runId: 'r', items: [{ id: 'run' }] },
    ]
    const swapped = swapScheduleDates(before, [{ sourceItemId: 'prayer', date: '2026-11-02' }], '2026-11-02', '2026-11-03', (day) => day)!
    const result = pinItemsToDates(before, swapped.schedule, swapped.logs, options)
    expect(result.schedule).toEqual([
      { date: '2026-11-02', runId: 'r', items: [{ id: 'run' }, { id: 'prayer', habit: true }] },
      { date: '2026-11-03', runId: 'r', items: [{ id: 'squat' }] },
    ])
    expect(result.logs[0].date).toBe('2026-11-02')
  })

  it('recreates a host day for a habit and drops days that become empty', () => {
    const before: TestDay[] = [{ date: '2026-11-02', items: [{ id: 'prayer', habit: true }] }]
    const moved: TestDay[] = [{ date: '2026-11-05', items: [{ id: 'prayer', habit: true }] }]
    const result = pinItemsToDates(before, moved, [], options)
    expect(result.schedule).toEqual([{ date: '2026-11-02', items: [{ id: 'prayer', habit: true }] }])
  })

  it('leaves the schedule untouched when nothing is pinned', () => {
    const days: TestDay[] = [{ date: '2026-11-02', items: [{ id: 'squat' }] }]
    expect(pinItemsToDates(days, days, [], options).schedule).toBe(days)
  })
})

describe('habitStats', () => {
  const everyDay = [0, 1, 2, 3, 4, 5, 6]

  it('counts a streak without breaking on an unfinished today', () => {
    const done = new Set(['2026-10-30', '2026-10-31'])
    expect(habitStats(everyDay, done, '2026-11-01').streak).toBe(2)
    done.add('2026-11-01')
    expect(habitStats(everyDay, done, '2026-11-01').streak).toBe(3)
  })

  it('skips days the habit is not scheduled on', () => {
    // Mon/Wed/Fri habit; 2026-11-02 is a Monday
    const done = new Set(['2026-10-28', '2026-10-30', '2026-11-02'])
    expect(habitStats([1, 3, 5], done, '2026-11-03').streak).toBe(3)
  })

  it('tallies the current Sunday-to-Saturday week', () => {
    // Sunday isn't a scheduled day for a Mon/Wed/Fri habit, so only Monday counts
    const done = new Set(['2026-11-01', '2026-11-02'])
    expect(habitStats([1, 3, 5], done, '2026-11-02')).toMatchObject({ weekDone: 1, weekDue: 3 })
  })
})

describe('isDueOn', () => {
  it('matches weekdays in UTC-independent fashion', () => {
    expect(isDueOn([0], '2026-11-01')).toBe(true)
    expect(isDueOn([1], '2026-11-01')).toBe(false)
    expect(isDueOn([], '2026-11-01')).toBe(false)
  })
})

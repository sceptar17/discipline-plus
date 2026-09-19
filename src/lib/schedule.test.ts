import { describe, expect, it } from 'vitest'
import { isCalendarDate, swapScheduleDates } from './schedule'

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

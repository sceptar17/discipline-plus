export type ScheduleEntryLike<Item extends { id: string }> = {
  date: string
  items: Item[]
}

export type SourceLogLike = {
  sourceItemId?: string
  date: string
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

export function swapScheduleDates<
  Item extends { id: string },
  Day extends ScheduleEntryLike<Item>,
  Log extends SourceLogLike,
>(schedule: Day[], logs: Log[], sourceDate: string, targetDate: string, normalize: (day: Day) => Day) {
  if (!isCalendarDate(sourceDate) || !isCalendarDate(targetDate) || sourceDate === targetDate) return null
  const sourceDay = schedule.find((entry) => entry.date === sourceDate)
  const targetDay = schedule.find((entry) => entry.date === targetDate)
  if (!sourceDay && !targetDay) return null

  const itemDateMap = new Map<string, string>()
  sourceDay?.items.forEach((item) => itemDateMap.set(item.id, targetDate))
  targetDay?.items.forEach((item) => itemDateMap.set(item.id, sourceDate))

  const nextSchedule = schedule.filter((entry) => entry.date !== sourceDate && entry.date !== targetDate)
  if (targetDay) nextSchedule.push(normalize({ ...targetDay, date: sourceDate }))
  if (sourceDay) nextSchedule.push(normalize({ ...sourceDay, date: targetDate }))
  nextSchedule.sort((a, b) => a.date.localeCompare(b.date))

  const nextLogs = logs.map((entry) => {
    if (!entry.sourceItemId) return entry
    const nextDate = itemDateMap.get(entry.sourceItemId)
    return nextDate ? { ...entry, date: nextDate } : entry
  })
  return { schedule: nextSchedule, logs: nextLogs }
}

/**
 * After days have been moved (swap, drag-reorder, push forward), put "pinned" items — habits —
 * back on the calendar date they were on before the move, and point their logs back at that date.
 * Days left with no items that `isDisposable` allows dropping are removed.
 */
export function pinItemsToDates<
  Day extends ScheduleEntryLike<{ id: string }>,
  Log extends SourceLogLike,
>(
  before: Day[],
  after: Day[],
  logs: Log[],
  options: {
    isPinned: (item: Day['items'][number]) => boolean
    emptyDay: (date: string) => Day
    isDisposable: (day: Day) => boolean
    normalize: (day: Day) => Day
  },
) {
  const homeDate = new Map<string, string>()
  for (const day of before) {
    for (const item of day.items) {
      if (options.isPinned(item)) homeDate.set(item.id, day.date)
    }
  }
  if (homeDate.size === 0) return { schedule: after, logs }

  const byDate = new Map<string, Day>()
  const homeless: Array<{ item: Day['items'][number]; date: string }> = []
  const touched = new Set<string>()
  for (const day of after) {
    const stays = day.items.filter((item) => {
      const home = homeDate.get(item.id)
      if (home === undefined || home === day.date) return true
      homeless.push({ item, date: home })
      return false
    })
    if (stays.length !== day.items.length) touched.add(day.date)
    byDate.set(day.date, stays.length === day.items.length ? day : { ...day, items: stays })
  }
  for (const { item, date } of homeless) {
    const host = byDate.get(date) ?? options.emptyDay(date)
    byDate.set(date, { ...host, items: [...host.items, item] })
    touched.add(date)
  }

  const schedule = [...byDate.values()]
    .map((day) => touched.has(day.date) ? options.normalize(day) : day)
    .filter((day) => !(touched.has(day.date) && day.items.length === 0 && options.isDisposable(day)))
    .sort((a, b) => a.date.localeCompare(b.date))
  const nextLogs = logs.map((entry) => {
    const home = entry.sourceItemId ? homeDate.get(entry.sourceItemId) : undefined
    return home && home !== entry.date ? { ...entry, date: home } : entry
  })
  return { schedule, logs: nextLogs }
}

/** True when `date` (YYYY-MM-DD) falls on one of `weekdays` (0 = Sunday … 6 = Saturday). */
export function isDueOn(weekdays: number[] | undefined, date: string) {
  if (!weekdays?.length || !isCalendarDate(date)) return false
  const [year, month, day] = date.split('-').map(Number)
  return weekdays.includes(new Date(Date.UTC(year, month - 1, day)).getUTCDay())
}

function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return next.toISOString().slice(0, 10)
}

/**
 * Streak and this week's tally (due days up to today) for a recurring habit.
 * `doneDates` are dates the habit was completed. Today only counts toward the streak once it's done,
 * so an unfinished today doesn't break a running streak.
 */
export function habitStats(weekdays: number[] | undefined, doneDates: Set<string>, today: string, lookbackDays = 366) {
  let streak = 0
  if (weekdays?.length && isCalendarDate(today)) {
    let cursor = isDueOn(weekdays, today) && !doneDates.has(today) ? shiftDate(today, -1) : today
    for (let i = 0; i < lookbackDays; i += 1) {
      if (isDueOn(weekdays, cursor)) {
        if (!doneDates.has(cursor)) break
        streak += 1
      }
      cursor = shiftDate(cursor, -1)
    }
  }
  let weekDone = 0
  let weekDue = 0
  if (isCalendarDate(today)) {
    const [year, month, day] = today.split('-').map(Number)
    const sunday = shiftDate(today, -new Date(Date.UTC(year, month - 1, day)).getUTCDay())
    for (let i = 0; i < 7; i += 1) {
      const date = shiftDate(sunday, i)
      // Count only days so far, so Monday morning doesn't read as "1 of 7".
      if (date > today || !isDueOn(weekdays, date)) continue
      weekDue += 1
      if (doneDates.has(date)) weekDone += 1
    }
  }
  return { streak, weekDone, weekDue }
}

export type ScheduleRowSet = {
  runs: Array<Record<string, unknown> & { id: string }>
  days: Array<Record<string, unknown> & { id: string }>
  items: Array<Record<string, unknown> & { id: string }>
  logs: Array<Record<string, unknown> & { id: string }>
}

export type ScheduleRowChanges = {
  upserts: ScheduleRowSet
  deletes: { runs: string[]; days: string[]; items: string[]; logs: string[] }
}

const SCHEDULE_ROW_TABLES = ['runs', 'days', 'items', 'logs'] as const

/** Fingerprint rows by id so a later save can send only what changed. */
export function fingerprintScheduleRows(rows: ScheduleRowSet) {
  return Object.fromEntries(SCHEDULE_ROW_TABLES.map((table) => [
    table,
    new Map(rows[table].map((row) => [row.id, JSON.stringify(row)])),
  ])) as Record<(typeof SCHEDULE_ROW_TABLES)[number], Map<string, string>>
}

export type ScheduleRowFingerprint = ReturnType<typeof fingerprintScheduleRows>

/** Rows that are new or different from `saved`, and ids that disappeared. */
export function diffScheduleRows(saved: ScheduleRowFingerprint, next: ScheduleRowSet): ScheduleRowChanges {
  const changes: ScheduleRowChanges = {
    upserts: { runs: [], days: [], items: [], logs: [] },
    deletes: { runs: [], days: [], items: [], logs: [] },
  }
  for (const table of SCHEDULE_ROW_TABLES) {
    const seen = new Set<string>()
    for (const row of next[table]) {
      seen.add(row.id)
      if (saved[table].get(row.id) !== JSON.stringify(row)) changes.upserts[table].push(row)
    }
    for (const id of saved[table].keys()) {
      if (!seen.has(id)) changes.deletes[table].push(id)
    }
  }
  return changes
}

export function scheduleChangeCount(changes: ScheduleRowChanges) {
  return SCHEDULE_ROW_TABLES.reduce((total, table) => total + changes.upserts[table].length + changes.deletes[table].length, 0)
}

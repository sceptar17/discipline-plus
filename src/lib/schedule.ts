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

import { add, d } from '../lib/format'

export type WeekDayStatus = { workout: 'none' | 'planned' | 'partial' | 'done' | 'skipped'; habitsDone: number }

type Props = {
  selected: string
  today: string
  statusFor: (date: string) => WeekDayStatus
  onSelect: (date: string) => void
}

/** Sunday–Saturday strip around the selected day, with arrows to move a week at a time. */
export function WeekStrip({ selected, today, statusFor, onSelect }: Props) {
  const start = add(selected, -d(selected).getDay())
  const days = Array.from({ length: 7 }, (_, index) => add(start, index))
  const showToday = !days.includes(today)
  return <div className="weekStrip" role="group" aria-label="Choose a day">
    <button type="button" className="weekArrow" onClick={() => onSelect(add(selected, -7))} aria-label="Previous week">‹</button>
    <div className="weekDays">
      {days.map((date) => {
        const status = statusFor(date)
        const label = d(date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
        const state = status.workout === 'none' ? 'rest' : status.workout
        return <button
          key={date}
          type="button"
          className={['weekDay', date === selected && 'selected', date === today && 'isToday'].filter(Boolean).join(' ')}
          onClick={() => onSelect(date)}
          aria-pressed={date === selected}
          aria-label={`${label}${date === today ? ', today' : ''}. ${state === 'rest' ? 'Rest day' : state === 'done' ? 'Workout done' : state === 'partial' ? 'Workout started' : state === 'skipped' ? 'Skipped' : 'Workout planned'}${status.habitsDone ? `, ${status.habitsDone} habit${status.habitsDone === 1 ? '' : 's'} done` : ''}`}
        >
          <span className="weekDayName">{d(date).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
          <span className="weekDayNumber">{d(date).getDate()}</span>
          <span className={`weekDayMark ${state}`} aria-hidden="true" />
        </button>
      })}
    </div>
    <button type="button" className="weekArrow" onClick={() => onSelect(add(selected, 7))} aria-label="Next week">›</button>
    {showToday && <button type="button" className="weekTodayButton" onClick={() => onSelect(today)}>Today</button>}
  </div>
}

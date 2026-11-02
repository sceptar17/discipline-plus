import { useMemo, useState } from 'react'
import { LineChart } from '../components/LineChart'
import { Sheet } from '../components/Sheet'
import { fmtSecs, fmtShort } from '../lib/format'
import { PACE_LABEL, summarizeProgress, verdictCopy, type LiftMeasure, type LiftSummary, type Pace } from '../lib/progress'
import { thresholdsFor, type Sex } from '../lib/standards'
import type { Day, Exercise, Log } from '../types'

export type ProgressProfileInput = { sex?: Sex; birthYear?: number; heightInches?: number; equipmentMaxLb?: number }

type Props = {
  exercises: Exercise[]
  logs: Log[]
  schedule: Day[]
  today: string
  profile: ProgressProfileInput
  bodyweights: Array<{ date: string; weight: number }>
  onOpenDay: (date: string) => void
  onEditProfile: () => void
}

const WINDOWS = [4, 8, 12] as const

function formatMeasure(measure: LiftMeasure, value: number) {
  if (measure === 'e1rm') return `${Math.round(value)} lb`
  if (measure === 'seconds') return fmtSecs(Math.round(value))
  return `${Math.round(value)} reps`
}

function measureLabel(measure: LiftMeasure) {
  return measure === 'e1rm' ? 'Estimated 1-rep max' : measure === 'seconds' ? 'Longest hold' : 'Best set'
}

function paceTone(pace: Pace) {
  return pace === 'fast' || pace === 'steady' ? 'good' : pace === 'slipping' ? 'warn' : 'neutral'
}

function ChangeChip({ lift }: { lift: LiftSummary }) {
  if (lift.changePct === undefined) return <span className="paceChip neutral">New</span>
  const sign = lift.changePct > 0.5 ? '+' : ''
  return <span className={`paceChip ${paceTone(lift.pace)}`}>
    <span aria-hidden="true">{lift.pace === 'slipping' ? '↓' : lift.pace === 'flat' ? '→' : '↑'}</span> {sign}{lift.changePct.toFixed(0)}%
  </span>
}

function NormMeter({ percentile }: { percentile: number }) {
  return <div className="normMeter" role="img" aria-label={`Stronger than about ${percentile}% of logged lifters`}>
    <div className="normTrack">
      {[20, 50, 80].map((tick) => <span key={tick} className="normTick" style={{ left: `${tick}%` }} />)}
      <span className={percentile < 20 ? 'normMarker below' : 'normMarker'} style={{ left: `${Math.min(98, Math.max(2, percentile))}%` }} />
    </div>
    <div className="normScale" aria-hidden="true"><span>Beginner</span><span>Typical</span><span>Strong</span></div>
  </div>
}

export function ProgressScreen({ exercises, logs, schedule, today, profile, bodyweights, onOpenDay, onEditProfile }: Props) {
  const [windowWeeks, setWindowWeeks] = useState<(typeof WINDOWS)[number]>(8)
  const [openLiftId, setOpenLiftId] = useState<string | null>(null)
  const latestBodyweight = bodyweights.length ? [...bodyweights].sort((a, b) => a.date.localeCompare(b.date))[bodyweights.length - 1].weight : undefined
  const age = profile.birthYear ? Number(today.slice(0, 4)) - profile.birthYear : undefined
  const summary = useMemo(() => summarizeProgress({
    exercises,
    logs,
    schedule,
    today,
    windowWeeks,
    profile: { sex: profile.sex, age, bodyweight: latestBodyweight, equipmentMaxLb: profile.equipmentMaxLb },
    bodyweights,
  }), [exercises, logs, schedule, today, windowWeeks, profile.sex, profile.equipmentMaxLb, age, latestBodyweight, bodyweights])
  const copy = verdictCopy(summary, windowWeeks)
  const normsReady = Boolean(profile.sex && age && latestBodyweight)
  const withNorms = summary.lifts.filter((lift) => lift.norm).sort((a, b) => normScore(a) - normScore(b))
  const openLift = summary.lifts.find((lift) => lift.exerciseId === openLiftId) ?? null
  const windowStart = new Date(Date.parse(`${today}T00:00:00Z`) - windowWeeks * 7 * 86400000).toISOString().slice(0, 10)
  const weightPoints = bodyweights.filter((entry) => entry.date >= windowStart && entry.date <= today).map((entry) => ({ date: entry.date, value: entry.weight }))
  const { workoutsPlanned, workoutsDone, habitDue, habitDone } = summary.consistency

  return <main className="progressPage stack">
    <section className="pageHeader">
      <div><p className="eyebrow">Progress</p><h2>Am I getting stronger?</h2></div>
      <div className="segmented" role="group" aria-label="Time window">
        {WINDOWS.map((weeks) => <button key={weeks} type="button" className={weeks === windowWeeks ? 'segment active' : 'segment'} aria-pressed={weeks === windowWeeks} onClick={() => setWindowWeeks(weeks)}>{weeks} wk</button>)}
      </div>
    </section>

    <section className="panel stack progressHero">
      <div>
        <p className={`verdictTag ${paceTone(summary.verdict === 'none' ? 'new' : summary.verdict)}`}>{summary.verdict === 'none' ? 'Getting started' : PACE_LABEL[summary.verdict]}</p>
        <h3 className="verdictHeadline">{copy.headline}</h3>
        <p className="mutedCopy">{copy.detail}</p>
      </div>
      {summary.index.length > 1 && <div>
        <p className="chartTitle">Strength index <span>· all lifts, start of window = 100</span></p>
        <LineChart points={summary.index} label="Strength index" format={(value) => value.toFixed(0)} baseline={100} />
      </div>}
      {summary.lifts.length > 0 && <div className="statRow">
        <div><strong>{summary.counts.improving}</strong><span>improving</span></div>
        <div><strong>{summary.counts.flat}</strong><span>holding</span></div>
        <div><strong>{summary.counts.slipping}</strong><span>slipping</span></div>
        {summary.counts.new > 0 && <div><strong>{summary.counts.new}</strong><span>too new</span></div>}
      </div>}
    </section>

    {summary.focus.length > 0 && <section className="panel stack">
      <div><p className="eyebrow">Worth a look</p><h3>Where to focus</h3></div>
      <div className="stack compactStack">
        {summary.focus.map((lift) => <button key={lift.exerciseId} type="button" className="insightRow warn" onClick={() => setOpenLiftId(lift.exerciseId)}>
          <span className="statusIcon" aria-hidden="true">!</span>
          <span className="insightText"><strong>{lift.name}</strong><span>{lift.focusReason}</span></span>
          <span aria-hidden="true">›</span>
        </button>)}
      </div>
    </section>}

    <section className="panel stack">
      <div><p className="eyebrow">Against the norm</p><h3>How you compare</h3><p className="mutedCopy">People your size{age ? ' and age' : ''} who log their lifts. That group skews stronger than average, so “typical” here is a fair bar, not a low one.</p></div>
      {!normsReady ? <div className="noticeCard">
        <p>{!profile.sex || !age ? 'Add your age and sex in your profile to compare your lifts with norms.' : 'Log a body weight (or sync it from your phone) to compare your lifts with norms.'}</p>
        {(!profile.sex || !age) && <button type="button" className="pill" onClick={onEditProfile}>Open profile</button>}
      </div> : withNorms.length === 0 ? <p className="mutedCopy">None of your recent lifts have a published norm yet. Curls, presses, rows, goblet squats, RDLs, lateral raises, pull-ups and push-ups do.</p> : <div className="stack compactStack">
        {withNorms.map((lift) => <button key={lift.exerciseId} type="button" className="normRow" onClick={() => setOpenLiftId(lift.exerciseId)}>
          <div className="normRowHeading">
            <strong>{lift.name}</strong>
            {lift.norm?.below && <span className="statusLabel warn"><span aria-hidden="true">!</span> Below norm</span>}
          </div>
          {lift.norm?.kind === 'percentile' ? <>
            <NormMeter percentile={lift.norm.percentile} />
            <span className="normCaption">Stronger than about {lift.norm.percentile}% · {lift.norm.level}{lift.norm.next ? ` · ${lift.norm.next.level} at ≈${Math.round(lift.norm.next.value)} ${lift.measure === 'reps' ? 'reps' : 'lb'}` : ''}</span>
          </> : lift.norm?.kind === 'pushups' ? <span className="normCaption">{Math.round(lift.current)} in a set · <strong>{lift.norm.rating}</strong> for your age{lift.norm.next ? ` · ${lift.norm.next.rating} at ${lift.norm.next.reps}` : ''}</span> : null}
        </button>)}
      </div>}
    </section>

    <section className="panel stack">
      <div><p className="eyebrow">Lifts</p><h3>Each lift over {windowWeeks} weeks</h3></div>
      {summary.lifts.length === 0 ? <p className="mutedCopy">Complete a few exercises and they’ll show up here.</p> : <div className="liftList">
        {[...summary.lifts].sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999)).map((lift) => <button key={lift.exerciseId} type="button" className="liftRow" onClick={() => setOpenLiftId(lift.exerciseId)}>
          <span className="liftRowText"><strong>{lift.name}</strong><span>{formatMeasure(lift.measure, lift.current)} {lift.measure === 'e1rm' ? 'est. max' : ''}{lift.roughEstimate ? ' · rough' : ''}</span></span>
          {lift.points.length > 1 && <span className="liftSpark"><LineChart compact height={36} points={lift.points.filter((point) => point.date >= windowStart).map((point) => ({ date: point.date, value: point.value }))} label={`${lift.name} trend`} format={(value) => formatMeasure(lift.measure, value)} /></span>}
          <ChangeChip lift={lift} />
        </button>)}
      </div>}
    </section>

    <div className="progressPair">
      <section className="panel stack">
        <div><p className="eyebrow">Consistency</p><h3>Showing up</h3></div>
        <div className="statRow">
          <div><strong>{workoutsDone}<small>/{workoutsPlanned}</small></strong><span>workouts</span></div>
          {habitDue > 0 && <div><strong>{habitDone}<small>/{habitDue}</small></strong><span>habit check-ins</span></div>}
        </div>
        {workoutsPlanned > 0 && <div className="progressTrack" aria-label={`${Math.round((workoutsDone / workoutsPlanned) * 100)}% of workouts done`}><div className="progressFill" style={{ width: `${Math.round((workoutsDone / workoutsPlanned) * 100)}%` }} /></div>}
      </section>
      <section className="panel stack">
        <div><p className="eyebrow">Body weight</p><h3>{summary.bodyweight ? `${summary.bodyweight.latest.toFixed(1)} lb` : 'No weigh-ins yet'}</h3>{summary.bodyweight && <p className="mutedCopy">{summary.bodyweight.change <= -0.1 ? `Down ${Math.abs(summary.bodyweight.change).toFixed(1)} lb` : summary.bodyweight.change >= 0.1 ? `Up ${summary.bodyweight.change.toFixed(1)} lb` : 'No change'} over {windowWeeks} weeks</p>}</div>
        {weightPoints.length > 1 && <LineChart points={weightPoints} label="Body weight" format={(value) => `${value.toFixed(0)}`} height={120} />}
      </section>
    </div>

    <details className="howItWorks">
      <summary>How this is worked out</summary>
      <ul>
        <li>For weighted lifts, each session’s best set is turned into an estimated one-rep max (weight × (1 + reps ÷ 30)). Above about 12 reps the estimate gets rough, so those are marked.</li>
        <li>Pace compares your best recent sessions with where you were at the start of the window. As a rough guide, lifts climb several percent a week early in training, closer to 0.5–1% a week after the first few months, and only a few percent a year for experienced lifters.</li>
        <li>Norms come from <a href="https://strengthlevel.com/strength-standards" target="_blank" rel="noreferrer">Strength Level</a>’s community data (per dumbbell, by body weight and sex). Floor press is compared with bench press, and hammer curls with curls. After 40 they’re lowered about 1% a year, a common working assumption for age. Push-ups use <a href="https://www.topendsports.com/testing/tests/push-up.htm" target="_blank" rel="noreferrer">ACSM-based norms by age</a>.</li>
        <li>“Below norm” means weaker than about 80% of people your size who log the lift. If a lift is below norm and not climbing quickly, it shows up under Where to focus.</li>
      </ul>
    </details>

    {openLift && <Sheet title={openLift.name} subtitle={measureLabel(openLift.measure)} onClose={() => setOpenLiftId(null)}>
      <LiftDetail lift={openLift} profile={{ sex: profile.sex, age, bodyweight: latestBodyweight }} onOpenDay={(date) => { setOpenLiftId(null); onOpenDay(date) }} />
    </Sheet>}
  </main>
}

function normScore(lift: LiftSummary) {
  if (lift.norm?.kind === 'percentile') return lift.norm.percentile
  if (lift.norm?.kind === 'pushups') return lift.norm.below ? 10 : 60
  return 100
}

function LiftDetail({ lift, profile, onOpenDay }: { lift: LiftSummary; profile: { sex?: Sex; age?: number; bodyweight?: number }; onOpenDay: (date: string) => void }) {
  const references = lift.norm?.kind === 'percentile' && profile.sex && profile.bodyweight
    ? (() => {
        const thresholds = thresholdsFor(lift.norm.standard, profile.sex, profile.bodyweight, profile.age)
        const values = lift.points.map((point) => point.value)
        const top = Math.max(...values) * 1.6
        return [{ value: thresholds[1], label: 'Novice' }, { value: thresholds[2], label: 'Typical' }, { value: thresholds[3], label: 'Advanced' }].filter((ref) => ref.value <= top)
      })()
    : []
  const recent = [...lift.points].reverse().slice(0, 8)
  return <div className="stack">
    <div className="statRow">
      <div><strong>{formatMeasure(lift.measure, lift.current)}</strong><span>now</span></div>
      {lift.changePct !== undefined && <div><strong>{lift.changePct > 0 ? '+' : ''}{lift.changePct.toFixed(0)}%</strong><span>over {Math.round(lift.weeksMeasured ?? 0)} wk</span></div>}
      <div><strong className={`paceText ${paceTone(lift.pace)}`}>{PACE_LABEL[lift.pace]}</strong><span>pace</span></div>
    </div>
    {lift.points.length > 1 && <LineChart points={lift.points} label={`${lift.name} ${measureLabel(lift.measure)}`} format={(value) => formatMeasure(lift.measure, value)} references={references} />}
    {lift.focusReason && <p className="statusLabel warn block"><span aria-hidden="true">!</span> {lift.focusReason}</p>}
    {lift.atEquipmentMax && !lift.focusReason && <p className="mutedCopy">You’re at your heaviest dumbbell, so progress shows up as more reps rather than more weight.</p>}
    {lift.norm?.kind === 'percentile' && <p className="mutedCopy">Compared with {lift.norm.standardLabel.toLowerCase()} norms: stronger than about {lift.norm.percentile}% of logged lifters your size{profile.age ? ' and age' : ''} ({lift.norm.level}).</p>}
    <div className="stack compactStack">
      <p className="fieldLabel">Recent sessions</p>
      {recent.map((point) => <button key={point.date} type="button" className="sessionRow" onClick={() => onOpenDay(point.date)}>
        <span>{fmtShort(point.date)}</span>
        <span>{point.weight !== undefined ? `${point.weight} lb × ${point.reps}` : formatMeasure(lift.measure, point.value)}</span>
        <span className="mutedCopy">{lift.measure === 'e1rm' ? `≈${Math.round(point.value)} lb max` : ''}</span>
        <span aria-hidden="true">›</span>
      </button>)}
    </div>
  </div>
}

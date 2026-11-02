import { useId, useMemo, useState, type PointerEvent } from 'react'
import { fmtShort } from '../lib/format'

export type ChartPoint = { date: string; value: number }
export type ReferenceLine = { value: number; label: string }

type Props = {
  points: ChartPoint[]
  label: string
  format: (value: number) => string
  height?: number
  baseline?: number
  references?: ReferenceLine[]
  compact?: boolean
}

const WIDTH = 640

/** Single-series line chart: 2px line, end dot, hairline grid, crosshair + tooltip on hover/touch. */
export function LineChart({ points, label, format, height = 180, baseline, references = [], compact = false }: Props) {
  const titleId = useId()
  const [hover, setHover] = useState<number | null>(null)
  // Labels are HTML (outside the stretched SVG) so they stay legible at any width.
  const pad = compact ? { top: 6, right: 6, bottom: 6, left: 6 } : { top: 10, right: 6, bottom: 8, left: 6 }
  const { xs, ys, ticks, y } = useMemo(() => {
    const values = [...points.map((point) => point.value), ...(baseline !== undefined ? [baseline] : []), ...references.map((ref) => ref.value)]
    let min = Math.min(...values)
    let max = Math.max(...values)
    if (min === max) {
      min -= 1
      max += 1
    }
    const span = max - min
    min -= span * 0.12
    max += span * 0.12
    const times = points.map((point) => Date.parse(`${point.date}T00:00:00Z`))
    const t0 = Math.min(...times)
    const t1 = Math.max(...times)
    const xScale = (time: number) => pad.left + (t1 === t0 ? (WIDTH - pad.left - pad.right) / 2 : ((time - t0) / (t1 - t0)) * (WIDTH - pad.left - pad.right))
    const yScale = (value: number) => pad.top + (1 - (value - min) / (max - min)) * (height - pad.top - pad.bottom)
    const step = niceStep((max - min) / 3)
    const tickValues: number[] = []
    for (let value = Math.ceil(min / step) * step; value <= max; value += step) tickValues.push(value)
    return { xs: times.map(xScale), ys: points.map((point) => yScale(point.value)), ticks: tickValues, y: yScale }
  }, [points, baseline, references, height, pad.left, pad.right, pad.top, pad.bottom])

  if (points.length === 0) return null
  const path = xs.map((x, index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${ys[index].toFixed(1)}`).join(' ')
  const area = `${path} L${xs[xs.length - 1].toFixed(1)},${height - pad.bottom} L${xs[0].toFixed(1)},${height - pad.bottom} Z`
  const last = points.length - 1
  const active = hover ?? null

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH
    let nearest = 0
    xs.forEach((value, index) => {
      if (Math.abs(value - x) < Math.abs(xs[nearest] - x)) nearest = index
    })
    setHover(nearest)
  }

  return <figure className={compact ? 'lineChart compactChart' : 'lineChart'}>
    <div className="chartPlot">
    <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-labelledby={titleId} preserveAspectRatio="none" onPointerMove={compact ? undefined : onMove} onPointerLeave={() => setHover(null)} onPointerDown={compact ? undefined : onMove}>
      <title id={titleId}>{`${label}: ${points.map((point) => `${fmtShort(point.date)} ${format(point.value)}`).join(', ')}`}</title>
      {!compact && ticks.map((tick) => <line key={tick} className="chartGrid" x1={0} x2={WIDTH} y1={y(tick)} y2={y(tick)} />)}
      {references.map((ref) => <line key={ref.label} className="chartReference" x1={0} x2={WIDTH} y1={y(ref.value)} y2={y(ref.value)} />)}
      {baseline !== undefined && <line className="chartBaseline" x1={pad.left} x2={WIDTH - pad.right} y1={y(baseline)} y2={y(baseline)} />}
      <path className="chartArea" d={area} />
      <path className="chartLine" d={path} vectorEffect="non-scaling-stroke" />
      {active !== null && <line className="chartCrosshair" x1={xs[active]} x2={xs[active]} y1={pad.top} y2={height - pad.bottom} vectorEffect="non-scaling-stroke" />}
    </svg>
    {!compact && ticks.map((tick) => <span key={tick} className="chartAxisLabel yLabel" style={{ top: `${(y(tick) / height) * 100}%` }}>{format(tick)}</span>)}
    {!compact && references.map((ref) => <span key={ref.label} className="chartAxisLabel refLabel" style={{ top: `${(y(ref.value) / height) * 100}%` }}>{ref.label}</span>)}
    {/* Dots are HTML so they stay round when the SVG stretches. */}
    <span className="chartDot" style={{ left: `${(xs[active ?? last] / WIDTH) * 100}%`, top: `${(ys[active ?? last] / height) * 100}%` }} aria-hidden="true" />
    {active !== null && <span className="chartTooltip" style={{ left: `${Math.min(82, Math.max(18, (xs[active] / WIDTH) * 100))}%` }}>
      <strong>{format(points[active].value)}</strong>
      <span>{fmtShort(points[active].date)}</span>
    </span>}
    </div>
    {!compact && points.length > 1 && <div className="chartXLabels" aria-hidden="true"><span>{fmtShort(points[0].date)}</span><span>{fmtShort(points[last].date)}</span></div>}
  </figure>
}

function niceStep(raw: number) {
  if (!(raw > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(raw))
  const scaled = raw / power
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power
}

import type { ReactNode } from 'react'
import { numberInputValue, parseNumberInput } from '../lib/format'
import type { CountUnit, Target, TT } from '../types'

function minutesValue(seconds?: number) {
  return seconds === undefined ? '' : String(Math.round((seconds / 60) * 100) / 100)
}

export function TargetEditor({ type, target, onChange, actions, layout = 'default', durationIn = 'seconds' }: { type: TT; target: Target; onChange: (t: Target) => void; actions?: ReactNode; layout?: 'default' | 'detail'; durationIn?: 'seconds' | 'minutes' }) {
  if (type === 'count') {
    const fields = <div className="countTargetFields"><label className={`field ${layout === 'detail' ? 'compactMetricField compactControl' : 'grow'}`}><span>Target count</span><input type="number" min={1} value={numberInputValue(target.count)} onChange={(e) => onChange({ ...target, count: parseNumberInput(e.target.value) })} /></label><label className={`field countUnitField ${layout === 'detail' ? 'compactControl' : ''}`}><span>Count as</span><select value={target.countUnit ?? 'reps'} onChange={(e) => onChange({ ...target, countUnit: e.target.value as CountUnit })}><option value="reps">Reps</option><option value="steps">Steps</option></select></label></div>
    return <div className="targetRow">{fields}{actions}</div>
  }
  if (type === 'sets') {
    if (layout === 'detail') return <div className="detailTargetFields"><label className="field microField compactControl"><span>Sets</span><input type="number" min={1} value={numberInputValue(target.sets)} onChange={(e) => onChange({ ...target, sets: parseNumberInput(e.target.value) })} /></label><label className="field microField compactControl"><span>Reps</span><input type="number" min={1} value={numberInputValue(target.reps)} onChange={(e) => onChange({ ...target, reps: parseNumberInput(e.target.value) })} /></label>{actions}</div>
    return <div className="targetInline"><div className="split compactSplit"><label className="field"><span>Sets</span><input type="number" min={1} value={numberInputValue(target.sets)} onChange={(e) => onChange({ ...target, sets: parseNumberInput(e.target.value) })} /></label><label className="field"><span>Reps</span><input type="number" min={1} value={numberInputValue(target.reps)} onChange={(e) => onChange({ ...target, reps: parseNumberInput(e.target.value) })} /></label></div>{actions}</div>
  }
  if (type === 'duration' && durationIn === 'minutes') {
    const input = <input type="number" min={1} step="any" inputMode="decimal" value={minutesValue(target.seconds)} onChange={(e) => {
      const minutes = parseNumberInput(e.target.value)
      onChange({ seconds: minutes === undefined ? undefined : Math.round(minutes * 60) })
    }} />
    if (layout === 'detail') return <div className="targetRow"><label className="field compactMetricField compactControl"><span>Minutes</span>{input}</label>{actions}</div>
    return <div className="targetRow"><label className="field grow"><span>Target minutes</span>{input}</label>{actions}</div>
  }
  if (type === 'duration') {
    if (layout === 'detail') return <div className="targetRow"><label className="field compactMetricField compactControl"><span>Seconds</span><input type="number" min={10} value={numberInputValue(target.seconds)} onChange={(e) => onChange({ seconds: parseNumberInput(e.target.value) })} /></label>{actions}</div>
    return <div className="targetRow"><label className="field grow"><span>Target duration in seconds</span><input type="number" min={10} value={numberInputValue(target.seconds)} onChange={(e) => onChange({ seconds: parseNumberInput(e.target.value) })} /></label>{actions}</div>
  }
  if (type === 'distance') {
    if (layout === 'detail') {
      return <div className="targetInline"><div className="detailDistanceFields"><label className="field compactMetricField compactControl"><span>Distance</span><input type="number" min={0} step="0.1" value={numberInputValue(target.distance)} onChange={(e) => onChange({ ...target, distance: parseNumberInput(e.target.value) })} /></label><label className="field compactField compactControl"><span>Unit</span><select value={target.unit ?? 'mi'} onChange={(e) => onChange({ ...target, unit: e.target.value as 'mi' | 'km' })}><option value="mi">Miles</option><option value="km">Kilometers</option></select></label></div>{actions}</div>
    }
    return <div className="targetInline"><div className="split compactSplit"><label className="field"><span>Distance</span><input type="number" min={0} step="0.1" value={numberInputValue(target.distance)} onChange={(e) => onChange({ ...target, distance: parseNumberInput(e.target.value) })} /></label><label className="field compactField"><span>Unit</span><select value={target.unit ?? 'mi'} onChange={(e) => onChange({ ...target, unit: e.target.value as 'mi' | 'km' })}><option value="mi">Miles</option><option value="km">Kilometers</option></select></label></div>{actions}</div>
  }
  if (type === 'for-time') {
    if (layout === 'detail') return <div className="targetRow"><label className="field compactMetricField compactControl"><span>Fixed reps</span><input type="number" min={1} value={numberInputValue(target.count)} onChange={(e) => onChange({ count: parseNumberInput(e.target.value) })} /></label>{actions}</div>
    return <div className="targetRow"><label className="field grow"><span>Fixed reps</span><input type="number" min={1} value={numberInputValue(target.count)} onChange={(e) => onChange({ count: parseNumberInput(e.target.value) })} /></label>{actions}</div>
  }
  if (layout === 'detail') return <div className="detailTargetFields"><label className="field microField compactControl"><span>Sets</span><input type="number" min={1} value={numberInputValue(target.sets)} onChange={(e) => onChange({ ...target, sets: parseNumberInput(e.target.value) })} /></label><label className="field microField compactControl"><span>Reps</span><input type="number" min={1} value={numberInputValue(target.reps)} onChange={(e) => onChange({ ...target, reps: parseNumberInput(e.target.value) })} /></label><label className="field microField compactControl"><span>Weight</span><input type="number" min={0} value={numberInputValue(target.weight)} onChange={(e) => onChange({ ...target, weight: parseNumberInput(e.target.value) })} /></label>{actions}</div>
  return <div className="targetInline"><div className="split threeUp"><label className="field"><span>Sets</span><input type="number" min={1} value={numberInputValue(target.sets)} onChange={(e) => onChange({ ...target, sets: parseNumberInput(e.target.value) })} /></label><label className="field"><span>Reps</span><input type="number" min={1} value={numberInputValue(target.reps)} onChange={(e) => onChange({ ...target, reps: parseNumberInput(e.target.value) })} /></label><label className="field"><span>Weight</span><input type="number" min={0} value={numberInputValue(target.weight)} onChange={(e) => onChange({ ...target, weight: parseNumberInput(e.target.value) })} /></label></div>{actions}</div>
}

import { powerBlockSetting } from '../lib/powerblock'

/** Colored dot + pin/adder label for a per-dumbbell weight, matching the PowerBlock handle chart. */
export function PowerBlockBadge({ weight, compact = false }: { weight?: number; compact?: boolean }) {
  const setting = powerBlockSetting(weight)
  if (!setting) return null
  const title = `PowerBlock: ${setting.label}${setting.exact ? '' : ` (${setting.weight} lb is the closest setting)`}`
  return <span className={compact ? 'powerBlockBadge compact' : 'powerBlockBadge'} title={title} aria-label={title}>
    <span
      className={setting.rail?.ring ? 'powerBlockDot ringed' : 'powerBlockDot'}
      style={{ background: setting.rail?.swatch ?? 'transparent' }}
      aria-hidden="true"
    >{setting.rail ? '' : 'H'}</span>
    {setting.adders > 0 && <span className="powerBlockAdders" aria-hidden="true">+{setting.adders}</span>}
    {!compact && <span className="powerBlockLabel">{setting.label}</span>}
  </span>
}

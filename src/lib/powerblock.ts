// PowerBlock 5–50 lb color chart (from the handle label). Settings prefer keeping both adders in:
// empty handle 5 lb; each adder weight +2.5 lb; each color rail adds the block shown.
//   Black 10/12.5/15 · White 15/17.5/20 · Purple 20/22.5/25 · Green 25/27.5/30
//   Yellow 30/32.5/35 · Blue 35/37.5/40 · Red 40/42.5/45 · Black 45/47.5/50

export type PowerBlockRail = { name: string; swatch: string; base: number; ring?: boolean }

export const POWERBLOCK_RAILS: readonly PowerBlockRail[] = [
  { name: 'Black', swatch: '#1f2328', base: 10 },
  { name: 'White', swatch: '#f7f4ea', base: 15, ring: true },
  { name: 'Purple', swatch: '#a978c9', base: 20 },
  { name: 'Green', swatch: '#14a05a', base: 25 },
  { name: 'Yellow', swatch: '#f4b400', base: 30 },
  { name: 'Blue', swatch: '#1e88e5', base: 35 },
  { name: 'Red', swatch: '#e2393b', base: 40 },
  { name: 'Black', swatch: '#1f2328', base: 45 },
]

export type PowerBlockSetting = {
  weight: number
  /** Null when only the handle (5 or 7.5 lb) is used. */
  rail: PowerBlockRail | null
  adders: 0 | 1 | 2
  exact: boolean
  label: string
}

/**
 * The pin color and adder count for a per-dumbbell weight. Where two rails reach the same weight
 * (e.g. 25 = Purple + 2 adders, or Green empty) the lower rail with both adders in wins, so the adders
 * can stay in and only the pin moves. Weights round to the nearest 2.5 lb.
 */
export function powerBlockSetting(weight: number | undefined): PowerBlockSetting | null {
  if (weight === undefined || !Number.isFinite(weight) || weight < 5 || weight > 50) return null
  const rounded = Math.round(weight / 2.5) * 2.5
  const exact = Math.abs(rounded - weight) < 0.01
  if (rounded <= 10) {
    const adders = ((rounded - 5) / 2.5) as 0 | 1 | 2
    return { weight: rounded, rail: null, adders, exact, label: adders ? `Handle + ${adders} adder${adders === 1 ? '' : 's'}` : 'Handle only' }
  }
  // Each rail adds 5 lb over the one below it; 2 adders reach the next multiple of 5, 1 adder the half step.
  const adders: 1 | 2 = rounded % 5 === 0 ? 2 : 1
  const railIndex = (rounded - 5 - 2.5 * adders) / 5 - 1
  const rail = POWERBLOCK_RAILS[railIndex]
  // The chart has two black rails; say which one.
  const name = rail.name === 'Black' ? (railIndex === 0 ? 'Black (first)' : 'Black (last)') : rail.name
  return { weight: rounded, rail, adders, exact, label: `${name} + ${adders} adder${adders === 1 ? '' : 's'}` }
}

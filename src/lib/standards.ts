// Strength norms used by the Progress screen.
//
// Lift standards: Strength Level community data (strengthlevel.com/strength-standards), one-rep max per
// dumbbell in lb, by bodyweight. Levels mark the share of logged lifters you're stronger than:
// beginner 5%, novice 20%, intermediate 50%, advanced 80%, elite 95%. These are people who log lifts,
// so they skew stronger than the general public.
// Push-ups: ACSM-based norms by age (topendsports.com/testing/tests/push-up.htm).
// Age: lift norms assume roughly flat strength until 40, then about 1% less per year (the working
// assumption used for masters age adjustment, e.g. USAWA). It's an approximation, not a measured curve.

export type Sex = 'male' | 'female'
export type StandardId = 'bench' | 'curl' | 'shoulderPress' | 'row' | 'gobletSquat' | 'rdl' | 'lateralRaise' | 'pullUps'
type Row = readonly [bodyweight: number, beginner: number, novice: number, intermediate: number, advanced: number, elite: number]
type Standard = { label: string; unit: 'lb' | 'reps'; male: readonly Row[]; female: readonly Row[] }

const LEVEL_PERCENTILES = [5, 20, 50, 80, 95] as const
export const LEVEL_NAMES = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'] as const

export const STANDARDS: Record<StandardId, Standard> = {
  bench: {
    label: 'Dumbbell bench press',
    unit: 'lb',
    male: [[120, 23, 39, 59, 84, 112], [130, 27, 43, 65, 91, 120], [140, 30, 48, 70, 97, 127], [150, 34, 52, 75, 103, 133], [160, 37, 56, 80, 109, 140], [170, 40, 60, 85, 114, 146], [180, 43, 64, 89, 119, 152], [190, 46, 67, 94, 124, 158], [200, 49, 71, 98, 129, 163], [210, 52, 75, 102, 134, 169], [220, 55, 78, 106, 139, 174], [230, 58, 82, 110, 143, 179], [240, 61, 85, 114, 148, 184], [250, 64, 88, 118, 152, 189], [260, 66, 91, 122, 156, 194]],
    female: [[100, 10, 20, 33, 51, 71], [110, 11, 22, 36, 54, 75], [120, 13, 24, 39, 57, 79], [130, 14, 26, 41, 60, 82], [140, 16, 28, 43, 63, 85], [150, 17, 29, 46, 66, 88], [160, 18, 31, 48, 68, 91], [170, 20, 33, 50, 71, 94], [180, 21, 34, 52, 73, 97], [190, 22, 36, 54, 75, 99], [200, 23, 37, 56, 78, 102]],
  },
  curl: {
    label: 'Dumbbell curl',
    unit: 'lb',
    male: [[120, 11, 21, 36, 54, 75], [130, 12, 23, 38, 57, 79], [140, 13, 25, 40, 60, 82], [150, 15, 27, 43, 63, 86], [160, 16, 28, 45, 66, 89], [170, 17, 30, 47, 68, 92], [180, 19, 32, 49, 71, 95], [190, 20, 33, 51, 73, 97], [200, 21, 35, 53, 75, 100], [210, 22, 36, 55, 78, 103], [220, 23, 38, 57, 80, 105], [230, 24, 39, 59, 82, 108], [240, 26, 41, 60, 84, 110], [250, 27, 42, 62, 86, 112], [260, 28, 43, 64, 88, 114]],
    female: [[100, 6, 12, 22, 33, 47], [110, 7, 14, 23, 35, 49], [120, 8, 15, 25, 37, 51], [130, 8, 16, 26, 39, 53], [140, 9, 17, 27, 40, 55], [150, 10, 17, 28, 41, 57], [160, 10, 18, 29, 43, 58], [170, 11, 19, 30, 44, 60], [180, 12, 20, 31, 45, 61], [190, 12, 21, 32, 47, 62], [200, 13, 22, 33, 48, 64]],
  },
  shoulderPress: {
    label: 'Dumbbell shoulder press',
    unit: 'lb',
    male: [[120, 18, 30, 46, 65, 87], [130, 20, 33, 50, 70, 93], [140, 23, 37, 54, 75, 99], [150, 26, 40, 59, 80, 104], [160, 29, 44, 63, 85, 110], [170, 31, 47, 67, 90, 115], [180, 34, 50, 71, 94, 120], [190, 37, 53, 74, 99, 125], [200, 39, 57, 78, 103, 130], [210, 42, 60, 82, 107, 134], [220, 44, 63, 85, 111, 139], [230, 47, 65, 88, 115, 143], [240, 49, 68, 92, 118, 147], [250, 52, 71, 95, 122, 151], [260, 54, 74, 98, 126, 155]],
    female: [[100, 10, 17, 27, 38, 52], [110, 11, 18, 28, 41, 54], [120, 12, 20, 30, 43, 57], [130, 13, 21, 32, 45, 59], [140, 14, 22, 33, 46, 61], [150, 15, 24, 35, 48, 63], [160, 16, 25, 36, 50, 65], [170, 17, 26, 38, 51, 67], [180, 18, 27, 39, 53, 68], [190, 18, 28, 40, 54, 70], [200, 19, 29, 41, 56, 72]],
  },
  row: {
    label: 'Dumbbell row',
    unit: 'lb',
    male: [[120, 22, 39, 63, 92, 124], [130, 26, 44, 69, 99, 133], [140, 29, 49, 75, 106, 141], [150, 33, 54, 81, 113, 149], [160, 37, 58, 86, 119, 156], [170, 40, 63, 91, 126, 164], [180, 44, 67, 97, 132, 171], [190, 47, 71, 102, 138, 177], [200, 51, 75, 107, 144, 184], [210, 54, 79, 112, 149, 190], [220, 57, 83, 116, 155, 196], [230, 60, 87, 121, 160, 202], [240, 64, 91, 125, 165, 208], [250, 67, 95, 130, 170, 214], [260, 70, 98, 134, 175, 219]],
    female: [[100, 15, 26, 40, 57, 76], [110, 17, 27, 42, 59, 79], [120, 18, 29, 44, 62, 82], [130, 19, 31, 46, 64, 84], [140, 20, 32, 48, 66, 86], [150, 21, 33, 49, 68, 89], [160, 22, 35, 51, 70, 91], [170, 23, 36, 52, 72, 93], [180, 24, 37, 54, 73, 95], [190, 25, 38, 55, 75, 97], [200, 26, 39, 56, 76, 98]],
  },
  gobletSquat: {
    label: 'Goblet squat',
    unit: 'lb',
    male: [[160, 31, 54, 85, 124, 168], [170, 33, 57, 89, 128, 172], [180, 35, 59, 92, 132, 177], [190, 37, 62, 95, 136, 181], [200, 39, 64, 98, 139, 185], [210, 40, 67, 101, 143, 189], [220, 42, 69, 104, 146, 193], [230, 44, 71, 107, 150, 197], [240, 46, 73, 109, 153, 201]],
    female: [[120, 22, 36, 56, 80, 107], [130, 22, 37, 57, 81, 108], [140, 23, 38, 58, 83, 110], [150, 24, 39, 59, 84, 111], [160, 24, 40, 60, 85, 112], [170, 25, 40, 61, 86, 114], [180, 25, 41, 62, 87, 115], [190, 26, 42, 63, 88, 116], [200, 26, 42, 64, 89, 117]],
  },
  rdl: {
    label: 'Dumbbell Romanian deadlift',
    unit: 'lb',
    male: [[160, 36, 59, 88, 124, 163], [170, 39, 63, 93, 130, 170], [180, 43, 67, 98, 136, 177], [190, 46, 71, 103, 141, 183], [200, 49, 75, 108, 147, 189], [210, 52, 78, 112, 152, 195], [220, 55, 82, 116, 157, 201], [230, 58, 86, 121, 162, 206], [240, 61, 89, 125, 166, 212]],
    female: [[120, 21, 37, 57, 82, 111], [130, 22, 38, 59, 85, 113], [140, 24, 40, 61, 87, 116], [150, 25, 41, 63, 89, 118], [160, 26, 42, 64, 91, 121], [170, 27, 44, 66, 93, 123], [180, 28, 45, 68, 95, 125], [190, 29, 46, 69, 97, 127], [200, 30, 47, 70, 98, 129]],
  },
  lateralRaise: {
    label: 'Dumbbell lateral raise',
    unit: 'lb',
    male: [[160, 10, 20, 34, 51, 72], [170, 11, 21, 35, 53, 74], [180, 12, 22, 37, 55, 76], [190, 13, 23, 38, 57, 79], [200, 13, 25, 40, 59, 81], [210, 14, 26, 41, 61, 83], [220, 15, 27, 43, 63, 85], [230, 16, 28, 44, 64, 87], [240, 17, 29, 46, 66, 89]],
    female: [[120, 6, 12, 19, 27, 37], [130, 7, 12, 19, 28, 38], [140, 7, 13, 20, 29, 39], [150, 7, 13, 20, 30, 40], [160, 8, 13, 21, 30, 41], [170, 8, 14, 22, 31, 41], [180, 8, 14, 22, 31, 42], [190, 9, 15, 23, 32, 43], [200, 9, 15, 23, 33, 43]],
  },
  pullUps: {
    label: 'Pull-ups',
    unit: 'reps',
    // "< 1" in the source is stored as 0.
    male: [[160, 0, 7, 14, 22, 30], [170, 0, 7, 13, 21, 29], [180, 1, 7, 13, 21, 28], [190, 1, 7, 13, 20, 28], [200, 1, 7, 12, 19, 27], [210, 1, 7, 12, 19, 26], [220, 0, 6, 11, 18, 25], [230, 0, 6, 11, 18, 24], [240, 0, 6, 11, 17, 24]],
    female: [[120, 0, 0, 6, 13, 21], [130, 0, 0, 6, 12, 20], [140, 0, 0, 6, 12, 19], [150, 0, 0, 6, 11, 18], [160, 0, 0, 5, 11, 17], [170, 0, 0, 5, 10, 16], [180, 0, 0, 5, 10, 16], [190, 0, 0, 4, 9, 15], [200, 0, 0, 4, 9, 14]],
  },
}

// Minimum push-ups for each rating: Excellent, Good, Above average, Average, Below average.
type PushUpRow = readonly [maxAge: number, excellent: number, good: number, aboveAverage: number, average: number, belowAverage: number]
const PUSH_UPS: Record<Sex, readonly PushUpRow[]> = {
  male: [[19, 56, 47, 35, 31, 25], [29, 47, 39, 30, 24, 20], [39, 41, 34, 25, 20, 15], [49, 34, 28, 21, 16, 12], [59, 31, 25, 18, 13, 9], [200, 30, 24, 17, 11, 6]],
  female: [[19, 35, 27, 21, 18, 12], [29, 36, 30, 23, 17, 12], [39, 37, 30, 22, 14, 10], [49, 31, 24, 17, 11, 8], [59, 25, 21, 14, 10, 7], [200, 23, 19, 12, 5, 3]],
}
const PUSH_UP_RATINGS = ['Excellent', 'Good', 'Above average', 'Average', 'Below average'] as const

/** Which norm an exercise in the library maps to, by name. Floor press is compared with bench; hammer curls with curls. */
export function standardForExercise(name: string): StandardId | 'pushUps' | null {
  const n = name.toLowerCase().replace(/[-_]/g, ' ')
  if (/push ?ups?\b/.test(n)) return 'pushUps'
  if (/pull ?ups?\b|chin ?ups?\b/.test(n)) return 'pullUps'
  if (/floor press|bench press|chest press/.test(n)) return 'bench'
  if (/shoulder press|overhead press|military press/.test(n)) return 'shoulderPress'
  if (/lateral raise/.test(n)) return 'lateralRaise'
  if (/goblet squat/.test(n)) return 'gobletSquat'
  if (/romanian deadlift|\brdl\b/.test(n)) return 'rdl'
  if (/\bcurl/.test(n)) return 'curl'
  if (/\brow\b/.test(n) && !/upright/.test(n)) return 'row'
  return null
}

/** Estimated one-rep max (Epley). Above ~12 reps it's a rough estimate. */
export function estimatedOneRepMax(weight: number, reps: number) {
  if (!(weight > 0) || !(reps > 0)) return undefined
  return reps === 1 ? weight : weight * (1 + reps / 30)
}

/** 1.0 up to age 40, then about 1% lower per year, floored at 0.6. */
export function ageFactor(age?: number) {
  if (age === undefined || age <= 40) return 1
  return Math.max(0.6, 1 - 0.01 * (age - 40))
}

function interpolateRow(rows: readonly Row[], bodyweight: number): number[] {
  if (bodyweight <= rows[0][0]) return rows[0].slice(1)
  const last = rows[rows.length - 1]
  if (bodyweight >= last[0]) return last.slice(1)
  const upperIndex = rows.findIndex((row) => row[0] >= bodyweight)
  const lower = rows[upperIndex - 1]
  const upper = rows[upperIndex]
  const t = (bodyweight - lower[0]) / (upper[0] - lower[0])
  return lower.slice(1).map((value, index) => value + (upper[index + 1] - value) * t)
}

/** Level thresholds (beginner..elite) for a lifter of this sex, bodyweight and age. */
export function thresholdsFor(id: StandardId, sex: Sex, bodyweight: number, age?: number) {
  const factor = ageFactor(age)
  return interpolateRow(STANDARDS[id][sex], bodyweight).map((value) => value * factor)
}

export type NormResult = {
  percentile: number
  level: string
  /** -1 below Beginner, 0 Beginner … 4 Elite. */
  levelIndex: number
  next?: { level: string; value: number }
}

// Strength Level describes its levels by training age: Beginner ≈ practiced a month, Novice ≈ six months of
// regular training, Intermediate ≈ two years, Advanced ≈ five years. Use that to set what's expected.
export function expectedLevelIndex(trainingMonths: number | undefined) {
  if (trainingMonths === undefined) return 1
  if (trainingMonths < 6) return 0
  if (trainingMonths < 24) return 1
  if (trainingMonths < 60) return 2
  return 3
}

export const LEVEL_MEANING = ['about a month of practice', 'about six months of regular training', 'about two years of regular training', 'five-plus years of progress', 'competitive strength athletes'] as const

/** Where a value sits against the thresholds, as an approximate percentile of logged lifters. */
export function compareToNorm(id: StandardId, value: number, sex: Sex, bodyweight: number, age?: number): NormResult {
  const thresholds = thresholdsFor(id, sex, bodyweight, age)
  let percentile: number
  if (value < thresholds[0]) {
    percentile = thresholds[0] > 0 ? (value / thresholds[0]) * LEVEL_PERCENTILES[0] : LEVEL_PERCENTILES[0]
  } else if (value >= thresholds[4]) {
    percentile = Math.min(99, 95 + ((value - thresholds[4]) / Math.max(1, thresholds[4] * 0.25)) * 4)
  } else {
    const index = thresholds.findIndex((threshold, i) => value >= threshold && value < thresholds[i + 1])
    const span = thresholds[index + 1] - thresholds[index]
    const t = span > 0 ? (value - thresholds[index]) / span : 0
    percentile = LEVEL_PERCENTILES[index] + (LEVEL_PERCENTILES[index + 1] - LEVEL_PERCENTILES[index]) * t
  }
  const levelIndex = thresholds.reduce((found, threshold, index) => value >= threshold ? index : found, -1)
  const nextIndex = levelIndex + 1
  return {
    percentile: Math.round(Math.max(0, percentile)),
    level: levelIndex < 0 ? 'Below beginner' : LEVEL_NAMES[levelIndex],
    levelIndex,
    next: nextIndex < LEVEL_NAMES.length ? { level: LEVEL_NAMES[nextIndex], value: thresholds[nextIndex] } : undefined,
  }
}

export function pushUpRating(reps: number, sex: Sex, age: number) {
  const row = PUSH_UPS[sex].find((entry) => age <= entry[0]) ?? PUSH_UPS[sex][PUSH_UPS[sex].length - 1]
  const index = row.slice(1).findIndex((minimum) => reps >= minimum)
  const rating = index < 0 ? 'Poor' : PUSH_UP_RATINGS[index]
  const nextIndex = index < 0 ? PUSH_UP_RATINGS.length - 1 : index - 1
  return {
    rating,
    belowNorm: index < 0 || rating === 'Below average',
    averageAt: row[4],
    next: nextIndex >= 0 ? { rating: PUSH_UP_RATINGS[nextIndex], reps: row[nextIndex + 1] } : undefined,
  }
}

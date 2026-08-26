type SyncEnv = { DB: D1Database }

type PairRequest = { code?: unknown; name?: unknown }
type NutritionInput = {
  caloriesKcal?: unknown
  proteinG?: unknown
  carbsG?: unknown
  fatG?: unknown
  sourcePackage?: unknown
}
type WeightInput = {
  pounds?: unknown
  measuredAt?: unknown
  recordId?: unknown
  sourcePackage?: unknown
}
type DayInput = { date?: unknown; nutrition?: unknown; steps?: unknown; weight?: unknown }
type SyncRequest = { timezone?: unknown; days?: unknown; trigger?: unknown; appVersion?: unknown; backgroundPermission?: unknown }
type StatusRequest = { status?: unknown; error?: unknown; trigger?: unknown; appVersion?: unknown; backgroundPermission?: unknown }

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const encoder = new TextEncoder()
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(data), { ...init, headers })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asOptionalNumber(value: unknown, minimum = 0, maximum = 100000): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new HttpError(400, 'A synced number is invalid.')
  }
  return value
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function normalizedCode(value: unknown) {
  if (typeof value !== 'string') throw new HttpError(400, 'Pairing code is required.')
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code.length !== 12) throw new HttpError(400, 'Pairing code is invalid or expired.')
  return code
}

async function pair(request: Request, env: SyncEnv) {
  const body = await request.json<PairRequest>()
  const codeHash = await sha256(normalizedCode(body.code))
  const pairing = await env.DB.prepare(`
    SELECT id, user_id FROM mobile_pairing_codes
    WHERE code_hash = ? AND used_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(codeHash).first<{ id: string; user_id: string }>()
  if (!pairing) throw new HttpError(400, 'Pairing code is invalid or expired.')

  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, 80)
    : 'Android phone'
  const token = randomToken()
  const deviceId = crypto.randomUUID()
  const now = new Date().toISOString()
  const claimed = await env.DB.prepare(`
    UPDATE mobile_pairing_codes SET used_at = ? WHERE id = ? AND used_at IS NULL
  `).bind(now, pairing.id).run()
  if (!claimed.success || claimed.meta.changes !== 1) {
    throw new HttpError(409, 'Pairing code was already used. Create a new code and try again.')
  }
  await env.DB.prepare(`
    INSERT INTO mobile_devices (id, user_id, name, token_hash, last_used_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(deviceId, pairing.user_id, name, await sha256(token), now, now, now).run()
  return json({ token, deviceId })
}

async function authenticateDevice(request: Request, env: SyncEnv) {
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match) throw new HttpError(401, 'Phone pairing is required.')
  const device = await env.DB.prepare(`
    SELECT id, user_id FROM mobile_devices WHERE token_hash = ? AND revoked_at IS NULL
  `).bind(await sha256(match[1])).first<{ id: string; user_id: string }>()
  if (!device) throw new HttpError(401, 'Phone pairing is no longer valid.')
  return device
}

function manualFields(provenance: string | null) {
  if (!provenance) return new Set<string>()
  try {
    const parsed = JSON.parse(provenance) as { entry?: unknown; manual_fields?: unknown }
    if (Array.isArray(parsed.manual_fields)) return new Set(parsed.manual_fields.filter((field): field is string => typeof field === 'string'))
    if (parsed.entry === 'web') return new Set(['calories_kcal', 'protein_g', 'carbs_g', 'fat_g', 'steps'])
  } catch {
    // An unreadable legacy value should not prevent a new Health Connect sync.
  }
  return new Set<string>()
}

function sourceName(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : fallback
}

function syncTrigger(value: unknown) {
  return value === 'background' || value === 'web' || value === 'app_open' ? value : 'manual'
}

function appVersion(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : null
}

function backgroundPermission(value: unknown) {
  return typeof value === 'boolean' ? (value ? 1 : 0) : null
}

async function reportStatus(request: Request, env: SyncEnv) {
  const device = await authenticateDevice(request, env)
  const body = await request.json<StatusRequest>()
  const allowedStatuses = new Set(['scheduled', 'running', 'missing_permission', 'failed'])
  if (typeof body.status !== 'string' || !allowedStatuses.has(body.status)) {
    throw new HttpError(400, 'Sync status is invalid.')
  }
  const error = typeof body.error === 'string' && body.error.trim() ? body.error.trim().slice(0, 300) : null
  const now = new Date().toISOString()
  await env.DB.prepare(`
    UPDATE mobile_devices SET
      app_version = COALESCE(?, app_version),
      last_sync_attempt_at = ?,
      last_sync_status = ?,
      last_sync_error = ?,
      background_permission = COALESCE(?, background_permission),
      last_sync_trigger = ?,
      updated_at = ?
    WHERE id = ?
  `).bind(appVersion(body.appVersion), now, body.status, error, backgroundPermission(body.backgroundPermission), syncTrigger(body.trigger), now, device.id).run()
  return json({ ok: true, recordedAt: now })
}

async function sync(request: Request, env: SyncEnv) {
  const device = await authenticateDevice(request, env)
  const body = await request.json<SyncRequest>()
  if (!Array.isArray(body.days) || body.days.length === 0 || body.days.length > 15) {
    throw new HttpError(400, 'Sync must contain between 1 and 15 days.')
  }
  const timezone = typeof body.timezone === 'string' && body.timezone.trim()
    ? body.timezone.trim().slice(0, 80)
    : 'America/Chicago'
  const now = new Date().toISOString()
  const statements: D1PreparedStatement[] = []

  for (const rawDay of body.days as DayInput[]) {
    if (!isRecord(rawDay) || typeof rawDay.date !== 'string' || !DATE_PATTERN.test(rawDay.date)) {
      throw new HttpError(400, 'A synced date is invalid.')
    }
    const date = rawDay.date
    const nutrition = isRecord(rawDay.nutrition) ? rawDay.nutrition as NutritionInput : null
    const weight = isRecord(rawDay.weight) ? rawDay.weight as WeightInput : null
    const steps = asOptionalNumber(rawDay.steps, 0, 250000)
    if (steps !== null && !Number.isInteger(steps)) throw new HttpError(400, 'Synced steps must be a whole number.')
    const existing = await env.DB.prepare(`
      SELECT calories_kcal, protein_g, carbs_g, fat_g, steps, nutrition_source, steps_source, provenance
      FROM daily_health WHERE user_id = ? AND date = ?
    `).bind(device.user_id, date).first<Record<string, unknown>>()
    const preserved = manualFields(typeof existing?.provenance === 'string' ? existing.provenance : null)
    const incoming = {
      calories_kcal: nutrition ? asOptionalNumber(nutrition.caloriesKcal, 0, 20000) : null,
      protein_g: nutrition ? asOptionalNumber(nutrition.proteinG, 0, 2000) : null,
      carbs_g: nutrition ? asOptionalNumber(nutrition.carbsG, 0, 4000) : null,
      fat_g: nutrition ? asOptionalNumber(nutrition.fatG, 0, 2000) : null,
      steps,
    }
    const value = (field: keyof typeof incoming) => preserved.has(field)
      ? (existing?.[field] as number | null ?? null)
      : incoming[field]
    const nutritionSource = preserved.has('calories_kcal') || preserved.has('protein_g') || preserved.has('carbs_g') || preserved.has('fat_g')
      ? `${existing?.nutrition_source ?? 'manual'}`
      : sourceName(nutrition?.sourcePackage, 'health_connect')
    const stepsSource = preserved.has('steps')
      ? `${existing?.steps_source ?? 'manual'}`
      : sourceName(undefined, 'health_connect')
    const provenance = JSON.stringify({
      entry: 'health_connect',
      device_id: device.id,
      manual_fields: [...preserved],
      nutrition_package: nutrition ? sourceName(nutrition.sourcePackage, 'health_connect') : null,
    })
    statements.push(env.DB.prepare(`
      INSERT INTO daily_health (
        id, user_id, date, timezone, calories_kcal, protein_g, carbs_g, fat_g, steps,
        nutrition_source, steps_source, synced_at, provenance, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET
        timezone = excluded.timezone,
        calories_kcal = excluded.calories_kcal,
        protein_g = excluded.protein_g,
        carbs_g = excluded.carbs_g,
        fat_g = excluded.fat_g,
        steps = excluded.steps,
        nutrition_source = excluded.nutrition_source,
        steps_source = excluded.steps_source,
        synced_at = excluded.synced_at,
        provenance = excluded.provenance,
        updated_at = excluded.updated_at
    `).bind(
      `daily-health-${device.user_id}-${date}`, device.user_id, date, timezone,
      value('calories_kcal'), value('protein_g'), value('carbs_g'), value('fat_g'), value('steps'),
      nutritionSource, stepsSource, now, provenance, now, now,
    ))

    if (weight) {
      const pounds = asOptionalNumber(weight.pounds, 40, 1000)
      if (pounds === null || typeof weight.measuredAt !== 'string' || !Number.isFinite(Date.parse(weight.measuredAt))) {
        throw new HttpError(400, 'A synced weight is invalid.')
      }
      const recordId = typeof weight.recordId === 'string' && weight.recordId.trim()
        ? weight.recordId.trim().slice(0, 180)
        : `${date}-${weight.measuredAt}`
      statements.push(env.DB.prepare(`
        INSERT INTO body_weight_entries (
          id, user_id, measured_at, local_date, weight_lb, source, source_record_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, source, source_record_id) WHERE source_record_id IS NOT NULL DO UPDATE SET
          measured_at = excluded.measured_at,
          local_date = excluded.local_date,
          weight_lb = excluded.weight_lb,
          updated_at = excluded.updated_at
      `).bind(
        crypto.randomUUID(), device.user_id, weight.measuredAt, date, pounds,
        sourceName(weight.sourcePackage, 'health_connect'), recordId, now, now,
      ))
    }
  }
  statements.push(env.DB.prepare(`
    UPDATE mobile_devices SET
      last_used_at = ?,
      last_sync_attempt_at = ?,
      last_sync_success_at = ?,
      last_sync_status = 'success',
      last_sync_error = NULL,
      app_version = COALESCE(?, app_version),
      background_permission = COALESCE(?, background_permission),
      last_sync_trigger = ?,
      updated_at = ?
    WHERE id = ?
  `).bind(
    now, now, now, appVersion(body.appVersion), backgroundPermission(body.backgroundPermission),
    syncTrigger(body.trigger), now, device.id,
  ))
  const results = await env.DB.batch(statements)
  if (!results.every((entry) => entry.success)) throw new HttpError(500, 'Health Connect data could not be saved.')
  return json({ ok: true, daysSaved: body.days.length, syncedAt: now })
}

export default {
  async fetch(request: Request, env: SyncEnv): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true })
      if (request.method === 'POST' && url.pathname === '/pair') return await pair(request, env)
      if (request.method === 'POST' && url.pathname === '/sync') return await sync(request, env)
      if (request.method === 'POST' && url.pathname === '/status') return await reportStatus(request, env)
      throw new HttpError(404, 'Not found.')
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError ? error.message : 'Internal server error.'
      console.error(JSON.stringify({ message: 'mobile sync request failed', status, error: error instanceof Error ? error.message : String(error) }))
      return json({ error: message }, { status })
    }
  },
} satisfies ExportedHandler<SyncEnv>

import { createRemoteJWKSet, jwtVerify } from 'jose'

type AuthenticatedUser = {
  id: string
  email: string
  displayName: string
}

type ColumnKind = 'text' | 'json' | 'boolean' | 'integer' | 'number'
type TableDefinition = {
  columns: Record<string, ColumnKind>
  writable: readonly string[]
  ownerColumn: 'id' | 'user_id'
}

type Filter = {
  column: string
  operator: 'eq' | 'in'
  value: unknown
}

type DatabaseRequest = {
  table?: unknown
  action?: unknown
  columns?: unknown
  filters?: unknown
  order?: unknown
  data?: unknown
}

type TrackableKind = 'exercise' | 'habit'
type TargetType = 'count' | 'sets' | 'duration' | 'distance' | 'for-time' | 'weighted'
type AnalyzeRequest = {
  fileName?: string
  sheets?: Array<{ name?: string; rows?: string[][] }>
  catalog?: Array<{ name?: string; kind?: TrackableKind; category?: string; defaultType?: TargetType }>
}

type DailyReviewRequest = { date?: unknown }
type CoachMessageRequest = { date?: unknown; message?: unknown }
type CoachRecommendationRequest = {
  date?: unknown
  recommendationIndex?: unknown
  action?: unknown
  scheduleItemId?: unknown
  expectedType?: unknown
  expectedTarget?: unknown
}
type OpenAIResponse = {
  id?: string
  output_text?: string
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const TABLES = {
  profiles: {
    ownerColumn: 'id',
    columns: { id: 'text', email: 'text', display_name: 'text', created_at: 'text', updated_at: 'text' },
    writable: ['id', 'email', 'display_name'],
  },
  exercises: {
    ownerColumn: 'user_id',
    columns: {
      id: 'text', user_id: 'text', kind: 'text', name: 'text', category: 'text', equipment: 'text', notes: 'text',
      default_type: 'text', allowed: 'json', target: 'json', refs: 'json', progress_metric: 'text', created_at: 'text', updated_at: 'text',
    },
    writable: ['id', 'user_id', 'kind', 'name', 'category', 'equipment', 'notes', 'default_type', 'allowed', 'target', 'refs', 'progress_metric'],
  },
  plans: {
    ownerColumn: 'user_id',
    columns: { id: 'text', user_id: 'text', name: 'text', focus: 'text', created_at: 'text', updated_at: 'text' },
    writable: ['id', 'user_id', 'name', 'focus'],
  },
  plan_days: {
    ownerColumn: 'user_id',
    columns: { id: 'text', user_id: 'text', plan_id: 'text', day_number: 'integer', notes: 'text', created_at: 'text', updated_at: 'text' },
    writable: ['id', 'user_id', 'plan_id', 'day_number', 'notes'],
  },
  plan_items: {
    ownerColumn: 'user_id',
    columns: { id: 'text', user_id: 'text', plan_day_id: 'text', exercise_id: 'text', type: 'text', target: 'json', ref: 'text', created_at: 'text', updated_at: 'text' },
    writable: ['id', 'user_id', 'plan_day_id', 'exercise_id', 'type', 'target', 'ref'],
  },
  runs: {
    ownerColumn: 'user_id',
    columns: { id: 'text', user_id: 'text', plan_id: 'text', start_date: 'text', name: 'text', created_at: 'text', updated_at: 'text' },
    writable: ['id', 'user_id', 'plan_id', 'start_date', 'name'],
  },
  schedule_days: {
    ownerColumn: 'user_id',
    columns: {
      id: 'text', user_id: 'text', date: 'text', notes: 'text', skipped: 'boolean', run_id: 'text', day_no: 'integer', created_at: 'text', updated_at: 'text',
    },
    writable: ['id', 'user_id', 'date', 'notes', 'skipped', 'run_id', 'day_no'],
  },
  schedule_items: {
    ownerColumn: 'user_id',
    columns: {
      id: 'text', user_id: 'text', schedule_day_id: 'text', exercise_id: 'text', type: 'text', target: 'json', ref: 'text', done: 'boolean', result: 'json', created_at: 'text', updated_at: 'text',
    },
    writable: ['id', 'user_id', 'schedule_day_id', 'exercise_id', 'type', 'target', 'ref', 'done', 'result'],
  },
  logs: {
    ownerColumn: 'user_id',
    columns: {
      id: 'text', user_id: 'text', source_item_id: 'text', exercise_id: 'text', date: 'text', type: 'text', target: 'json', result: 'json', created_at: 'text', updated_at: 'text',
    },
    writable: ['id', 'user_id', 'source_item_id', 'exercise_id', 'date', 'type', 'target', 'result'],
  },
  daily_health: {
    ownerColumn: 'user_id',
    columns: {
      id: 'text', user_id: 'text', date: 'text', timezone: 'text', calories_kcal: 'number', protein_g: 'number', carbs_g: 'number', fat_g: 'number',
      steps: 'integer', nutrition_source: 'text', steps_source: 'text', synced_at: 'text', provenance: 'json', created_at: 'text', updated_at: 'text',
    },
    writable: ['id', 'user_id', 'date', 'timezone', 'calories_kcal', 'protein_g', 'carbs_g', 'fat_g', 'steps', 'nutrition_source', 'steps_source', 'synced_at', 'provenance'],
  },
  body_weight_entries: {
    ownerColumn: 'user_id',
    columns: {
      id: 'text', user_id: 'text', measured_at: 'text', local_date: 'text', weight_lb: 'number', source: 'text', source_record_id: 'text', created_at: 'text', updated_at: 'text',
    },
    writable: ['id', 'user_id', 'measured_at', 'local_date', 'weight_lb', 'source', 'source_record_id'],
  },
  coaching_profiles: {
    ownerColumn: 'user_id',
    columns: {
      id: 'text', user_id: 'text', goal_name: 'text', start_weight_lb: 'number', height_inches: 'number', target_weight_lb: 'number', desired_loss_min_lb: 'number',
      desired_loss_max_lb: 'number', targets: 'json', equipment: 'text', calorie_context: 'text', coaching_style: 'json', created_at: 'text', updated_at: 'text',
    },
    writable: ['id', 'user_id', 'goal_name', 'start_weight_lb', 'height_inches', 'target_weight_lb', 'desired_loss_min_lb', 'desired_loss_max_lb', 'targets', 'equipment', 'calorie_context', 'coaching_style'],
  },
  coaching_notes: {
    ownerColumn: 'user_id',
    columns: {
      id: 'text', user_id: 'text', category: 'text', exercise_id: 'text', title: 'text', body: 'text', status: 'text', priority: 'integer', effective_from: 'text', created_at: 'text', updated_at: 'text',
    },
    writable: ['id', 'user_id', 'category', 'exercise_id', 'title', 'body', 'status', 'priority', 'effective_from'],
  },
} as const satisfies Record<string, TableDefinition>

type TableName = keyof typeof TABLES

function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(data), { ...init, headers })
}

function withCors(response: Response, request: Request, env: Env) {
  const origin = request.headers.get('Origin')
  if (origin !== env.FRONTEND_ORIGIN) return response
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Credentials', 'true')
  headers.append('Vary', 'Origin')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, 'A valid date is required.')
  }
  return value
}

function parseStoredJson(value: unknown) {
  if (typeof value !== 'string') return value ?? null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function responseText(response: OpenAIResponse) {
  if (response.output_text?.trim()) return response.output_text.trim()
  return response.output?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text?.trim())
    .filter(Boolean)
    .join('\n') ?? ''
}

function isTableName(value: unknown): value is TableName {
  return typeof value === 'string' && Object.hasOwn(TABLES, value)
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function randomPairingCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function matchesAllowedEmail(email: string, allowedEmail: string) {
  const encoder = new TextEncoder()
  const [emailHash, allowedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(normalizeEmail(email))),
    crypto.subtle.digest('SHA-256', encoder.encode(normalizeEmail(allowedEmail))),
  ])
  const emailBytes = new Uint8Array(emailHash)
  const allowedBytes = new Uint8Array(allowedHash)
  let difference = 0
  for (let index = 0; index < emailBytes.length; index += 1) {
    difference |= emailBytes[index] ^ allowedBytes[index]
  }
  return difference === 0
}

async function authenticate(request: Request, env: Env): Promise<AuthenticatedUser> {
  let email: string

  if ((env.ENVIRONMENT as string) === 'development') {
    email = normalizeEmail(request.headers.get('X-Local-User-Email') || 'developer@example.com')
  } else {
    const token = request.headers.get('Cf-Access-Jwt-Assertion')
    if (!token) throw new HttpError(401, 'Authentication required.')

    const teamDomain = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '')
    const jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`))
    const { payload } = await jwtVerify(token, jwks, {
      audience: env.ACCESS_AUD,
      issuer: `https://${teamDomain}`,
    })
    if (typeof payload.email !== 'string') throw new HttpError(401, 'Authenticated email is missing.')
    email = normalizeEmail(payload.email)
  }

  let profile = await env.DB.prepare('SELECT id, email, display_name FROM profiles WHERE email = ? COLLATE NOCASE')
    .bind(email)
    .first<{ id: string; email: string; display_name: string }>()

  const canCreateProfile = (env.ENVIRONMENT as string) === 'development'
    || await matchesAllowedEmail(email, env.ALLOWED_EMAIL)
  if (!profile && canCreateProfile) {
    const id = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO profiles (id, email, display_name) VALUES (?, ?, ?)')
      .bind(id, email, (env.ENVIRONMENT as string) === 'development' ? 'Local developer' : email)
      .run()
    profile = { id, email, display_name: (env.ENVIRONMENT as string) === 'development' ? 'Local developer' : email }
  }

  if (!profile) throw new HttpError(403, 'This Google account is not allowed to use the app.')
  return { id: profile.id, email: profile.email, displayName: profile.display_name || profile.email }
}

function parseFilters(value: unknown, table: TableDefinition): Filter[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 20) throw new HttpError(400, 'Invalid query filters.')
  return value.map((filter) => {
    if (!isRecord(filter) || typeof filter.column !== 'string' || !(filter.column in table.columns)) {
      throw new HttpError(400, 'Invalid filter column.')
    }
    if (filter.operator !== 'eq' && filter.operator !== 'in') throw new HttpError(400, 'Invalid filter operator.')
    if (filter.operator === 'in' && (!Array.isArray(filter.value) || filter.value.length > 1000)) {
      throw new HttpError(400, 'Invalid filter values.')
    }
    return { column: filter.column, operator: filter.operator, value: filter.value }
  })
}

function bindValue(kind: ColumnKind, value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (kind === 'json') return JSON.stringify(value)
  if (kind === 'boolean') return value ? 1 : 0
  if (kind === 'integer' || kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, 'Invalid numeric value.')
    return value
  }
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid text value.')
  return value
}

function decodeRows(rows: Record<string, unknown>[], table: TableDefinition) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([column, value]) => {
    const kind = table.columns[column]
    if (kind === 'json' && typeof value === 'string') {
      try {
        return [column, JSON.parse(value)]
      } catch {
        return [column, null]
      }
    }
    if (kind === 'boolean') return [column, value === 1]
    return [column, value]
  })))
}

function ownerCondition(table: TableDefinition, user: AuthenticatedUser) {
  return { sql: `${table.ownerColumn} = ?`, value: user.id }
}

function filterSql(filters: Filter[], table: TableDefinition) {
  const clauses: string[] = []
  const values: Array<string | number | null> = []
  for (const filter of filters) {
    const kind = table.columns[filter.column]
    if (filter.operator === 'eq') {
      clauses.push(`${filter.column} = ?`)
      values.push(bindValue(kind, filter.value))
      continue
    }
    const input = filter.value as unknown[]
    if (input.length === 0) {
      clauses.push('1 = 0')
      continue
    }
    clauses.push(`${filter.column} IN (${input.map(() => '?').join(', ')})`)
    values.push(...input.map((entry) => bindValue(kind, entry)))
  }
  return { clauses, values }
}

async function selectRows(body: DatabaseRequest, tableName: TableName, user: AuthenticatedUser, env: Env) {
  const table: TableDefinition = TABLES[tableName]
  if (!Array.isArray(body.columns) || body.columns.length === 0 || body.columns.length > 30) {
    throw new HttpError(400, 'Select columns are required.')
  }
  const columns = body.columns.map((column) => {
    if (typeof column !== 'string' || !(column in table.columns)) throw new HttpError(400, 'Invalid select column.')
    return column
  })
  const filters = parseFilters(body.filters, table)
  const owner = ownerCondition(table, user)
  const parsed = filterSql(filters, table)
  const clauses = [owner.sql, ...parsed.clauses]
  const values = [owner.value, ...parsed.values]
  let order = ''
  if (body.order !== undefined) {
    if (!isRecord(body.order) || typeof body.order.column !== 'string' || !(body.order.column in table.columns)) {
      throw new HttpError(400, 'Invalid sort column.')
    }
    order = ` ORDER BY ${body.order.column} ${body.order.ascending === false ? 'DESC' : 'ASC'}`
  }
  const result = await env.DB.prepare(`SELECT ${columns.join(', ')} FROM ${tableName} WHERE ${clauses.join(' AND ')}${order}`)
    .bind(...values)
    .all<Record<string, unknown>>()
  return decodeRows(result.results, table)
}

async function deleteRows(body: DatabaseRequest, tableName: TableName, user: AuthenticatedUser, env: Env) {
  const table: TableDefinition = TABLES[tableName]
  const filters = parseFilters(body.filters, table)
  if (filters.length === 0) throw new HttpError(400, 'Delete filters are required.')
  const owner = ownerCondition(table, user)
  const parsed = filterSql(filters, table)
  await env.DB.prepare(`DELETE FROM ${tableName} WHERE ${[owner.sql, ...parsed.clauses].join(' AND ')}`)
    .bind(owner.value, ...parsed.values)
    .run()
  return []
}

async function upsertRows(body: DatabaseRequest, tableName: TableName, user: AuthenticatedUser, env: Env) {
  const table: TableDefinition = TABLES[tableName]
  const rows = Array.isArray(body.data) ? body.data : [body.data]
  if (rows.length === 0 || rows.length > 1000 || rows.some((row) => !isRecord(row))) {
    throw new HttpError(400, 'Invalid upsert data.')
  }

  const statements = rows.map((input) => {
    const row = input as Record<string, unknown>
    const sanitized: Record<string, string | number | null> = {}
    for (const column of table.writable) {
      if (column in row) sanitized[column] = bindValue(table.columns[column], row[column])
    }
    if (table.ownerColumn === 'user_id') sanitized.user_id = user.id
    else {
      sanitized.id = user.id
      sanitized.email = user.email
    }
    if (typeof sanitized.id !== 'string' || !sanitized.id) throw new HttpError(400, 'Every row requires an id.')

    const columns = Object.keys(sanitized)
    const updateColumns = columns.filter((column) => column !== 'id')
    const ownershipCheck = table.ownerColumn === 'user_id'
      ? ` WHERE ${tableName}.user_id = excluded.user_id`
      : ` WHERE ${tableName}.id = excluded.id`
    const updateSql = [...updateColumns.map((column) => `${column} = excluded.${column}`), "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"]
    const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${updateSql.join(', ')}${ownershipCheck}`
    return env.DB.prepare(sql).bind(...columns.map((column) => sanitized[column]))
  })

  for (let index = 0; index < statements.length; index += 100) {
    await env.DB.batch(statements.slice(index, index + 100))
  }
  return []
}

async function handleDatabase(request: Request, user: AuthenticatedUser, env: Env) {
  const body = await request.json<DatabaseRequest>()
  if (!isTableName(body.table)) throw new HttpError(400, 'Invalid database table.')
  if (body.action === 'select') return json({ data: await selectRows(body, body.table, user, env) })
  if (body.action === 'delete') return json({ data: await deleteRows(body, body.table, user, env) })
  if (body.action === 'upsert') return json({ data: await upsertRows(body, body.table, user, env) })
  throw new HttpError(400, 'Invalid database action.')
}

const schemaExample = {
  summary: 'Short summary of what the spreadsheet appears to contain.',
  warnings: ['Any ambiguities or issues worth showing to the user.'],
  items: [{
    name: 'Push-Ups', kind: 'exercise', category: 'Bodyweight', notes: 'Optional note about this trackable.',
    defaultType: 'count', progressMetric: 'count', usedOnDays: ['Day 1', 'Day 4'],
  }],
  days: [{
    label: 'Day 1', notes: 'Optional note for the day.',
    items: [{ name: 'Push-Ups', type: 'count', target: { count: 50 }, ref: 'last-result', note: '' }],
  }],
}

async function analyzePlanSheet(request: Request, env: Env) {
  const body = await request.json<AnalyzeRequest>()
  const sheets = (body.sheets ?? [])
    .slice(0, 20)
    .map((sheet) => ({
      name: `${sheet.name ?? 'Sheet'}`.trim(),
      rows: Array.isArray(sheet.rows)
        ? sheet.rows.slice(0, 180).map((row) => row.slice(0, 20).map((cell) => `${cell ?? ''}`.trim()))
        : [],
    }))
    .filter((sheet) => sheet.rows.length > 0)
  if (sheets.length === 0) throw new HttpError(400, 'No readable sheets were provided.')

  const catalog = (body.catalog ?? []).slice(0, 2000).filter((item) => item.name).map((item) => ({
    name: item.name?.trim(),
    kind: item.kind === 'habit' ? 'habit' : 'exercise',
    category: item.category?.trim() || '',
    defaultType: item.defaultType || 'count',
  }))
  const systemPrompt = [
    'You analyze workout and discipline spreadsheets and convert them into a structured plan preview for an app.',
    'Return valid JSON only. Do not wrap it in markdown.',
    'Infer trackables as either "exercise" or "habit".',
    'Use one of these target types only: count, sets, duration, distance, for-time, weighted.',
    'Use one of these progress metrics only: count, time, weight.',
    'Use one of these refs only: last-result, personal-best.',
    'Keep labels user-friendly and consistent across the items list and day items.',
    'If the spreadsheet is ambiguous, add warnings but still produce the best usable draft.',
    'If an item appears to already exist in the catalog, keep the same human-readable name as the catalog item when reasonable.',
    `Use this JSON shape: ${JSON.stringify(schemaExample)}`,
  ].join(' ')

  const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.OPENAI_PLAN_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({ fileName: body.fileName ?? 'spreadsheet', catalog, sheets }) },
      ],
    }),
  })
  if (!openAiResponse.ok) {
    console.error(JSON.stringify({ message: 'OpenAI request failed', status: openAiResponse.status }))
    throw new HttpError(502, 'OpenAI request failed.')
  }
  const completion = await openAiResponse.json<{
    choices?: Array<{ message?: { content?: string } }>
  }>()
  const content = completion.choices?.[0]?.message?.content
  if (!content) throw new HttpError(502, 'OpenAI response was empty.')
  try {
    return json(JSON.parse(content))
  } catch {
    throw new HttpError(502, 'OpenAI returned an invalid plan.')
  }
}

type WorkoutRow = {
  date: string
  day_notes: string | null
  skipped: number | null
  day_no: number | null
  plan_name: string | null
  run_name: string | null
  exercise_id: string | null
  exercise_name: string | null
  exercise_kind: string | null
  target: string | null
  result: string | null
  done: number | null
}

async function workoutForDate(userId: string, date: string, env: Env) {
  const result = await env.DB.prepare(`
    SELECT sd.date, sd.notes AS day_notes, sd.skipped, sd.day_no,
      p.name AS plan_name, r.name AS run_name,
      e.id AS exercise_id, e.name AS exercise_name, e.kind AS exercise_kind,
      si.target, si.result, si.done
    FROM schedule_days sd
    LEFT JOIN runs r ON r.id = sd.run_id AND r.user_id = sd.user_id
    LEFT JOIN plans p ON p.id = r.plan_id AND p.user_id = sd.user_id
    LEFT JOIN schedule_items si ON si.schedule_day_id = sd.id AND si.user_id = sd.user_id
    LEFT JOIN exercises e ON e.id = si.exercise_id AND e.user_id = sd.user_id
    WHERE sd.user_id = ? AND sd.date = ?
    ORDER BY si.created_at ASC
  `).bind(userId, date).all<WorkoutRow>()
  const first = result.results[0]
  return {
    date,
    plan: first?.plan_name ?? first?.run_name ?? null,
    dayNumber: first?.day_no ?? null,
    notes: first?.day_notes ?? '',
    skipped: first?.skipped === 1,
    items: result.results.filter((row) => row.exercise_id).map((row) => ({
      exerciseId: row.exercise_id,
      exercise: row.exercise_name,
      kind: row.exercise_kind,
      target: parseStoredJson(row.target),
      result: parseStoredJson(row.result),
      done: row.done === 1,
    })),
  }
}

function average(values: Array<number | null | undefined>) {
  const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!present.length) return null
  return Math.round((present.reduce((total, value) => total + value, 0) / present.length) * 10) / 10
}

async function buildDailyReviewContext(user: AuthenticatedUser, date: string, env: Env) {
  const todayWorkout = await workoutForDate(user.id, date, env)
  const health = await env.DB.prepare(`
    SELECT date, calories_kcal, protein_g, carbs_g, fat_g, steps, nutrition_source, steps_source
    FROM daily_health
    WHERE user_id = ? AND date BETWEEN date(?, '-13 days') AND ?
    ORDER BY date ASC
  `).bind(user.id, date, date).all<Record<string, unknown>>()
  const weights = await env.DB.prepare(`
    SELECT local_date, weight_lb, source, measured_at
    FROM body_weight_entries
    WHERE user_id = ? AND local_date BETWEEN date(?, '-27 days') AND ?
    ORDER BY local_date ASC, measured_at DESC
  `).bind(user.id, date, date).all<{ local_date: string; weight_lb: number; source: string; measured_at: string }>()
  const profile = await env.DB.prepare(`
    SELECT goal_name, start_weight_lb, height_inches, target_weight_lb,
      desired_loss_min_lb, desired_loss_max_lb, targets, equipment, calorie_context, coaching_style
    FROM coaching_profiles WHERE user_id = ?
  `).bind(user.id).first<Record<string, unknown>>()
  const notes = await env.DB.prepare(`
    SELECT category, title, body, priority, exercise_id
    FROM coaching_notes WHERE user_id = ? AND status = 'active'
    ORDER BY priority DESC, created_at ASC
  `).bind(user.id).all<Record<string, unknown>>()
  const previousLogs = todayWorkout.items.length ? await env.DB.prepare(`
    SELECT l.exercise_id, e.name AS exercise_name, l.date, l.type, l.target, l.result
    FROM logs l
    JOIN exercises e ON e.id = l.exercise_id AND e.user_id = l.user_id
    WHERE l.user_id = ? AND l.date < ? AND l.exercise_id IN (${todayWorkout.items.map(() => '?').join(', ')})
    ORDER BY l.date DESC, l.updated_at DESC
  `).bind(user.id, date, ...todayWorkout.items.map((item) => item.exerciseId)).all<Record<string, unknown>>() : { results: [] }
  const latestByExercise = new Map<string, Record<string, unknown>>()
  previousLogs.results.forEach((row) => {
    const exerciseId = String(row.exercise_id)
    if (!latestByExercise.has(exerciseId)) latestByExercise.set(exerciseId, {
      exerciseId,
      exercise: row.exercise_name,
      date: row.date,
      type: row.type,
      target: parseStoredJson(row.target),
      result: parseStoredJson(row.result),
    })
  })
  const nextDay = await env.DB.prepare(`
    SELECT date FROM schedule_days
    WHERE user_id = ? AND date > ?
    ORDER BY date ASC LIMIT 1
  `).bind(user.id, date).first<{ date: string }>()
  const tomorrow = nextDay ? await workoutForDate(user.id, nextDay.date, env) : null
  const recentReviews = await env.DB.prepare(`
    SELECT date, headline, structured_review
    FROM daily_reviews WHERE user_id = ? AND date < ?
    ORDER BY date DESC LIMIT 3
  `).bind(user.id, date).all<{ date: string; headline: string; structured_review: string }>()

  const healthRows = health.results.map((row) => ({
    date: row.date,
    calories: typeof row.calories_kcal === 'number' ? Math.round(row.calories_kcal) : row.calories_kcal,
    protein: typeof row.protein_g === 'number' ? Math.round(row.protein_g) : row.protein_g,
    carbs: typeof row.carbs_g === 'number' ? Math.round(row.carbs_g) : row.carbs_g,
    fat: typeof row.fat_g === 'number' ? Math.round(row.fat_g) : row.fat_g,
    steps: typeof row.steps === 'number' ? Math.round(row.steps) : row.steps,
  }))
  const oneWeightPerDay = new Map<string, number>()
  weights.results.forEach((row) => {
    if (!oneWeightPerDay.has(row.local_date) || row.source === 'manual') oneWeightPerDay.set(row.local_date, row.weight_lb)
  })
  const weightRows = Array.from(oneWeightPerDay, ([localDate, weight]) => ({ date: localDate, weight }))
  const last7Start = new Date(`${date}T12:00:00Z`)
  last7Start.setUTCDate(last7Start.getUTCDate() - 6)
  const startKey = last7Start.toISOString().slice(0, 10)
  const last7Health = healthRows.filter((row) => String(row.date) >= startKey)
  const last7Weight = weightRows.filter((row) => row.date >= startKey)
  return {
    reviewDate: date,
    today: {
      workout: todayWorkout,
      health: healthRows.find((row) => row.date === date) ?? null,
      weight: weightRows.find((row) => row.date === date)?.weight ?? null,
    },
    previousPerformance: Array.from(latestByExercise.values()),
    recent14Days: { health: healthRows, weight: weightRows },
    sevenDayAverages: {
      calories: average(last7Health.map((row) => row.calories as number | null)),
      protein: average(last7Health.map((row) => row.protein as number | null)),
      steps: average(last7Health.map((row) => row.steps as number | null)),
      weight: average(last7Weight.map((row) => row.weight)),
      daysWithNutrition: last7Health.filter((row) => typeof row.calories === 'number').length,
      weighIns: last7Weight.length,
    },
    goals: profile ? {
      name: profile.goal_name,
      startWeightLb: profile.start_weight_lb,
      heightInches: profile.height_inches,
      targetWeightLb: profile.target_weight_lb,
      desiredLossLbPerWeek: [profile.desired_loss_min_lb, profile.desired_loss_max_lb],
      targets: parseStoredJson(profile.targets),
      equipment: profile.equipment,
      calorieContext: profile.calorie_context,
      coachingStyle: parseStoredJson(profile.coaching_style),
    } : null,
    persistentNotes: notes.results.map((note) => ({ ...note })),
    nextScheduledDay: tomorrow,
    recentReviews: recentReviews.results.map((review) => ({
      date: review.date,
      headline: review.headline,
      recommendations: parseStoredJson(review.structured_review),
    })),
  }
}

const dailyReviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'overall', 'training', 'nutrition', 'trends', 'tomorrow', 'action_items', 'exercise_recommendations'],
  properties: {
    headline: { type: 'string' },
    overall: { type: 'string' },
    training: { type: 'string' },
    nutrition: { type: 'string' },
    trends: { type: 'string' },
    tomorrow: { type: 'string' },
    action_items: { type: 'array', items: { type: 'string' } },
    exercise_recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['exercise_id', 'exercise', 'recommendation', 'reason', 'proposed_change'],
        properties: {
          exercise_id: { type: 'string' },
          exercise: { type: 'string' },
          recommendation: { type: 'string' },
          reason: { type: 'string' },
          proposed_change: {
            type: 'object',
            additionalProperties: false,
            required: ['action', 'type', 'count', 'count_unit', 'sets', 'reps', 'seconds', 'distance', 'distance_unit', 'weight'],
            properties: {
              action: { type: 'string', enum: ['update_target', 'no_change'] },
              type: { anyOf: [{ type: 'string', enum: ['count', 'sets', 'duration', 'distance', 'for-time', 'weighted'] }, { type: 'null' }] },
              count: { anyOf: [{ type: 'number' }, { type: 'null' }] },
              count_unit: { anyOf: [{ type: 'string', enum: ['reps', 'steps'] }, { type: 'null' }] },
              sets: { anyOf: [{ type: 'number' }, { type: 'null' }] },
              reps: { anyOf: [{ type: 'number' }, { type: 'null' }] },
              seconds: { anyOf: [{ type: 'number' }, { type: 'null' }] },
              distance: { anyOf: [{ type: 'number' }, { type: 'null' }] },
              distance_unit: { anyOf: [{ type: 'string', enum: ['mi', 'km'] }, { type: 'null' }] },
              weight: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            },
          },
        },
      },
    },
  },
} as const

const coachInstructions = [
  'You are the user\'s ongoing fitness coach for a 60-day cut/recomposition program.',
  'Be concise but substantive. Respond to the actual record and do not manufacture problems or hypothetical extremes.',
  'Use longitudinal evidence: compare exercise performance, use 7-day weight averages, and consider the last 1-2 weeks before recommending changes.',
  'For lifting, prefer adding clean reps within the range before load unless the evidence supports increasing load.',
  'Do not treat exercise calorie estimates as calories to eat back. Account for the stated food-logging undercount context.',
  'Recognize progress without cheerleading. Give specific next-session recommendations and say when the evidence is insufficient.',
  'Respect every active safety/modification note. Do not diagnose; calmly flag genuine injury or safety concerns when supported by the record.',
].join(' ')

type ProposedTarget = { type: TargetType; target: Record<string, string | number> }

function positiveNumber(value: unknown, minimum = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : null
}

function proposedTargetFromRecommendation(value: unknown): ProposedTarget | null {
  if (!isRecord(value) || !isRecord(value.proposed_change) || value.proposed_change.action !== 'update_target') return null
  const change = value.proposed_change
  if (typeof change.type !== 'string' || !['count', 'sets', 'duration', 'distance', 'for-time', 'weighted'].includes(change.type)) return null
  const type = change.type as TargetType
  if (type === 'count') {
    const count = positiveNumber(change.count, 1)
    return count === null ? null : { type, target: { count: Math.round(count), countUnit: change.count_unit === 'steps' ? 'steps' : 'reps' } }
  }
  if (type === 'sets') {
    const sets = positiveNumber(change.sets, 1)
    const reps = positiveNumber(change.reps, 1)
    return sets === null || reps === null ? null : { type, target: { sets: Math.round(sets), reps: Math.round(reps) } }
  }
  if (type === 'duration') {
    const seconds = positiveNumber(change.seconds, 1)
    return seconds === null ? null : { type, target: { seconds: Math.round(seconds) } }
  }
  if (type === 'distance') {
    const distance = positiveNumber(change.distance, 0.01)
    return distance === null ? null : { type, target: { distance, unit: change.distance_unit === 'km' ? 'km' : 'mi' } }
  }
  if (type === 'for-time') {
    const count = positiveNumber(change.count, 1)
    return count === null ? null : { type, target: { count: Math.round(count) } }
  }
  const sets = positiveNumber(change.sets, 1)
  const reps = positiveNumber(change.reps, 1)
  const weight = positiveNumber(change.weight, 0)
  return sets === null || reps === null || weight === null ? null : { type, target: { sets: Math.round(sets), reps: Math.round(reps), weight } }
}

async function callOpenAI(body: Record<string, unknown>, env: Env) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    console.error(JSON.stringify({ message: 'OpenAI coach request failed', status: response.status }))
    throw new HttpError(502, 'The coach could not complete the review. Please try again.')
  }
  return response.json<OpenAIResponse>()
}

function reviewText(review: Record<string, unknown>) {
  const actions = Array.isArray(review.action_items) ? review.action_items.map((item) => `• ${item}`).join('\n') : ''
  const sections = [review.overall, review.training, review.nutrition, review.trends, review.tomorrow]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
  return [...sections, actions].filter(Boolean).join('\n\n')
}

type DailyReviewRow = {
  id: string
  date: string
  model: string
  headline: string
  review_text: string
  structured_review: string
  created_at?: string
  updated_at?: string
}

type FutureScheduleItem = {
  id: string
  exercise_id: string
  date: string
  type: string
  target: string
}

type RecommendationDecision = {
  recommendation_index: number
  recommendation_json: string
  decision: 'applied' | 'dismissed'
  schedule_item_id: string | null
  scheduled_date: string | null
  before_type: string | null
  before_target: string | null
  after_type: string | null
  after_target: string | null
}

function reviewRecommendations(structuredReview: unknown) {
  if (!isRecord(structuredReview) || !Array.isArray(structuredReview.exercise_recommendations)) return []
  return structuredReview.exercise_recommendations.filter(isRecord)
}

async function futureScheduleItems(userId: string, reviewDate: string, exerciseIds: string[], env: Env) {
  const uniqueExerciseIds = Array.from(new Set(exerciseIds.filter(Boolean)))
  if (!uniqueExerciseIds.length) return new Map<string, FutureScheduleItem>()
  const result = await env.DB.prepare(`
    SELECT si.id, si.exercise_id, sd.date, si.type, si.target
    FROM schedule_items si
    JOIN schedule_days sd ON sd.id = si.schedule_day_id AND sd.user_id = si.user_id
    WHERE si.user_id = ? AND sd.date > ? AND si.done = 0 AND sd.skipped = 0
      AND si.exercise_id IN (${uniqueExerciseIds.map(() => '?').join(', ')})
    ORDER BY sd.date ASC, si.created_at ASC
  `).bind(userId, reviewDate, ...uniqueExerciseIds).all<FutureScheduleItem>()
  const firstByExercise = new Map<string, FutureScheduleItem>()
  result.results.forEach((item) => {
    if (!firstByExercise.has(item.exercise_id)) firstByExercise.set(item.exercise_id, item)
  })
  return firstByExercise
}

async function enrichDailyReview(review: DailyReviewRow, user: AuthenticatedUser, env: Env) {
  const structured = parseStoredJson(review.structured_review)
  const recommendations = reviewRecommendations(structured)
  const decisions = await env.DB.prepare(`
    SELECT recommendation_index, recommendation_json, decision, schedule_item_id, scheduled_date,
      before_type, before_target, after_type, after_target
    FROM coach_recommendation_decisions
    WHERE user_id = ? AND review_id = ?
  `).bind(user.id, review.id).all<RecommendationDecision>()
  const decisionByRecommendation = new Map(decisions.results.map((decision) => [`${decision.recommendation_index}:${decision.recommendation_json}`, decision]))
  const futureByExercise = await futureScheduleItems(user.id, review.date, recommendations.map((recommendation) => typeof recommendation.exercise_id === 'string' ? recommendation.exercise_id : ''), env)
  const enrichedRecommendations = recommendations.map((recommendation, recommendationIndex) => {
    const recommendationJson = JSON.stringify(recommendation)
    const decision = decisionByRecommendation.get(`${recommendationIndex}:${recommendationJson}`)
    if (decision) {
      return {
        ...recommendation,
        plan_action: {
          status: decision.decision,
          can_apply: false,
          next_date: decision.scheduled_date,
          schedule_item_id: decision.schedule_item_id,
          current_type: decision.before_type,
          current_target: parseStoredJson(decision.before_target),
          proposed_type: decision.after_type,
          proposed_target: parseStoredJson(decision.after_target),
          message: decision.decision === 'applied' ? 'Applied to the next scheduled session.' : 'Recommendation dismissed.',
        },
      }
    }
    const proposal = proposedTargetFromRecommendation(recommendation)
    if (!proposal) return { ...recommendation, plan_action: { status: 'no_change', can_apply: false, message: 'No target change recommended.' } }
    const exerciseId = typeof recommendation.exercise_id === 'string' ? recommendation.exercise_id : ''
    const nextItem = futureByExercise.get(exerciseId)
    if (!nextItem) return { ...recommendation, plan_action: { status: 'unavailable', can_apply: false, proposed_type: proposal.type, proposed_target: proposal.target, message: 'No future session containing this exercise is scheduled.' } }
    return {
      ...recommendation,
      plan_action: {
        status: 'pending',
        can_apply: true,
        next_date: nextItem.date,
        schedule_item_id: nextItem.id,
        current_type: nextItem.type,
        current_target: parseStoredJson(nextItem.target),
        proposed_type: proposal.type,
        proposed_target: proposal.target,
        message: 'Review this change before applying it.',
      },
    }
  })
  return {
    ...review,
    structured_review: isRecord(structured) ? { ...structured, exercise_recommendations: enrichedRecommendations } : structured,
  }
}

async function submitDailyReview(request: Request, user: AuthenticatedUser, env: Env) {
  const body = await request.json<DailyReviewRequest>()
  const date = requireDate(body.date)
  const context = await buildDailyReviewContext(user, date, env)
  const model = env.OPENAI_COACH_MODEL || 'gpt-5.4-mini'
  const response = await callOpenAI({
    model,
    store: false,
    reasoning: { effort: 'low' },
    max_output_tokens: 4000,
    instructions: `${coachInstructions} Produce a daily review using the supplied JSON context. The tomorrow field must identify the next scheduled day, including its date, or clearly say none is scheduled. For every exercise recommendation, copy the exact exerciseId from today's workout. Use proposed_change.action update_target only when recommending a specific next-session target that can be represented by the supplied target types; otherwise use no_change and set every other proposed_change field to null. Never propose a load outside the user's available equipment.`,
    input: JSON.stringify(context),
    text: { format: { type: 'json_schema', name: 'daily_fitness_review', strict: true, schema: dailyReviewSchema } },
  }, env)
  const content = responseText(response)
  if (!content) throw new HttpError(502, 'The coach returned an empty review.')
  let structured: Record<string, unknown>
  try {
    structured = JSON.parse(content) as Record<string, unknown>
  } catch {
    console.error(JSON.stringify({
      message: 'OpenAI coach returned invalid JSON',
      responseId: response.id ?? null,
      contentLength: content.length,
      contentTail: content.slice(-250),
    }))
    throw new HttpError(502, 'The coach returned an invalid review.')
  }
  const reviewId = `daily-review-${user.id}-${date}`
  await env.DB.prepare(`
    INSERT INTO daily_reviews
      (id, user_id, date, model, headline, review_text, structured_review, context_snapshot, openai_response_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      model = excluded.model, headline = excluded.headline, review_text = excluded.review_text,
      structured_review = excluded.structured_review, context_snapshot = excluded.context_snapshot,
      openai_response_id = excluded.openai_response_id,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(reviewId, user.id, date, model, String(structured.headline || 'Daily review'), reviewText(structured), JSON.stringify(structured), JSON.stringify(context), response.id ?? null).run()
  const review = await enrichDailyReview({ id: reviewId, date, model, headline: String(structured.headline || 'Daily review'), review_text: reviewText(structured), structured_review: JSON.stringify(structured) }, user, env)
  return json({ review })
}

async function getDailyCoach(date: string, user: AuthenticatedUser, env: Env) {
  const review = await env.DB.prepare(`
    SELECT id, date, model, headline, review_text, structured_review, created_at, updated_at
    FROM daily_reviews WHERE user_id = ? AND date = ?
  `).bind(user.id, date).first<DailyReviewRow>()
  if (!review) return json({ review: null, messages: [] })
  const messages = await env.DB.prepare(`
    SELECT id, role, content, created_at FROM coach_messages
    WHERE user_id = ? AND review_id = ? ORDER BY created_at ASC
  `).bind(user.id, review.id).all<Record<string, unknown>>()
  return json({
    review: await enrichDailyReview(review, user, env),
    messages: messages.results,
  })
}

async function decideCoachRecommendation(request: Request, user: AuthenticatedUser, env: Env) {
  const body = await request.json<CoachRecommendationRequest>()
  const date = requireDate(body.date)
  if (!Number.isInteger(body.recommendationIndex) || (body.recommendationIndex as number) < 0) throw new HttpError(400, 'A valid recommendation is required.')
  if (body.action !== 'apply' && body.action !== 'dismiss') throw new HttpError(400, 'Choose apply or dismiss.')
  const review = await env.DB.prepare(`
    SELECT id, date, model, headline, review_text, structured_review, created_at, updated_at
    FROM daily_reviews WHERE user_id = ? AND date = ?
  `).bind(user.id, date).first<DailyReviewRow>()
  if (!review) throw new HttpError(404, 'The daily review was not found.')
  const structured = parseStoredJson(review.structured_review)
  const recommendations = reviewRecommendations(structured)
  const recommendationIndex = body.recommendationIndex as number
  const recommendation = recommendations[recommendationIndex]
  if (!recommendation) throw new HttpError(404, 'That recommendation is no longer available.')
  const recommendationJson = JSON.stringify(recommendation)
  const existing = await env.DB.prepare(`
    SELECT id FROM coach_recommendation_decisions
    WHERE user_id = ? AND review_id = ? AND recommendation_index = ? AND recommendation_json = ?
  `).bind(user.id, review.id, recommendationIndex, recommendationJson).first<{ id: string }>()
  if (existing) return json({ review: await enrichDailyReview(review, user, env) })

  const decisionId = await sha256Hex(`${user.id}:${review.id}:${recommendationIndex}:${recommendationJson}`)
  if (body.action === 'dismiss') {
    await env.DB.prepare(`
      INSERT INTO coach_recommendation_decisions
        (id, user_id, review_id, recommendation_index, recommendation_json, decision)
      VALUES (?, ?, ?, ?, ?, 'dismissed')
    `).bind(decisionId, user.id, review.id, recommendationIndex, recommendationJson).run()
    return json({ review: await enrichDailyReview(review, user, env) })
  }

  const proposal = proposedTargetFromRecommendation(recommendation)
  if (!proposal) throw new HttpError(409, 'This recommendation does not contain a target change.')
  const exerciseId = typeof recommendation.exercise_id === 'string' ? recommendation.exercise_id : ''
  const nextItem = (await futureScheduleItems(user.id, date, [exerciseId], env)).get(exerciseId)
  if (!nextItem) throw new HttpError(409, 'No future session containing this exercise is scheduled.')
  const currentTarget = parseStoredJson(nextItem.target)
  if (body.scheduleItemId !== nextItem.id || body.expectedType !== nextItem.type || JSON.stringify(body.expectedTarget) !== JSON.stringify(currentTarget)) {
    throw new HttpError(409, 'The next session changed. Reopen the review to see the current target.')
  }
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE schedule_items SET type = ?, target = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND user_id = ?
    `).bind(proposal.type, JSON.stringify(proposal.target), nextItem.id, user.id),
    env.DB.prepare(`
      INSERT INTO coach_recommendation_decisions
        (id, user_id, review_id, recommendation_index, recommendation_json, decision, schedule_item_id,
         scheduled_date, before_type, before_target, after_type, after_target)
      VALUES (?, ?, ?, ?, ?, 'applied', ?, ?, ?, ?, ?, ?)
    `).bind(decisionId, user.id, review.id, recommendationIndex, recommendationJson, nextItem.id, nextItem.date, nextItem.type, JSON.stringify(currentTarget), proposal.type, JSON.stringify(proposal.target)),
  ])
  return json({
    review: await enrichDailyReview(review, user, env),
    updatedItem: { id: nextItem.id, date: nextItem.date, type: proposal.type, target: proposal.target },
  })
}

async function sendCoachMessage(request: Request, user: AuthenticatedUser, env: Env) {
  const body = await request.json<CoachMessageRequest>()
  const date = requireDate(body.date)
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 4000) {
    throw new HttpError(400, 'Enter a message up to 4,000 characters.')
  }
  const review = await env.DB.prepare(`
    SELECT id, structured_review, context_snapshot FROM daily_reviews
    WHERE user_id = ? AND date = ?
  `).bind(user.id, date).first<{ id: string; structured_review: string; context_snapshot: string }>()
  if (!review) throw new HttpError(404, 'Submit this day for review before chatting with the coach.')
  const history = await env.DB.prepare(`
    SELECT role, content FROM coach_messages
    WHERE user_id = ? AND review_id = ? ORDER BY created_at DESC LIMIT 12
  `).bind(user.id, review.id).all<{ role: 'user' | 'assistant'; content: string }>()
  const input = [
    { role: 'developer', content: `Daily review: ${review.structured_review}\nRelevant saved context: ${review.context_snapshot}` },
    ...history.results.reverse().map((message) => ({ role: message.role, content: message.content })),
    { role: 'user', content: body.message.trim() },
  ]
  const model = env.OPENAI_COACH_MODEL || 'gpt-5.4-mini'
  const response = await callOpenAI({
    model,
    store: false,
    reasoning: { effort: 'low' },
    max_output_tokens: 1000,
    instructions: `${coachInstructions} Answer the follow-up question directly using the saved daily review and context.`,
    input,
    text: { verbosity: 'low' },
  }, env)
  const answer = responseText(response)
  if (!answer) throw new HttpError(502, 'The coach returned an empty answer.')
  const now = new Date().toISOString()
  const userMessage = { id: crypto.randomUUID(), role: 'user', content: body.message.trim(), created_at: now }
  const coachMessage = { id: crypto.randomUUID(), role: 'assistant', content: answer, created_at: new Date(Date.now() + 1).toISOString() }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO coach_messages (id, user_id, review_id, date, role, content, created_at) VALUES (?, ?, ?, ?, 'user', ?, ?)`)
      .bind(userMessage.id, user.id, review.id, date, userMessage.content, userMessage.created_at),
    env.DB.prepare(`INSERT INTO coach_messages (id, user_id, review_id, date, role, content, openai_response_id, created_at) VALUES (?, ?, ?, ?, 'assistant', ?, ?, ?)`)
      .bind(coachMessage.id, user.id, review.id, date, answer, response.id ?? null, coachMessage.created_at),
  ])
  return json({ messages: [userMessage, coachMessage] })
}

async function createMobilePairing(user: AuthenticatedUser, env: Env) {
  const code = randomPairingCode()
  const normalized = code.replace(/-/g, '')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM mobile_pairing_codes WHERE user_id = ? AND used_at IS NULL').bind(user.id),
    env.DB.prepare(`
      INSERT INTO mobile_pairing_codes (id, user_id, code_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), user.id, await sha256Hex(normalized), expiresAt, now.toISOString()),
  ])
  return json({ code, expiresAt, syncUrl: env.MOBILE_SYNC_URL })
}

async function getMobileSyncStatus(user: AuthenticatedUser, env: Env) {
  const device = await env.DB.prepare(`
    SELECT id, name, app_version, last_used_at, last_sync_attempt_at, last_sync_success_at,
      last_sync_status, last_sync_error, background_permission, last_sync_trigger, created_at
    FROM mobile_devices
    WHERE user_id = ? AND revoked_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.id).first<Record<string, unknown>>()
  return json({ device: device ? { ...device, background_permission: device.background_permission === 1 } : null })
}

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url)
  const user = await authenticate(request, env)

  if (request.method === 'GET' && url.pathname === '/api/auth/session') {
    return json({
      user: {
        id: user.id,
        email: user.email,
        user_metadata: { full_name: user.displayName, name: user.displayName },
      },
    })
  }
  if (request.method === 'GET' && url.pathname === '/api/auth/login') {
    const requested = url.searchParams.get('returnTo')
    const destination = requested ? new URL(requested, url.origin) : new URL('/', url.origin)
    const allowedOrigin = new URL(env.FRONTEND_ORIGIN).origin
    const target = destination.origin === url.origin || destination.origin === allowedOrigin
      ? destination.href
      : env.FRONTEND_ORIGIN
    return Response.redirect(target, 302)
  }
  if (request.method === 'POST' && url.pathname === '/api/database') return handleDatabase(request, user, env)
  if (request.method === 'POST' && url.pathname === '/api/functions/analyze-plan-sheet') return analyzePlanSheet(request, env)
  if (request.method === 'POST' && url.pathname === '/api/functions/create-mobile-pairing') return createMobilePairing(user, env)
  if (request.method === 'GET' && url.pathname === '/api/health-sync/status') return getMobileSyncStatus(user, env)
  if (request.method === 'POST' && url.pathname === '/api/functions/submit-daily-review') return submitDailyReview(request, user, env)
  if (request.method === 'POST' && url.pathname === '/api/functions/coach-message') return sendCoachMessage(request, user, env)
  if (request.method === 'POST' && url.pathname === '/api/functions/coach-recommendation') return decideCoachRecommendation(request, user, env)
  if (request.method === 'GET' && url.pathname === '/api/coach/day') return getDailyCoach(requireDate(url.searchParams.get('date')), user, env)
  if (request.method === 'GET' && url.pathname === '/api/health') return json({ ok: true, database: 'D1', user: user.email })
  throw new HttpError(404, 'Not found.')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
        return withCors(new Response(null, { status: 204 }), request, env)
      }
      if (url.pathname.startsWith('/api/')) return withCors(await handleApi(request, env), request, env)
      return await env.ASSETS.fetch(request)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError ? error.message : 'Internal server error.'
      console.error(JSON.stringify({
        message: 'request failed',
        path: new URL(request.url).pathname,
        status,
        error: error instanceof Error ? error.message : String(error),
      }))
      return withCors(json({ error: message }, { status }), request, env)
    }
  },
} satisfies ExportedHandler<Env>

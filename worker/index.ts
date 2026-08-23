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

function isTableName(value: unknown): value is TableName {
  return typeof value === 'string' && Object.hasOwn(TABLES, value)
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
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

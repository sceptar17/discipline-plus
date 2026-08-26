export type User = {
  id: string
  email?: string | null
  user_metadata?: {
    full_name?: string | null
    name?: string | null
    avatar_url?: string | null
    picture?: string | null
  }
}

type ClientError = Error & { context?: Response }
type DynamicRow = {
  id: string
  user_id: string
  kind: string | null
  name: string
  category: string
  equipment: string
  notes: string
  default_type: string
  allowed: unknown
  target: unknown
  refs: unknown
  progress_metric: string
  focus: string
  plan_id: string
  day_number: number
  plan_day_id: string
  exercise_id: string
  type: string
  ref: string
  start_date: string
  date: string
  skipped: boolean
  run_id: string | null
  day_no: number | null
  schedule_day_id: string
  done: boolean
  result: unknown
  source_item_id: string | null
  email: string
  display_name: string
  created_at: string
  updated_at: string
  calories_kcal: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  steps: number | null
  timezone: string
  nutrition_source: string
  steps_source: string
  synced_at: string | null
  provenance: unknown
  measured_at: string
  local_date: string
  weight_lb: number
  source: string
  source_record_id: string | null
  goal_name: string
  start_weight_lb: number | null
  height_inches: number | null
  target_weight_lb: number | null
  desired_loss_min_lb: number | null
  desired_loss_max_lb: number | null
  targets: unknown
  calorie_context: string
  coaching_style: unknown
  title: string
  body: string
  status: string
  priority: number
  effective_from: string | null
}
type QueryResult = { data: DynamicRow[] | null; error: ClientError | null }
type Filter = { column: string; operator: 'eq' | 'in'; value: unknown }

type QueryRequest = {
  table: string
  action: 'select' | 'upsert' | 'delete'
  columns?: string[]
  filters?: Filter[]
  order?: { column: string; ascending: boolean }
  data?: unknown
}

const hostedFrontendApiOrigin = 'https://discipline-plus.bfust27.workers.dev'
const apiOrigin = typeof window !== 'undefined' && window.location.hostname === 'fitness.aparishhouse.com'
  ? hostedFrontendApiOrigin
  : ''

function apiUrl(path: string) {
  return `${apiOrigin}${path}`
}

export async function loadCoachDay(date: string) {
  const response = await fetch(apiUrl(`/api/coach/day?date=${encodeURIComponent(date)}`), { credentials: 'include' })
  return parseResponse(response) as Promise<{ review?: unknown; messages?: unknown[] } | null>
}

export async function loadHealthSyncStatus() {
  const response = await fetch(apiUrl('/api/health-sync/status'), { credentials: 'include' })
  return parseResponse(response) as Promise<{ device?: unknown } | null>
}

function clientError(message: string, context?: Response): ClientError {
  const error = new Error(message) as ClientError
  error.context = context
  return error
}

async function parseResponse(response: Response) {
  const context = response.clone()
  const payload = await response.json().catch(() => null) as {
    data?: DynamicRow[]
    error?: string
  } | null

  if (!response.ok) {
    throw clientError(payload?.error || `Request failed with status ${response.status}.`, context)
  }

  return payload
}

class QueryBuilder implements PromiseLike<QueryResult> {
  private request: QueryRequest
  private promise: Promise<QueryResult> | null = null

  constructor(table: string) {
    this.request = { table, action: 'select' }
  }

  select(columns: string) {
    this.request.action = 'select'
    this.request.columns = columns.split(',').map((column) => column.trim()).filter(Boolean)
    return this
  }

  upsert(data: unknown) {
    this.request.action = 'upsert'
    this.request.data = data
    return this
  }

  delete() {
    this.request.action = 'delete'
    return this
  }

  eq(column: string, value: unknown) {
    this.request.filters = [...(this.request.filters ?? []), { column, operator: 'eq', value }]
    return this
  }

  in(column: string, value: unknown[]) {
    this.request.filters = [...(this.request.filters ?? []), { column, operator: 'in', value }]
    return this
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.request.order = { column, ascending: options?.ascending !== false }
    return this
  }

  private execute() {
    this.promise ??= fetch(apiUrl('/api/database'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(this.request),
    }).then(parseResponse)
      .then((payload) => ({ data: payload?.data ?? [], error: null }))
      .catch((error: unknown) => ({
        data: null,
        error: error instanceof Error ? error as ClientError : clientError('Unknown database error.'),
      }))

    return this.promise
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }
}

async function getSessionUser(): Promise<User | null> {
  const response = await fetch(apiUrl('/api/auth/session'), { credentials: 'include' })
  if (response.status === 401 || response.status === 403) return null
  const payload = await parseResponse(response) as { user?: User } | null
  return payload?.user ?? null
}

export const hasSupabaseEnv = true
export const supabaseUrl = 'Cloudflare D1 + Workers'

// This compatibility-shaped client keeps the app logic focused while the
// implementation moves from the Supabase SDK to same-origin Worker endpoints.
export const supabase = {
  from(table: string) {
    return new QueryBuilder(table)
  },
  auth: {
    async getSession() {
      const user = await getSessionUser().catch(() => null)
      return { data: { session: user ? { user } : null } }
    },
    onAuthStateChange(callback: (event: string, session: { user: User } | null) => void) {
      void callback
      return { data: { subscription: { unsubscribe() {} } } }
    },
    async signInWithOAuth(options?: unknown) {
      void options
      window.location.assign(apiUrl(`/api/auth/login?returnTo=${encodeURIComponent(window.location.href)}`))
      return { error: null }
    },
    async signOut() {
      window.location.assign(apiUrl('/cdn-cgi/access/logout'))
      return { error: null }
    },
  },
  functions: {
    async invoke(name: string, options?: { body?: unknown }) {
      const response = await fetch(apiUrl(`/api/functions/${encodeURIComponent(name)}`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(options?.body ?? {}),
      })
      const context = response.clone()
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const detail = payload && typeof payload === 'object' && 'error' in payload
          ? String(payload.error)
          : `Function failed with status ${response.status}.`
        return { data: null, error: clientError(detail, context) }
      }
      return { data: payload, error: null }
    },
  },
}

// Shared domain types for Discipline+.

export type TK = 'exercise' | 'habit'
export type TT = 'count' | 'sets' | 'duration' | 'distance' | 'for-time' | 'weighted'
export type RM = 'last-result' | 'personal-best'
export type PM = 'count' | 'time' | 'weight'
export type EffortRating = 'easy' | 'moderate' | 'hard' | 'limit'
export type DaySection = 'habits' | 'workout' | 'health' | 'coach'
export type CountUnit = 'reps' | 'steps'
export type Target = { count?: number; countUnit?: CountUnit; sets?: number; reps?: number; seconds?: number; distance?: number; unit?: 'mi' | 'km'; weight?: number }
export type SetResult = { reps: number; weight?: number }
export type Result = { seconds?: number; timeText?: string; weight?: number; count?: number; sets?: SetResult[]; difficulty?: EffortRating; note?: string }
export type Exercise = { id: string; kind: TK; name: string; category: string; equipment: string; notes: string; defaultType: TT; allowed: TT[]; target: Target; refs: RM[]; progressMetric: PM; repeatDays?: number[] }
export type Item = { id: string; exerciseId: string; type: TT; target: Target; ref: RM; done: boolean; result: Result }
export type Day = { date: string; notes: string; rest: boolean; skipped: boolean; runId?: string; dayNo?: number; items: Item[] }
export type PlanDay = { id: string; label: string; rest: boolean; notes?: string; items: Array<{ id: string; exerciseId: string; type: TT; target: Target; ref: RM }> }
export type Plan = { id: string; name: string; focus: string; days: PlanDay[] }
export type RunStatus = 'active' | 'completed'
export type Run = { id: string; planId: string; startDate: string; name: string; status: RunStatus; completedAt?: string }
export type Log = { id: string; sourceItemId?: string; exerciseId: string; date: string; type: TT; target: Target; result: Result; done: true }
export type LegacyHist = { id: string; exerciseId: string; date: string; type: TT; target: Target; actualSeconds?: number; actualWeight?: number; actualCount?: number; done: boolean }
export type LegacyItem = Omit<Item, 'result'> & { result?: Result; actualSeconds?: number; actualTimeText?: string; actualWeight?: number; actualCount?: number; note?: string }
export type LegacyRun = Omit<Run, 'status' | 'completedAt'> & { status?: RunStatus; completedAt?: string }
export type LegacyState = { exercises?: Exercise[]; schedule?: Array<Omit<Day, 'items'> & { items: LegacyItem[] }>; plans?: Plan[]; runs?: LegacyRun[]; history?: LegacyHist[]; logs?: Log[] }
export type State = { exercises: Exercise[]; schedule: Day[]; plans: Plan[]; runs: Run[]; logs: Log[] }
export type ExerciseForm = { kind: TK; name: string; category: string; equipment: string; notes: string; defaultType: TT; allowed: TT[]; target: Target; refs: RM[]; progressMetric: PM; repeatDays: number[] }
export type PlanForm = { name: string; focus: string }
export type PlanScheduleMode = 'cycles' | 'end-date'
export type PlanTargetMode = 'latest' | 'template'
export type PlanCyclePreview = { cycleNumber: number; startDate: string; endDate: string; days: Array<{ date: string; dayNo: number; planDay: PlanDay }> }
export type PlanSchedulePreview = { cycles: PlanCyclePreview[]; dates: string[]; conflicts: string[]; startDate: string; endDate: string; totalDays: number; error: string }
export type RemovedItem = { item: Item; index: number; log?: Log }
export type UndoActions = {
  restoreItem: (date: string, removed: RemovedItem) => Promise<unknown>
  putItem: (date: string, item: Item) => Promise<unknown>
  removeItem: (date: string, itemId: string) => Promise<unknown>
  swapDays: (sourceDate: string, targetDate: string, quiet?: boolean) => Promise<unknown>
}
export type Toast = { id: string; message: string; createdAt: number; action?: { label: string; run: () => void } }
export type ScheduleSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'
export type ItemDraft = { type: TT; target: Target; timeText: string; weightText: string; countText: string; setRepsText: string; difficulty: '' | EffortRating; note: string }
export type DailyHealthDraft = { calories: string; protein: string; carbs: string; fat: string; steps: string; weight: string }
export type MobilePairing = { code: string; expiresAt: string; syncUrl: string }
export type MobileSyncStatus = {
  id: string
  name: string
  app_version: string | null
  last_used_at: string | null
  last_sync_attempt_at: string | null
  last_sync_success_at: string | null
  last_sync_status: string | null
  last_sync_error: string | null
  background_permission: boolean
  last_sync_trigger: string | null
}
export type RecommendationPlanAction = {
  status: 'pending' | 'applied' | 'dismissed' | 'no_change' | 'unavailable'
  can_apply: boolean
  message: string
  next_date?: string | null
  schedule_item_id?: string | null
  current_type?: TT | null
  current_target?: Target | null
  proposed_type?: TT | null
  proposed_target?: Target | null
}
export type ExerciseRecommendation = { exercise_id?: string; exercise: string; recommendation: string; reason: string; plan_action?: RecommendationPlanAction }
export type DailyReview = {
  id: string
  date: string
  model: string
  headline: string
  overall: string
  training: string
  nutrition: string
  trends: string
  tomorrow: string
  action_items: string[]
  exercise_recommendations: ExerciseRecommendation[]
}
export type CoachMessage = { id: string; role: 'user' | 'assistant'; content: string; created_at: string }
export type ProgramCoachMessage = CoachMessage & { lookback_days?: number }
export type WorkbookPreview = { fileName: string; sheets: Array<{ name: string; rows: string[][] }> }
export type ImportedAnalysisItem = { name: string; kind: TK; category: string; notes: string; defaultType: TT; progressMetric: PM; usedOnDays: string[] }
export type ImportedAnalysisDay = { label: string; notes: string; items: Array<{ name: string; type: TT; target: Target; ref: RM; note: string }> }
export type ImportedPlanAnalysis = { summary: string; warnings: string[]; items: ImportedAnalysisItem[]; days: ImportedAnalysisDay[] }
export type ExerciseEditorMode = 'existing' | 'new'
export type ScheduleTouchDrag = { sourceDate: string; active: boolean; pointerId?: number; startX: number; startY: number }
export type ScheduleMoveTarget = { date: string; placement: 'before' | 'after' }
export type ConfirmState =
  | { kind: 'delete-run'; runId: string; title: string; body: string }
  | { kind: 'delete-plan'; planId: string; title: string; body: string }
  | { kind: 'delete-exercise'; exerciseId: string; title: string; body: string }
  | { kind: 'import-data'; title: string; body: string }
  | { kind: 'reset-all-data'; title: string; body: string }
  | { kind: 'reset-schedule-data'; title: string; body: string }
  | { kind: 'reset-progress-data'; title: string; body: string }
  | { kind: 'revoke-mobile-sync'; title: string; body: string }
  | null

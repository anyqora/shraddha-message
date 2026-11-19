/**
 * supabase-js compatible query builder (isomorphic).
 *
 * Mirrors the subset of `@supabase/postgrest-js` that this app uses:
 *   from(t).select/insert/upsert/update/delete
 *   .eq .neq .gt .gte .lt .lte .like .ilike .is .in .contains .containedBy .overlaps
 *   .or .not .filter .match .textSearch .order .limit .range .single .maybeSingle
 *   .select() after writes (returning), .csv(), .throwOnError(), .abortSignal(), .returns()
 *
 * It is awaitable and resolves to `{ data, error, count, status, statusText }`.
 */
import {
  condFromRaw,
  parseLogicTree,
  type Executor,
  type FilterNode,
  type FilterOp,
  type PostgrestResponse,
  type QueryState,
} from './query-state'

type AnyRow = Record<string, any>

export class PostgrestBuilder<T = any> implements PromiseLike<PostgrestResponse<T>> {
  protected state: QueryState
  protected exec: Executor
  private shouldThrow = false

  constructor(state: QueryState, exec: Executor) {
    this.state = state
    this.exec = exec
  }

  /** Serialisable snapshot (used by the browser transport). */
  toState(): QueryState {
    return JSON.parse(JSON.stringify(this.state))
  }

  throwOnError(): this {
    this.shouldThrow = true
    return this
  }

  abortSignal(_signal: AbortSignal): this {
    return this
  }

  returns<U>(): PostgrestBuilder<U> {
    return this as unknown as PostgrestBuilder<U>
  }

  overrideTypes<U>(): PostgrestBuilder<U> {
    return this as unknown as PostgrestBuilder<U>
  }

  then<R1 = PostgrestResponse<T>, R2 = never>(
    onfulfilled?: ((value: PostgrestResponse<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    const run = async (): Promise<PostgrestResponse<T>> => {
      let res: PostgrestResponse<T>
      try {
        res = (await this.exec(this.state)) as PostgrestResponse<T>
      } catch (e: any) {
        res = {
          data: null as T,
          error: {
            message: e?.message ?? String(e),
            details: e?.details ?? null,
            hint: e?.hint ?? null,
            code: e?.code ?? '',
          },
          count: null,
          status: 500,
          statusText: 'Internal Server Error',
        }
      }
      if (this.shouldThrow && res.error) {
        const err = new Error(res.error.message) as Error & Record<string, unknown>
        Object.assign(err, res.error)
        throw err
      }
      return res
    }
    return run().then(onfulfilled, onrejected)
  }
}

export class PostgrestFilterBuilder<T = any> extends PostgrestBuilder<T> {
  private push(node: FilterNode): this {
    this.state.filters.push(node)
    return this
  }

  private cond(column: string, op: FilterOp, value: unknown, negate = false): this {
    return this.push({ kind: 'cond', column, op, value, negate })
  }

  eq(column: string, value: unknown) {
    return this.cond(column, 'eq', value)
  }
  neq(column: string, value: unknown) {
    return this.cond(column, 'neq', value)
  }
  gt(column: string, value: unknown) {
    return this.cond(column, 'gt', value)
  }
  gte(column: string, value: unknown) {
    return this.cond(column, 'gte', value)
  }
  lt(column: string, value: unknown) {
    return this.cond(column, 'lt', value)
  }
  lte(column: string, value: unknown) {
    return this.cond(column, 'lte', value)
  }
  like(column: string, pattern: string) {
    return this.cond(column, 'like', pattern)
  }
  ilike(column: string, pattern: string) {
    return this.cond(column, 'ilike', pattern)
  }
  likeAnyOf(column: string, patterns: string[]) {
    return this.push({ kind: 'or', children: patterns.map((p) => ({ kind: 'cond', column, op: 'like', value: p })) })
  }
  ilikeAnyOf(column: string, patterns: string[]) {
    return this.push({ kind: 'or', children: patterns.map((p) => ({ kind: 'cond', column, op: 'ilike', value: p })) })
  }
  is(column: string, value: boolean | null) {
    return this.cond(column, 'is', value)
  }
  in(column: string, values: readonly unknown[]) {
    return this.cond(column, 'in', [...values])
  }
  contains(column: string, value: unknown) {
    return this.cond(column, 'cs', value)
  }
  containedBy(column: string, value: unknown) {
    return this.cond(column, 'cd', value)
  }
  overlaps(column: string, value: unknown) {
    return this.cond(column, 'ov', value)
  }
  textSearch(column: string, query: string, opts?: { type?: 'plain' | 'phrase' | 'websearch'; config?: string }) {
    const op: FilterOp =
      opts?.type === 'plain' ? 'plfts' : opts?.type === 'phrase' ? 'phfts' : opts?.type === 'websearch' ? 'wfts' : 'fts'
    return this.cond(column, op, query)
  }
  match(query: Record<string, unknown>) {
    for (const [k, v] of Object.entries(query)) this.cond(k, 'eq', v)
    return this
  }
  not(column: string, operator: string, value: unknown) {
    return this.push(condFromRaw(column, operator, value, true))
  }
  filter(column: string, operator: string, value: unknown) {
    if (operator.startsWith('not.')) return this.push(condFromRaw(column, operator.slice(4), value, true))
    return this.push(condFromRaw(column, operator, value))
  }
  or(filters: string, opts?: { foreignTable?: string; referencedTable?: string }) {
    const node = parseLogicTree(filters, 'or')
    const ref = opts?.referencedTable ?? opts?.foreignTable
    if (ref) {
      const ef = (this.state.embedFilters ??= {})
      ;(ef[ref] ??= []).push(node)
      return this
    }
    return this.push(node)
  }

  order(
    column: string,
    opts?: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string; referencedTable?: string }
  ) {
    this.state.orders.push({
      column,
      ascending: opts?.ascending ?? true,
      nullsFirst: opts?.nullsFirst,
      referencedTable: opts?.referencedTable ?? opts?.foreignTable,
    })
    return this
  }

  limit(count: number, opts?: { foreignTable?: string; referencedTable?: string }) {
    const ref = opts?.referencedTable ?? opts?.foreignTable
    if (ref) {
      const el = (this.state.embedLimits ??= {})
      el[ref] = { ...(el[ref] ?? {}), limit: count }
    } else this.state.limit = count
    return this
  }

  range(from: number, to: number, opts?: { foreignTable?: string; referencedTable?: string }) {
    const ref = opts?.referencedTable ?? opts?.foreignTable
    if (ref) {
      const el = (this.state.embedLimits ??= {})
      el[ref] = { offset: from, limit: to - from + 1 }
    } else {
      this.state.offset = from
      this.state.limit = to - from + 1
    }
    return this
  }

  single<R = T extends (infer U)[] ? U : T>(): PostgrestBuilder<R> {
    this.state.single = 'one'
    return this as unknown as PostgrestBuilder<R>
  }

  maybeSingle<R = T extends (infer U)[] ? U : T>(): PostgrestBuilder<R | null> {
    this.state.single = 'maybe'
    return this as unknown as PostgrestBuilder<R | null>
  }

  /** After insert/update/upsert/delete: return the affected rows. */
  select(columns = '*'): PostgrestFilterBuilder<any> {
    this.state.columns = columns
    return this
  }

  csv(): PostgrestBuilder<string> {
    this.state.csv = true
    return this as unknown as PostgrestBuilder<string>
  }
}

export class PostgrestQueryBuilder {
  constructor(
    private table: string,
    private exec: Executor,
    private schema?: string
  ) {}

  private base(operation: QueryState['operation']): QueryState {
    return { table: this.table, schema: this.schema, operation, columns: null, filters: [], orders: [] }
  }

  select(columns = '*', opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    const s = this.base('select')
    s.columns = columns
    s.count = opts?.count
    s.head = opts?.head
    return new PostgrestFilterBuilder<any[]>(s, this.exec)
  }

  insert(values: AnyRow | AnyRow[], opts?: { count?: 'exact' | 'planned' | 'estimated'; defaultToNull?: boolean }) {
    const s = this.base('insert')
    s.values = values
    s.count = opts?.count
    s.defaultToNull = opts?.defaultToNull
    return new PostgrestFilterBuilder<any>(s, this.exec)
  }

  upsert(
    values: AnyRow | AnyRow[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean; count?: 'exact' | 'planned' | 'estimated'; defaultToNull?: boolean }
  ) {
    const s = this.base('upsert')
    s.values = values
    s.onConflict = opts?.onConflict
    s.ignoreDuplicates = opts?.ignoreDuplicates
    s.count = opts?.count
    s.defaultToNull = opts?.defaultToNull
    return new PostgrestFilterBuilder<any>(s, this.exec)
  }

  update(values: AnyRow, opts?: { count?: 'exact' | 'planned' | 'estimated' }) {
    const s = this.base('update')
    s.values = values
    s.count = opts?.count
    return new PostgrestFilterBuilder<any>(s, this.exec)
  }

  delete(opts?: { count?: 'exact' | 'planned' | 'estimated' }) {
    const s = this.base('delete')
    s.count = opts?.count
    return new PostgrestFilterBuilder<any>(s, this.exec)
  }
}

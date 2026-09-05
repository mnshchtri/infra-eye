// ── Database tab (schema browser / data grid / SQL console) ──

export interface SchemaGroup {
  schema: string
  tables: string[]
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  default?: string
  primary_key: boolean
}

export interface TableRowsResponse {
  columns: string[]
  rows: Record<string, unknown>[]
  total: number
  limit: number
  offset: number
}

export interface SqlQueryResult {
  type: 'select' | 'exec'
  columns?: string[]
  rows?: Record<string, unknown>[]
  rows_affected?: number
}

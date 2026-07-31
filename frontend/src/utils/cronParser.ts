// Standard 5-field cron (minute hour day-of-month month day-of-week), the
// format used by Kubernetes CronJobs and traditional crontabs. No seconds
// field, no @yearly/@daily shorthands — those are easy to add later if needed.

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function namesToNumbers(field: string, names: string[], base: number): string {
  let out = field.toUpperCase()
  names.forEach((name, i) => {
    out = out.replace(new RegExp(name, 'g'), String(i + base))
  })
  return out
}

function parseField(raw: string, min: number, max: number, fieldLabel: string): number[] {
  const values = new Set<number>()
  for (const part of raw.split(',')) {
    const stepMatch = part.match(/^(\*|\d+-\d+|\d+)\/(\d+)$/)
    const rangeMatch = part.match(/^(\d+)-(\d+)$/)
    if (part === '*') {
      for (let v = min; v <= max; v++) values.add(v)
    } else if (stepMatch) {
      const [, base, stepStr] = stepMatch
      const step = parseInt(stepStr, 10)
      if (step <= 0) throw new Error(`Invalid step "${part}" in ${fieldLabel} field.`)
      let lo = min, hi = max
      if (base !== '*') {
        const rm = base.match(/^(\d+)-(\d+)$/)
        if (rm) { lo = parseInt(rm[1], 10); hi = parseInt(rm[2], 10) }
        else { lo = parseInt(base, 10); hi = max }
      }
      for (let v = lo; v <= hi; v += step) values.add(v)
    } else if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10)
      const hi = parseInt(rangeMatch[2], 10)
      for (let v = lo; v <= hi; v++) values.add(v)
    } else if (/^\d+$/.test(part)) {
      values.add(parseInt(part, 10))
    } else {
      throw new Error(`Can't parse "${part}" in ${fieldLabel} field.`)
    }
  }
  const out = [...values].filter(v => v >= min && v <= max)
  if (out.length === 0) throw new Error(`${fieldLabel} field "${raw}" produced no valid values (expected ${min}-${max}).`)
  for (const v of values) {
    if (v < min || v > max) throw new Error(`${fieldLabel} value ${v} is out of range (expected ${min}-${max}).`)
  }
  return [...new Set(out.map(v => (fieldLabel === 'day-of-week' && v === 7 ? 0 : v)))].sort((a, b) => a - b)
}

export interface CronFields {
  minute: number[]
  hour: number[]
  dayOfMonth: number[]
  month: number[]
  dayOfWeek: number[]
  dayOfMonthWildcard: boolean
  dayOfWeekWildcard: boolean
}

export interface CronParseResult {
  fields: CronFields
  description: string
  nextRuns: Date[]
  error?: string
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function describeList(values: number[], names?: string[], base = 0): string {
  const labels = values.map(v => (names ? names[v - base] : String(v)))
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

function isEveryN(values: number[], min: number, max: number): number | null {
  if (values.length < 2) return null
  const step = values[1] - values[0]
  if (step <= 0) return null
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== min + i * step) return null
  }
  const expectedCount = Math.floor((max - min) / step) + 1
  return values.length === expectedCount ? step : null
}

function describe(f: CronFields): string {
  const isFullRange = (values: number[], min: number, max: number) => values.length === max - min + 1

  let timePart: string
  const minuteStep = isEveryN(f.minute, 0, 59)
  const hourStep = isEveryN(f.hour, 0, 23)

  if (isFullRange(f.minute, 0, 59) && isFullRange(f.hour, 0, 23)) {
    timePart = 'Every minute'
  } else if (minuteStep && isFullRange(f.hour, 0, 23)) {
    timePart = `Every ${minuteStep} minutes`
  } else if (isFullRange(f.minute, 0, 59) && hourStep) {
    timePart = `Every minute, every ${hourStep} hours`
  } else if (f.minute.length === 1 && isFullRange(f.hour, 0, 23)) {
    timePart = `At minute ${f.minute[0]} of every hour`
  } else if (f.minute.length === 1 && hourStep) {
    timePart = `At minute ${f.minute[0]} past every ${hourStep} hours`
  } else if (f.minute.length === 1 && f.hour.length === 1) {
    timePart = `At ${pad(f.hour[0])}:${pad(f.minute[0])}`
  } else if (f.minute.length === 1 && f.hour.length > 1) {
    timePart = `At minute ${f.minute[0]} past hour ${describeList(f.hour)}`
  } else {
    timePart = `At minute ${describeList(f.minute)}, hour ${describeList(f.hour)}`
  }

  const parts = [timePart]
  if (!f.dayOfMonthWildcard) parts.push(`on day-of-month ${describeList(f.dayOfMonth)}`)
  if (!isFullRange(f.month, 1, 12)) parts.push(`in ${describeList(f.month, MONTH_NAMES, 1)}`)
  if (!f.dayOfWeekWildcard) parts.push(`on ${describeList(f.dayOfWeek, DOW_NAMES, 0)}`)

  return parts.join(', ')
}

function matches(date: Date, f: CronFields): boolean {
  // Standard cron OR semantics when both day-of-month and day-of-week are restricted.
  const domOk = f.dayOfMonth.includes(date.getUTCDate())
  const dowOk = f.dayOfWeek.includes(date.getUTCDay())
  const dayOk = f.dayOfMonthWildcard && f.dayOfWeekWildcard ? true
    : f.dayOfMonthWildcard ? dowOk
    : f.dayOfWeekWildcard ? domOk
    : domOk || dowOk

  return f.minute.includes(date.getUTCMinutes())
    && f.hour.includes(date.getUTCHours())
    && f.month.includes(date.getUTCMonth() + 1)
    && dayOk
}

function nextRuns(f: CronFields, from: Date, count: number): Date[] {
  const runs: Date[] = []
  const cursor = new Date(from)
  cursor.setUTCSeconds(0, 0)
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)

  const maxIterations = 4 * 366 * 24 * 60 // ~4 years of minutes
  for (let i = 0; i < maxIterations && runs.length < count; i++) {
    if (matches(cursor, f)) runs.push(new Date(cursor))
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)
  }
  return runs
}

export function parseCron(expression: string, now: Date = new Date(), runCount = 5): CronParseResult {
  const empty: CronFields = { minute: [], hour: [], dayOfMonth: [], month: [], dayOfWeek: [], dayOfMonthWildcard: true, dayOfWeekWildcard: true }

  const trimmed = expression.trim().replace(/\s+/g, ' ')
  const fields = trimmed.split(' ')
  if (fields.length !== 5) {
    return { fields: empty, description: '', nextRuns: [], error: `Expected 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}.` }
  }
  const [minuteRaw, hourRaw, domRaw, monthRaw, dowRaw] = fields

  try {
    const monthNormalized = namesToNumbers(monthRaw, MONTH_NAMES, 1)
    const dowNormalized = namesToNumbers(dowRaw, DOW_NAMES, 0)

    const parsed: CronFields = {
      minute: parseField(minuteRaw, 0, 59, 'minute'),
      hour: parseField(hourRaw, 0, 23, 'hour'),
      dayOfMonth: parseField(domRaw, 1, 31, 'day-of-month'),
      month: parseField(monthNormalized, 1, 12, 'month'),
      dayOfWeek: parseField(dowNormalized, 0, 7, 'day-of-week'),
      dayOfMonthWildcard: domRaw === '*',
      dayOfWeekWildcard: dowRaw === '*',
    }

    return {
      fields: parsed,
      description: describe(parsed),
      nextRuns: nextRuns(parsed, now, runCount),
    }
  } catch (e) {
    return { fields: empty, description: '', nextRuns: [], error: e instanceof Error ? e.message : 'Invalid cron expression.' }
  }
}

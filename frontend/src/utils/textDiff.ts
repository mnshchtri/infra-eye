// Classic O(n*m) LCS line diff. Simple and correct; guarded against pathological
// input sizes since it's O(n*m) time/space and runs synchronously on the main thread.

export interface DiffLine {
  type: 'equal' | 'add' | 'remove'
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface DiffResult {
  lines: DiffLine[]
  additions: number
  removals: number
  error?: string
}

function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const result: DiffLine[] = []
  let i = 0, j = 0, oldLine = 1, newLine = 1
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: 'equal', text: a[i], oldLine, newLine })
      i++; j++; oldLine++; newLine++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'remove', text: a[i], oldLine, newLine: null })
      i++; oldLine++
    } else {
      result.push({ type: 'add', text: b[j], oldLine: null, newLine })
      j++; newLine++
    }
  }
  while (i < n) { result.push({ type: 'remove', text: a[i], oldLine, newLine: null }); i++; oldLine++ }
  while (j < m) { result.push({ type: 'add', text: b[j], oldLine: null, newLine }); j++; newLine++ }
  return result
}

const MAX_CELLS = 4_000_000

export function computeDiff(oldText: string, newText: string): DiffResult {
  const aCount = oldText === '' ? 0 : oldText.split('\n').length
  const bCount = newText === '' ? 0 : newText.split('\n').length
  if (aCount * bCount > MAX_CELLS) {
    return { lines: [], additions: 0, removals: 0, error: 'Inputs are too large to diff in the browser — try under ~2000 lines on each side.' }
  }

  const lines = diffLines(oldText, newText)
  let additions = 0
  let removals = 0
  for (const l of lines) {
    if (l.type === 'add') additions++
    else if (l.type === 'remove') removals++
  }
  return { lines, additions, removals }
}

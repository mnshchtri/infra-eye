// Wails' embedded webview doesn't implement the browser's `<a download>`
// flow — a synthetic anchor click just silently no-ops instead of showing a
// save dialog. When running desktop-bundled (__IS_DESKTOP__), route through
// the native SaveFile bridge bound in backend/cmd/desktop/app.go, which
// drives a real OS "Save As" dialog and writes the bytes itself. Plain
// browser builds keep the anchor-click download they've always used.
declare global {
  interface Window {
    go?: {
      main?: {
        App?: {
          SaveFile?: (defaultFilename: string, base64Data: string) => Promise<string>
        }
      }
    }
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(blob)
  })
}

export type SaveFileResult = 'saved' | 'cancelled' | 'browser'

// Saves `blob` as `filename`. In the desktop app this opens a native save
// dialog and returns 'cancelled' if the user backs out of it (not an
// error); everywhere else it triggers the usual browser download.
export async function saveFile(blob: Blob, filename: string): Promise<SaveFileResult> {
  const bridge = window.go?.main?.App?.SaveFile
  if (__IS_DESKTOP__ && bridge) {
    const base64 = await blobToBase64(blob)
    const path = await bridge(filename, base64)
    return path ? 'saved' : 'cancelled'
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return 'browser'
}

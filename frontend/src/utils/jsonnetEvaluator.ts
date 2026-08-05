// Evaluates Jsonnet — the language Tanka (https://grafana.com/oss/tanka/)
// uses for Kubernetes config — entirely client-side via a WASM build of
// go-jsonnet (see tools/jsonnet-wasm/). Loaded lazily so the ~2MB (gzipped)
// binary is only fetched when the Jsonnet tool tab is opened.

declare global {
  interface Window {
    Go: new () => {
      importObject: WebAssembly.Imports
      run: (instance: WebAssembly.Instance) => Promise<void>
    }
    jsonnetEvaluate?: (snippet: string) => { output: string; error: string | null }
  }
}

let readyPromise: Promise<void> | null = null

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(script)
  })
}

async function ensureReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (!window.Go) await loadScript('/wasm/wasm_exec.js')
      const go = new window.Go()
      const { instance } = await WebAssembly.instantiateStreaming(fetch('/wasm/jsonnet.wasm'), go.importObject)
      // go.run()'s promise only resolves when the Go program exits, which never
      // happens — main() blocks on select{} forever to keep jsonnetEvaluate
      // callable. Don't await it; instead poll for the export it registers
      // synchronously before hitting that block.
      go.run(instance).catch(() => { /* program is expected to run indefinitely */ })
      for (let i = 0; i < 200 && !window.jsonnetEvaluate; i++) {
        await new Promise(r => setTimeout(r, 10))
      }
      if (!window.jsonnetEvaluate) throw new Error('Jsonnet evaluator failed to initialize.')
    })()
  }
  return readyPromise
}

export interface JsonnetResult {
  output: string
  error: string | null
}

export async function evaluateJsonnet(snippet: string): Promise<JsonnetResult> {
  try {
    await ensureReady()
  } catch (e) {
    readyPromise = null // allow a retry on the next call instead of failing forever
    throw e
  }
  if (!window.jsonnetEvaluate) throw new Error('Jsonnet evaluator failed to initialize.')
  return window.jsonnetEvaluate(snippet)
}

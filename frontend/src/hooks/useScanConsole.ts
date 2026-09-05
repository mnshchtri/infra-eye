import { useCallback, useEffect, useRef, useState } from 'react'
import { buildWsUrl } from '../api/client'

/**
 * Live console output for a running scan, keyed by target id — a Code
 * Security repo or a DAST target. Opens one WebSocket per running scan
 * (see handlers/codeaudit.go's CodeScanLogWS/DastScanLogWS), collecting
 * "log" messages into `logs[id]` as they arrive so a Jenkins-style console
 * can render live instead of leaving the user staring at a bare spinner
 * while CodeQL or a Docker ZAP pull runs for minutes.
 *
 * connect() resolves once the socket is open (or after a short timeout, so
 * a stalled connection never blocks the scan itself) — call it and await it
 * before firing the scan's POST request, so the earliest lines aren't
 * missed: this is a live broadcast, not a buffered replay.
 */
export function useScanConsole() {
  const [logs, setLogs] = useState<Record<number, string[]>>({})
  const sockets = useRef<Record<number, WebSocket>>({})

  const connect = useCallback((id: number, path: string): Promise<void> => {
    return new Promise(resolve => {
      sockets.current[id]?.close()
      setLogs(prev => ({ ...prev, [id]: [] }))
      const socket = new WebSocket(buildWsUrl(path))
      sockets.current[id] = socket
      let settled = false
      const settle = () => {
        if (!settled) { settled = true; resolve() }
      }
      socket.onopen = settle
      socket.onerror = settle
      socket.onmessage = event => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'log' && typeof msg.payload?.line === 'string') {
            setLogs(prev => ({ ...prev, [id]: [...(prev[id] || []), msg.payload.line] }))
          }
        } catch {
          // Ignore a malformed frame rather than tearing down a live console.
        }
      }
      setTimeout(settle, 1500)
    })
  }, [])

  const disconnect = useCallback((id: number) => {
    sockets.current[id]?.close()
    delete sockets.current[id]
  }, [])

  useEffect(() => {
    const all = sockets.current
    return () => { Object.values(all).forEach(s => s.close()) }
  }, [])

  return { logs, connect, disconnect }
}

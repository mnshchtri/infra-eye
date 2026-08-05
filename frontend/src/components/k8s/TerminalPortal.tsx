import React, { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, X, Maximize2, Minimize2, GripHorizontal } from 'lucide-react'
import { buildWsUrl } from '../../api/client'
import '@xterm/xterm/css/xterm.css'

interface TerminalPortalProps {
  serverID: number;
  mode: 'logs' | 'shell';
  target?: 'pod' | 'node';
  pod?: string;
  namespace?: string;
  container?: string;
  node?: string;
  onClose: () => void;
}

const DEFAULT_HEIGHT = 380
const MIN_HEIGHT = 200

export function TerminalPortal({ serverID, pod, namespace, container, node, target = 'pod', mode, onClose }: TerminalPortalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [fullscreen, setFullscreen] = useState(false)
  const draggingRef = useRef(false)

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      theme: { background: '#0f172a', foreground: '#cbd5e1' },
      fontSize: 13,
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", monospace'
    })
    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    fitAddon.fit()

    const wsPath = target === 'node'
      ? `/ws/servers/${serverID}/kubectl/node-terminal?${new URLSearchParams({ node: node! }).toString()}`
      : (() => {
          const params = new URLSearchParams({ pod: pod!, namespace: namespace!, mode })
          if (container) params.set('container', container)
          return `/ws/servers/${serverID}/kubectl/pod-terminal?${params.toString()}`
        })()

    const ws = new WebSocket(buildWsUrl(wsPath))

    ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') { term.write(ev.data) }
        else { ev.data.arrayBuffer().then((buf: any) => term.write(new Uint8Array(buf))) }
    }

    ws.onerror = () => {
      term.writeln(`\r\n[infra-eye] websocket error while opening ${target} stream.\r\n`)
    }

    ws.onclose = () => {
      term.writeln(`\r\n[infra-eye] ${target} stream closed.\r\n`)
    }

    if (mode === 'shell') {
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data)
        }
      })
    }

    const handleResize = () => fitAddon.fit()
    window.addEventListener('resize', handleResize)

    // Catches size changes from dragging the panel or toggling fullscreen —
    // window 'resize' alone doesn't fire for those since the viewport itself
    // hasn't changed.
    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(terminalRef.current)

    return () => {
      ws.close();
      term.dispose();
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
    }
  }, [serverID, pod, namespace, container, node, target, mode])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      const next = window.innerHeight - e.clientY
      setHeight(Math.min(Math.max(next, MIN_HEIGHT), window.innerHeight - 80))
    }
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const startDrag = (e: React.MouseEvent) => {
    if (fullscreen) return
    e.preventDefault()
    draggingRef.current = true
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div className="fade-up" style={{
      position: 'fixed', left: 0, right: 0, bottom: 0,
      height: fullscreen ? '100vh' : height,
      background: '#fff', borderTop: '1px solid var(--border)', zIndex: 1200,
      display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)',
    }}>
       {!fullscreen && (
         <div
           onMouseDown={startDrag}
           title="Drag to resize"
           style={{
             height: 10, marginTop: -5, cursor: 'ns-resize', display: 'flex',
             alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 1,
           }}
         >
           <GripHorizontal size={14} color="var(--text-muted)" />
         </div>
       )}
       <div style={{ height: 46, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: '#f8fafc', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
             <Terminal size={14} color="var(--brand-primary)" />
             <span style={{ fontSize: 13, fontWeight: 700 }}>
               {target === 'node' ? `NODE SHELL • ${node}` : `POD ${mode.toUpperCase()} • ${namespace}/${pod}`}
             </span>
             <span className="badge badge-online" style={{ fontSize: 12 }}>LIVE</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Esc to close</span>
            <button onClick={() => setFullscreen(f => !f)} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {fullscreen ? <Minimize2 size={15} color="var(--text-muted)" /> : <Maximize2 size={15} color="var(--text-muted)" />}
            </button>
            <button onClick={onClose} title="Close"><X size={16} color="var(--text-muted)" /></button>
          </div>
       </div>
       <div ref={terminalRef} style={{ flex: 1, padding: 10, background: '#0f172a', minHeight: 0 }} />
    </div>
  )
}

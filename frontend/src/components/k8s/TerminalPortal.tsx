import React, { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, X, Maximize2, Minimize2, GripHorizontal } from 'lucide-react'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
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
        else { ev.data.arrayBuffer().then((buf: ArrayBuffer) => term.write(new Uint8Array(buf))) }
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
    <Paper
      square
      elevation={8}
      sx={{
        position: 'fixed', left: 0, right: 0, bottom: 0,
        height: fullscreen ? '100vh' : height,
        borderTop: 1, borderColor: 'divider', zIndex: (t) => t.zIndex.drawer + 2,
        display: 'flex', flexDirection: 'column',
      }}
    >
      {!fullscreen && (
        <Box
          onMouseDown={startDrag}
          title="Drag to resize"
          sx={{ height: 10, mt: '-5px', cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 1, color: 'text.secondary' }}
        >
          <GripHorizontal size={14} />
        </Box>
      )}
      <Box sx={{ height: 46, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <Terminal size={14} />
          <Typography variant="subtitle2">
            {target === 'node' ? `Node shell • ${node}` : `Pod ${mode} • ${namespace}/${pod}`}
          </Typography>
          <Chip size="small" color="success" label="Live" />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>Esc to close</Typography>
          <Tooltip title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            <IconButton size="small" onClick={() => setFullscreen(f => !f)} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Close">
            <IconButton size="small" onClick={onClose} aria-label="Close terminal"><X size={16} /></IconButton>
          </Tooltip>
        </Box>
      </Box>
      <div ref={terminalRef} style={{ flex: 1, padding: 10, background: '#0f172a', minHeight: 0 }} />
    </Paper>
  )
}

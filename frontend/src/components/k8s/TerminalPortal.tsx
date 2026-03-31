import React, { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, X } from 'lucide-react'
import { buildWsUrl } from '../../api/client'
import '@xterm/xterm/css/xterm.css'

interface TerminalPortalProps {
  serverID: number;
  pod: string;
  namespace: string;
  container?: string;
  mode: 'logs' | 'shell';
  onClose: () => void;
}

export function TerminalPortal({ serverID, pod, namespace, container, mode, onClose }: TerminalPortalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({ 
      theme: { background: '#0f172a', foreground: '#cbd5e1' }, 
      fontSize: 13, 
      fontFamily: '"JetBrains Mono", monospace' 
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    fitAddon.fit()

    const params = new URLSearchParams({
      pod,
      namespace,
      mode,
    })
    if (container) params.set('container', container)
    
    const ws = new WebSocket(buildWsUrl(`/ws/servers/${serverID}/kubectl/pod-terminal?${params.toString()}`))
    
    ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') { term.write(ev.data) }
        else { ev.data.arrayBuffer().then((buf: any) => term.write(new Uint8Array(buf))) }
    }
    
    ws.onerror = () => {
      term.writeln('\r\n[infra-eye] websocket error while opening pod stream.\r\n')
    }
    
    ws.onclose = () => {
      term.writeln('\r\n[infra-eye] pod stream closed.\r\n')
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

    return () => { 
      ws.close(); 
      term.dispose(); 
      window.removeEventListener('resize', handleResize)
    }
  }, [serverID, pod, namespace, container, mode])

  return (
    <div className="fade-up" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: '38vh', minHeight: 260, maxHeight: '60vh', background: '#fff', borderTop: '1px solid var(--border)', zIndex: 1200, display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
       <div style={{ height: 46, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: '#f8fafc' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
             <Terminal size={14} color="var(--brand-primary)" />
             <span style={{ fontSize: 12, fontWeight: 700 }}>POD {mode.toUpperCase()} • {namespace}/{pod}</span>
             <span className="badge badge-online" style={{ fontSize: 10 }}>LIVE</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Esc to close</span>
            <button onClick={onClose}><X size={16} color="var(--text-muted)" /></button>
          </div>
       </div>
       <div ref={terminalRef} style={{ flex: 1, padding: 10, background: '#0f172a' }} />
    </div>
  )
}

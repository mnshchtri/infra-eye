import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { X } from 'lucide-react'
import { Badge } from '../ui'
import type { AgentStep } from '../../pages/agentTypes'
import { kindMeta, nodeColor } from './agentFlowMeta'

function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

const markdownComponents: Components = {
  p: ({ children }) => <p style={{ margin: '0 0 10px' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: '0 0 10px', paddingLeft: 20, listStyleType: 'disc', color: 'var(--text-secondary)' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 10px', paddingLeft: 20, listStyleType: 'decimal', color: 'var(--text-secondary)' }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 5, lineHeight: 1.6, paddingLeft: 2 }}>{children}</li>,
  h1: ({ children }) => <h1 style={{ fontSize: 15, fontWeight: 800, margin: '16px 0 8px', color: 'var(--text-primary)' }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontSize: 14, fontWeight: 800, margin: '16px 0 8px', color: 'var(--text-primary)' }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontSize: 13, fontWeight: 700, margin: '14px 0 6px', color: 'var(--text-primary)' }}>{children}</h3>,
  h4: ({ children }) => <h4 style={{ fontSize: 12.5, fontWeight: 700, margin: '12px 0 6px', color: 'var(--text-primary)' }}>{children}</h4>,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0' }} />,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand-primary)', textDecoration: 'none', fontWeight: 600 }}>{children}</a>,
  blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid var(--brand-primary)', margin: '10px 0', color: 'var(--text-secondary)', background: 'var(--bg-elevated)', padding: '8px 12px', borderRadius: '0 var(--radius-md) var(--radius-md) 0' }}>{children}</blockquote>,
  strong: ({ children }) => <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>,
  code: ({ children, className }) => {
    const isInline = !className
    return isInline ? (
      <code style={{
        background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4,
        fontFamily: 'var(--font-mono, monospace)', fontSize: 12, color: 'var(--text-primary)',
        fontWeight: 700, border: '1px solid var(--border)', overflowWrap: 'anywhere',
      }}>{children}</code>
    ) : (
      <code style={{ fontFamily: 'var(--font-mono, monospace)' }}>{children}</code>
    )
  },
  pre: ({ children }) => (
    <pre style={{
      margin: '0 0 10px', padding: '10px 12px', background: 'var(--bg-elevated)',
      borderRadius: 'var(--radius-md)', overflowX: 'auto', fontSize: 11.5,
      fontFamily: 'var(--font-mono, monospace)', border: '1px solid var(--border)',
    }}>{children}</pre>
  ),
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '0 0 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
      <table style={{ margin: 0, borderCollapse: 'collapse', width: '100%' }}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid var(--border)', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{children}</th>,
  td: ({ children }) => <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)', verticalAlign: 'top' }}>{children}</td>,
}

interface StepInspectorProps {
  step: AgentStep
  onClose: () => void
}

export function StepInspector({ step, onClose }: StepInspectorProps) {
  const color = nodeColor(step)
  const meta = kindMeta(step.kind)
  const isFinal = step.kind === 'final_answer'

  return (
    <div
      className="fade-up"
      style={{
        position: 'absolute', top: 14, right: 14, bottom: 14, width: 380, maxWidth: 'calc(100% - 28px)',
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 20,
      }}
    >
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>STEP {step.step_number}</div>
          <div style={{ fontSize: 14, fontWeight: 800, color, marginTop: 2 }}>{meta.label}</div>
          {step.tool_name && <code style={{ fontSize: 11.5, color: 'var(--text-secondary)', background: 'var(--bg-elevated)', padding: '2px 7px', borderRadius: 6, marginTop: 6, display: 'inline-block' }}>{step.tool_name}</code>}
        </div>
        <button onClick={onClose} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 6, cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}>
          <X size={14} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {step.status === 'pending_approval' && <Badge variant="warning" dot>Awaiting approval — use the node's Approve / Reject buttons</Badge>}
        {step.status === 'rejected' && <Badge variant="neutral">Rejected</Badge>}

        {!isFinal && step.reasoning && (
          <div className="markdown-body" style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{step.reasoning}</Markdown>
          </div>
        )}

        {isFinal && (
          <div className="markdown-body" style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.6 }}>
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{step.reasoning}</Markdown>
          </div>
        )}

        {step.tool_args && (
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 5 }}>ARGUMENTS</div>
            <pre style={{ margin: 0, padding: '9px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', fontSize: 11.5, color: 'var(--text-secondary)', overflowX: 'auto', fontFamily: 'var(--font-mono, monospace)' }}>
              {prettyArgs(step.tool_args)}
            </pre>
          </div>
        )}

        {step.status === 'executed' && step.output && (
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 5 }}>OUTPUT</div>
            <pre style={{ margin: 0, padding: '9px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', fontSize: 11.5, color: 'var(--text-primary)', overflowX: 'auto', maxHeight: 320, overflowY: 'auto', fontFamily: 'var(--font-mono, monospace)' }}>
              {step.output}
            </pre>
          </div>
        )}

        {step.status === 'failed' && step.error_text && (
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--danger)', letterSpacing: '0.05em', marginBottom: 5 }}>ERROR</div>
            <pre style={{ margin: 0, padding: '9px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', fontSize: 11.5, color: 'var(--danger)', overflowX: 'auto', maxHeight: 320, overflowY: 'auto', fontFamily: 'var(--font-mono, monospace)' }}>
              {step.error_text}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useToastStore, type Toast } from '../store/toastStore'

const TOAST_CONFIG = {
  success: {
    icon: CheckCircle2,
    color: '#10b981',
    bg: 'rgba(16,185,129,0.08)',
    border: 'rgba(16,185,129,0.2)',
  },
  error: {
    icon: XCircle,
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.2)',
  },
  warning: {
    icon: AlertTriangle,
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.2)',
  },
  info: {
    icon: Info,
    color: '#6366f1',
    bg: 'rgba(99,102,241,0.08)',
    border: 'rgba(99,102,241,0.2)',
  },
}

function ToastItem({ toast }: { toast: Toast }) {
  const remove = useToastStore((s: any) => s.remove)
  const config = TOAST_CONFIG[toast.type] || TOAST_CONFIG.info
  const Icon = config.icon
  const progressRef = useRef<HTMLDivElement>(null)
  const duration = toast.duration ?? (toast.type === 'error' ? 8000 : 4000)

  useEffect(() => {
    const el = progressRef.current
    if (!el) return
    el.style.transition = 'none'
    el.style.width = '100%'
    // Trigger reflow
    void el.offsetWidth
    el.style.transition = `width ${duration}ms linear`
    el.style.width = '0%'
  }, [duration])

  return (
    <div
      className="toast-item"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '14px 16px',
        background: 'var(--bg-card)',
        border: `1px solid ${config.border}`,
        borderLeft: `4px solid ${config.color}`,
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        minWidth: 300,
        maxWidth: 400,
        position: 'relative',
        overflow: 'hidden',
        animation: 'toast-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: config.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={16} color={config.color} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--text-primary)',
            lineHeight: 1.3,
          }}
        >
          {toast.title}
        </div>
        {toast.message && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              marginTop: 3,
              lineHeight: 1.4,
            }}
          >
            {toast.message}
          </div>
        )}
      </div>

      <button
        onClick={() => remove(toast.id)}
        style={{
          width: 24,
          height: 24,
          borderRadius: 7,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = 'var(--bg-elevated)')
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = 'transparent')
        }
      >
        <X size={12} />
      </button>

      {/* Progress bar */}
      <div
        ref={progressRef}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: 2,
          background: config.color,
          opacity: 0.5,
          width: '100%',
        }}
      />
    </div>
  )
}

export function ToastContainer() {
  const toasts = useToastStore((s: any) => s.toasts as Toast[])

  return (
    <>
      <div
        style={{
          position: 'fixed',
          bottom: 28,
          right: 28,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          alignItems: 'flex-end',
        }}
      >
        {toasts.map((t: Toast) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>

      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(24px) scale(0.96); }
          to   { opacity: 1; transform: translateX(0)    scale(1); }
        }
      `}</style>
    </>
  )
}

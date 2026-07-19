import React, { memo, useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Trash2, Plus, MessageSquare } from 'lucide-react'

interface ChatThread {
  id: number
  title: string
  created_at: string
  updated_at: string
}

interface ThreadSidebarProps {
  threads: ChatThread[];
  activeThreadId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onDelete: (id: number, e: React.MouseEvent) => void;
  isCollapsed: boolean;
  onToggle: (v: boolean) => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (isNaN(diff) || diff < 0) return ''
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export const ThreadSidebar = memo(({
  threads, activeThreadId, onSelect, onNew, onDelete, isCollapsed, onToggle,
}: ThreadSidebarProps) => {
  const [width, setWidth] = useState(280)
  const [isResizing, setIsResizing] = useState(false)

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => {
    setIsResizing(false)
  }, [])

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX
      if (newWidth > 180 && newWidth < 600) {
        setWidth(newWidth)
      }
    }
  }, [isResizing])

  useEffect(() => {
    window.addEventListener('mousemove', resize)
    window.addEventListener('mouseup', stopResizing)
    return () => {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [resize, stopResizing])

  const sidebarWidth = isCollapsed ? 64 : width

  return (
    <div
      className={`ai-sidebar ${isCollapsed ? 'collapsed' : ''}`}
      style={{
        width: sidebarWidth,
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-sidebar)', display: 'flex', flexDirection: 'column',
        flexShrink: 0, transition: isResizing ? 'none' : 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
        position: 'relative',
        zIndex: 100,
      }}
    >
      {/* Mobile Close Button */}
      {!isCollapsed && (
        <button
          className="show-mobile-only btn-icon"
          onClick={() => onToggle(true)}
          style={{ position: 'absolute', right: 12, top: 28, zIndex: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          <X size={16} />
        </button>
      )}
      {/* Resizer Handle */}
      {!isCollapsed && (
        <div
          onMouseDown={startResizing}
          style={{
            position: 'absolute', right: 0, top: 0, bottom: 0, width: 4,
            cursor: 'col-resize', zIndex: 10,
            background: isResizing ? 'var(--brand-primary)' : 'transparent',
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => !isResizing && (e.currentTarget.style.background = 'var(--border-bright)')}
          onMouseLeave={e => !isResizing && (e.currentTarget.style.background = 'transparent')}
        />
      )}

      <div style={{
        padding: '20px 14px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        alignItems: isCollapsed ? 'center' : 'stretch',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          alignItems: 'center',
          gap: 8,
        }}>
          {!isCollapsed ? (
            <>
              <button
                onClick={onNew}
                style={{
                  flex: 1, height: 40, borderRadius: 'var(--radius-md)',
                  background: 'var(--brand-primary)', border: 'none',
                  color: 'var(--text-inverse)', fontSize: 12.5, fontWeight: 800,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'filter 0.1s',
                  padding: '0 14px',
                }}
                onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                onMouseLeave={e => e.currentTarget.style.filter = 'none'}
              >
                <Plus size={15} strokeWidth={3} />
                <span>New conversation</span>
              </button>
              <button
                onClick={() => onToggle(true)}
                title="Collapse sidebar"
                style={{
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  padding: 6, borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  color: 'var(--text-muted)', flexShrink: 0,
                }}
              >
                <ChevronLeft size={16} />
              </button>
            </>
          ) : (
            <button
              onClick={onNew}
              title="New conversation"
              style={{
                width: 40, height: 40, borderRadius: 'var(--radius-md)',
                background: 'var(--brand-primary)', border: 'none',
                color: 'var(--text-inverse)', cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Plus size={18} strokeWidth={3} />
            </button>
          )}
        </div>

        {isCollapsed && (
          <button
            onClick={() => onToggle(false)}
            title="Expand sidebar"
            style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', padding: 6, cursor: 'pointer', color: 'var(--text-muted)',
            }}
          >
            <ChevronRight size={16} />
          </button>
        )}

        {!isCollapsed && threads.length > 0 && (
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', padding: '0 4px' }}>
            Conversations
          </div>
        )}
      </div>

      <div style={{
        flex: 1, overflowY: 'auto', padding: isCollapsed ? '0 8px' : '0 10px 20px',
        display: 'flex', flexDirection: 'column', gap: 3,
      }}>
        {!isCollapsed && threads.length === 0 && (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <MessageSquare size={22} style={{ opacity: 0.4, marginBottom: 8 }} />
            <div style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.5 }}>No conversations yet — ask Netra something to start one.</div>
          </div>
        )}
        {threads.map(t => (
          <div
            key={t.id}
            onClick={() => onSelect(t.id)}
            title={isCollapsed ? t.title : undefined}
            className="ai-thread-item"
            style={{
              padding: isCollapsed ? '12px 0' : '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              display: 'flex', alignItems: 'center',
              background: activeThreadId === t.id ? 'var(--bg-elevated)' : 'transparent',
              boxShadow: activeThreadId === t.id ? 'inset 2px 0 0 var(--brand-primary)' : 'none',
              transition: 'background 0.15s',
              justifyContent: isCollapsed ? 'center' : 'space-between',
              gap: 8,
              position: 'relative',
              overflow: 'hidden',
            }}
            onMouseEnter={e => { if (activeThreadId !== t.id) e.currentTarget.style.background = 'var(--bg-elevated)' }}
            onMouseLeave={e => { if (activeThreadId !== t.id) e.currentTarget.style.background = 'transparent' }}
          >
            {!isCollapsed ? (
              <>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 12.5, color: activeThreadId === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: activeThreadId === t.id ? 700 : 600,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {t.title}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>
                    {timeAgo(t.updated_at)}
                  </div>
                </div>
                <button
                  onClick={(e) => onDelete(t.id, e)}
                  title="Delete conversation"
                  style={{
                    background: 'none', border: 'none', padding: 4, cursor: 'pointer',
                    color: 'var(--text-muted)', visibility: activeThreadId === t.id ? 'visible' : 'hidden',
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                >
                  <Trash2 size={13} />
                </button>
              </>
            ) : (
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: activeThreadId === t.id ? 'var(--brand-primary)' : 'var(--border-bright)',
              }} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
})

ThreadSidebar.displayName = 'ThreadSidebar'

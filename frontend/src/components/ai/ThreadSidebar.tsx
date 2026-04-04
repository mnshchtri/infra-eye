import React, { memo, useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Trash2, Plus } from 'lucide-react'

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

export const ThreadSidebar = memo(({ 
  threads, activeThreadId, onSelect, onNew, onDelete, isCollapsed, onToggle 
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
        zIndex: 100
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
            transition: 'background 0.2s'
          }}
          onMouseEnter={e => !isResizing && (e.currentTarget.style.background = 'var(--border-bright)')}
          onMouseLeave={e => !isResizing && (e.currentTarget.style.background = 'transparent')}
        />
      )}

      <div style={{ 
        padding: '24px 16px', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: 20,
        alignItems: isCollapsed ? 'center' : 'stretch'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: isCollapsed ? 'center' : 'space-between', 
          alignItems: 'center',
          height: 48
        }}>
            {!isCollapsed && (
              <button
                onClick={onNew}
                style={{
                  flex: 1, height: 42, borderRadius: 0,
                  background: 'var(--brand-primary)', border: 'none',
                  color: 'var(--text-inverse)', fontSize: 11, fontWeight: 900,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                  transition: 'all 0.1s',
                  padding: '0 16px',
                  fontFamily: 'var(--font-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}
                onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                onMouseLeave={e => e.currentTarget.style.filter = 'none'}
              >
                <Plus size={16} strokeWidth={3} />
                <span>New Session</span>
              </button>
            )}

            {isCollapsed && (
              <button
                onClick={onNew}
                title="New Session"
                style={{
                  width: 42, height: 42, borderRadius: 0,
                  background: 'var(--brand-primary)', border: 'none',
                  color: 'var(--text-inverse)', cursor: 'pointer', display: 'flex', 
                  alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.1s'
                }}
              >
                <Plus size={18} strokeWidth={3} />
              </button>
            )}

           {!isCollapsed && (
             <button
               onClick={() => onToggle(true)}
               title="Collapse Sidebar"
               style={{
                 background: 'var(--bg-elevated)', border: '1px solid var(--border)', 
                 padding: 6, borderRadius: 8, cursor: 'pointer',
                 color: 'var(--text-muted)', marginLeft: 8
               }}
             >
               <ChevronLeft size={16} />
             </button>
           )}
        </div>
        
        {isCollapsed && (
          <button
             onClick={() => onToggle(false)}
             title="Expand Sidebar"
             style={{
               background: 'var(--bg-elevated)', border: '1px solid var(--border)', 
               borderRadius: 8, padding: 6, cursor: 'pointer', color: 'var(--text-muted)'
             }}
          >
             <ChevronRight size={16} />
          </button>
        )}
      </div>

      <div style={{ 
        flex: 1, overflowY: 'auto', padding: isCollapsed ? '0 8px' : '0 12px 20px',
        display: 'flex', flexDirection: 'column', gap: 4
      }}>
        {threads.map(t => (
          <div
            key={t.id}
            onClick={() => onSelect(t.id)}
            title={isCollapsed ? t.title : undefined}
            style={{
              padding: '12px 16px', borderRadius: 0, cursor: 'pointer',
              display: 'flex', alignItems: 'center',
              background: activeThreadId === t.id ? 'var(--bg-elevated)' : 'transparent',
              borderLeft: `2px solid ${activeThreadId === t.id ? 'var(--brand-primary)' : 'transparent'}`,
              transition: 'all 0.15s',
              height: 44,
              justifyContent: isCollapsed ? 'center' : 'space-between',
              position: 'relative',
              overflow: 'hidden'
            }}
          >

            {!isCollapsed && (
              <div style={{ 
                fontSize: 10, color: activeThreadId === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: activeThreadId === t.id ? 900 : 700,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
                fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em'
              }}>
                {t.title}
              </div>
            )}
            
            {isCollapsed && (
              <div style={{ 
                 width: 8, height: 8, borderRadius: '50%',
                 background: activeThreadId === t.id ? 'var(--brand-primary)' : 'var(--border-bright)'
              }} />
            )}
            
            {!isCollapsed && (
              <button
                onClick={(e) => onDelete(t.id, e)}
                style={{
                  background: 'none', border: 'none', padding: 4, cursor: 'pointer',
                  color: 'var(--text-muted)', visibility: activeThreadId === t.id ? 'visible' : 'hidden',
                  hover: { color: 'var(--danger)' }
                } as any}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})

ThreadSidebar.displayName = 'ThreadSidebar'

ThreadSidebar.displayName = 'ThreadSidebar'

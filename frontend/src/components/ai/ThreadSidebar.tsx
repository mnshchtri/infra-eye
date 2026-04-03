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
        borderRight: '1px solid var(--border-subtle)',
        background: 'var(--bg-app)', display: 'flex', flexDirection: 'column',
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
                 flex: 1, height: 40, borderRadius: 10,
                 background: 'var(--brand-primary)', border: 'none',
                 color: '#fff', fontSize: 13, fontWeight: 700,
                 cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                 transition: 'all 0.2s', boxShadow: '0 4px 12px var(--brand-glow)',
                 padding: '0 12px'
               }}
               onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
               onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
             >
               <Plus size={16} strokeWidth={3} />
               <span>New Analysis</span>
             </button>
           )}

           {isCollapsed && (
             <button
               onClick={onNew}
               title="New Analysis"
               style={{
                 width: 40, height: 40, borderRadius: 10,
                 background: 'var(--brand-primary)', border: 'none',
                 color: '#fff', cursor: 'pointer', display: 'flex', 
                 alignItems: 'center', justifyContent: 'center',
                 transition: 'all 0.2s', boxShadow: '0 4px 12px var(--brand-glow)'
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
              padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
              display: 'flex', alignItems: 'center',
              background: activeThreadId === t.id ? 'var(--bg-card)' : 'transparent',
              border: '1px solid',
              borderColor: activeThreadId === t.id ? 'var(--border-bright)' : 'transparent',
              transition: 'all 0.2s',
              height: 42,
              justifyContent: isCollapsed ? 'center' : 'space-between',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
             {activeThreadId === t.id && (
               <div style={{
                 position: 'absolute', left: 0, top: '20%', bottom: '20%', width: 3,
                 background: 'var(--brand-primary)', borderRadius: '0 4px 4px 0'
               }} />
             )}

            {!isCollapsed && (
              <div style={{ 
                fontSize: 13, color: activeThreadId === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: activeThreadId === t.id ? 700 : 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
                paddingLeft: 4
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

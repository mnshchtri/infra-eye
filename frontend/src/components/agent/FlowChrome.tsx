import { Background, BackgroundVariant, Panel, useReactFlow, useStore } from '@xyflow/react'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'

// Shared canvas chrome for the Agent node-graphs (LauncherFlowCanvas,
// AgentFlowCanvas), matching the Infra Map blueprint's visual language:
// a fine line-grid backdrop, a zoom control card with a live percentage
// readout, and a pan/zoom hint tag — so every node-graph in the app reads
// as one consistent system rather than two different canvas styles.

// Same 40px spacing as Infra Map's SVG grid pattern.
export function FlowBlueprintBackground() {
  return (
    <Background
      variant={BackgroundVariant.Lines}
      gap={40}
      lineWidth={1}
      color="var(--border-light)"
    />
  )
}

export function FlowZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const zoom = useStore(s => s.transform[2])

  return (
    <Panel position="bottom-right" style={{ margin: 12 }}>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 4,
      }}>
        <button className="sidebar-toggle-btn" onClick={() => zoomIn({ duration: 150 })} title="Zoom in">
          <ZoomIn size={14} />
        </button>
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', padding: '1px 0' }}>
          {Math.round(zoom * 100)}%
        </div>
        <button className="sidebar-toggle-btn" onClick={() => zoomOut({ duration: 150 })} title="Zoom out">
          <ZoomOut size={14} />
        </button>
        <button className="sidebar-toggle-btn" onClick={() => fitView({ padding: 0.25, duration: 300, maxZoom: 1 })} title="Fit to view">
          <Maximize size={14} />
        </button>
      </div>
    </Panel>
  )
}

export function FlowPanHint() {
  return (
    <Panel position="bottom-left" style={{ margin: 12 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px',
        pointerEvents: 'none', opacity: 0.75,
      }}>
        drag to pan · scroll or pinch to zoom
      </div>
    </Panel>
  )
}

import { Background, BackgroundVariant, Panel, useReactFlow, useStore } from '@xyflow/react'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import { Box, IconButton, Paper, Tooltip, Typography, useTheme } from '@mui/material'

// Shared canvas chrome for the Agent node-graphs (LauncherFlowCanvas,
// AgentFlowCanvas), matching the Infra Map blueprint's visual language:
// a fine line-grid backdrop, a zoom control card with a live percentage
// readout, and a pan/zoom hint tag.

// Same 40px spacing as Infra Map's SVG grid pattern.
export function FlowBlueprintBackground() {
  const theme = useTheme()
  return (
    <Background
      variant={BackgroundVariant.Lines}
      gap={40}
      lineWidth={1}
      color={theme.palette.divider}
    />
  )
}

export function FlowZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const zoom = useStore(s => s.transform[2])

  return (
    <Panel position="bottom-right" style={{ margin: 12 }}>
      <Paper variant="outlined" sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, p: 0.5, alignItems: 'center' }}>
        <Tooltip title="Zoom in" placement="left">
          <IconButton aria-label="Zoom in" onClick={() => zoomIn({ duration: 150 })}><ZoomIn size={14} /></IconButton>
        </Tooltip>
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
          {Math.round(zoom * 100)}%
        </Typography>
        <Tooltip title="Zoom out" placement="left">
          <IconButton aria-label="Zoom out" onClick={() => zoomOut({ duration: 150 })}><ZoomOut size={14} /></IconButton>
        </Tooltip>
        <Tooltip title="Fit to view" placement="left">
          <IconButton aria-label="Fit to view" onClick={() => fitView({ padding: 0.25, duration: 300, maxZoom: 1 })}><Maximize size={14} /></IconButton>
        </Tooltip>
      </Paper>
    </Panel>
  )
}

export function FlowPanHint() {
  return (
    <Panel position="bottom-left" style={{ margin: 12 }}>
      <Box sx={{
        fontSize: 11, color: 'text.secondary', bgcolor: 'background.paper', border: 1, borderColor: 'divider',
        borderRadius: 1, px: 1, py: 0.5, pointerEvents: 'none', opacity: 0.85,
      }}>
        Drag to pan · scroll or pinch to zoom
      </Box>
    </Panel>
  )
}

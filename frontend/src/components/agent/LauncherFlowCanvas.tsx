import { useEffect, useMemo } from 'react'
import {
  ReactFlow, ReactFlowProvider, useReactFlow, type Node, type Edge, type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ServerConfigNode, ProviderConfigNode, GoalConfigNode, TriggerConfigNode, type AgentProvider,
} from './LauncherFlowNodes'
import { FlowBlueprintBackground, FlowZoomControls, FlowPanHint } from './FlowChrome'
import type { ServerData } from '../../pages/agentTypes'

const nodeTypes: NodeTypes = {
  serverConfig: ServerConfigNode,
  providerConfig: ProviderConfigNode,
  goalConfig: GoalConfigNode,
  trigger: TriggerConfigNode,
}

interface LauncherFlowCanvasProps {
  servers: ServerData[]
  selectedServer: number | ''
  onSelectServer: (id: number | '') => void
  provider: AgentProvider
  onSelectProvider: (p: AgentProvider) => void
  goal: string
  onGoalChange: (goal: string) => void
  onLaunch: () => void
  isLaunchable: boolean
  starting: boolean
}

function FlowInner(props: LauncherFlowCanvasProps) {
  const { fitView } = useReactFlow()
  const {
    servers, selectedServer, onSelectServer, provider, onSelectProvider,
    goal, onGoalChange, onLaunch, isLaunchable, starting,
  } = props

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [
      {
        id: 'server', type: 'serverConfig', position: { x: 0, y: 40 },
        data: { servers, selectedServer, onChange: onSelectServer },
        draggable: false,
      },
      {
        id: 'provider', type: 'providerConfig', position: { x: 280, y: 40 },
        data: { provider, onChange: onSelectProvider },
        draggable: false,
      },
      {
        id: 'goal', type: 'goalConfig', position: { x: 560, y: 0 },
        data: { goal, onChange: onGoalChange, disabled: starting },
        draggable: false,
      },
      {
        id: 'trigger', type: 'trigger', position: { x: 920, y: 30 },
        data: { isLaunchable, starting, onLaunch },
        draggable: false,
      },
    ]
    const edges: Edge[] = [
      { id: 'e-server-provider', source: 'server', target: 'provider', type: 'smoothstep', style: { stroke: 'var(--border)', strokeWidth: 2 } },
      { id: 'e-provider-goal', source: 'provider', target: 'goal', type: 'smoothstep', style: { stroke: 'var(--border)', strokeWidth: 2 } },
      { id: 'e-goal-trigger', source: 'goal', target: 'trigger', type: 'smoothstep', animated: isLaunchable, style: { stroke: isLaunchable ? 'var(--brand-primary)' : 'var(--border)', strokeWidth: 2 } },
    ]
    return { nodes, edges }
  }, [servers, selectedServer, onSelectServer, provider, onSelectProvider, goal, onGoalChange, onLaunch, isLaunchable, starting])

  useEffect(() => {
    fitView({ padding: 0.3, duration: 300, maxZoom: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitView])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      proOptions={{ hideAttribution: true }}
      minZoom={0.15}
      maxZoom={3}
      nodesDraggable={false}
      fitView
    >
      <FlowBlueprintBackground />
      <FlowZoomControls />
      <FlowPanHint />
    </ReactFlow>
  )
}

export function LauncherFlowCanvas(props: LauncherFlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowInner {...props} />
    </ReactFlowProvider>
  )
}

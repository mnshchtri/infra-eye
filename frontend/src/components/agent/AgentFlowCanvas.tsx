import { useEffect, useMemo, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, useReactFlow, type Node, type Edge, type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { GoalFlowNode, StepFlowNode, ThinkingFlowNode } from './AgentFlowNodes'
import { FlowBlueprintBackground, FlowZoomControls, FlowPanHint } from './FlowChrome'
import type { AgentRun } from '../../pages/agentTypes'
import { nodeColor } from './agentFlowMeta'

const nodeTypes: NodeTypes = {
  goal: GoalFlowNode,
  step: StepFlowNode,
  thinking: ThinkingFlowNode,
}

const NODE_SPACING = 260

interface AgentFlowCanvasProps {
  run: AgentRun
  selectedStepId: number | null
  onSelectStep: (id: number | null) => void
  onApprove: (id: number) => void
  onReject: (id: number) => void
  busyStepId: number | null
}

function FlowInner({ run, selectedStepId, onSelectStep, onApprove, onReject, busyStepId }: AgentFlowCanvasProps) {
  const { fitView } = useReactFlow()
  const isRunning = run.status === 'running'
  const steps = run.steps ?? []
  // Hovering a node dims everything not adjacent to it, matching the Infra
  // Map blueprint's "highlight the connected chain" behavior.
  const [hoverId, setHoverId] = useState<string | null>(null)

  const { nodes, edges } = useMemo(() => {
    const rawNodes: Node[] = [
      {
        id: 'goal',
        type: 'goal',
        position: { x: 0, y: 60 },
        data: { kind: 'goal', goal: run.goal, selected: false },
        draggable: false,
        selectable: false,
      },
    ]
    const rawEdges: Edge[] = []
    let prevId = 'goal'
    let prevColor = 'var(--brand-primary)'

    steps.forEach((step, i) => {
      const id = `step-${step.id}`
      const color = nodeColor(step)
      rawNodes.push({
        id,
        type: 'step',
        position: { x: (i + 1) * NODE_SPACING, y: 60 },
        data: { kind: 'step', step, selected: selectedStepId === step.id, isBusy: busyStepId === step.id, onApprove, onReject },
        draggable: false,
      })
      rawEdges.push({
        id: `e-${prevId}-${id}`,
        source: prevId,
        target: id,
        type: 'smoothstep',
        animated: step.status === 'pending_approval',
        style: { stroke: prevColor === 'var(--brand-primary)' ? 'var(--border)' : prevColor, strokeWidth: 2 },
      })
      prevId = id
      prevColor = color
    })

    if (isRunning) {
      const id = 'thinking'
      rawNodes.push({
        id,
        type: 'thinking',
        position: { x: (steps.length + 1) * NODE_SPACING, y: 66 },
        data: { kind: 'thinking' },
        draggable: false,
        selectable: false,
      })
      rawEdges.push({
        id: `e-${prevId}-${id}`,
        source: prevId,
        target: id,
        type: 'smoothstep',
        animated: true,
        style: { stroke: 'var(--brand-primary)', strokeWidth: 2, strokeDasharray: '4 3' },
      })
    }

    if (!hoverId) return { nodes: rawNodes, edges: rawEdges }

    const neighbors = new Set([hoverId])
    for (const e of rawEdges) {
      if (e.source === hoverId) neighbors.add(e.target)
      if (e.target === hoverId) neighbors.add(e.source)
    }
    const nodes = rawNodes.map(n => ({ ...n, style: { ...n.style, opacity: neighbors.has(n.id) ? 1 : 0.3, transition: 'opacity 120ms' } }))
    const edges = rawEdges.map(e => {
      const active = e.source === hoverId || e.target === hoverId
      return { ...e, style: { ...e.style, opacity: active ? 1 : 0.15 }, zIndex: active ? 1 : 0 }
    })
    return { nodes, edges }
  }, [run.goal, steps, isRunning, selectedStepId, busyStepId, onApprove, onReject, hoverId])

  useEffect(() => {
    fitView({ padding: 0.25, duration: 400, maxZoom: 1 })
  }, [nodes.length, fitView])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => {
        if (node.type === 'step') onSelectStep(Number(node.id.replace('step-', '')))
      }}
      onNodeMouseEnter={(_, node) => setHoverId(node.id)}
      onNodeMouseLeave={() => setHoverId(null)}
      onPaneClick={() => onSelectStep(null)}
      proOptions={{ hideAttribution: true }}
      minZoom={0.15}
      maxZoom={3}
      fitView
    >
      <FlowBlueprintBackground />
      <FlowZoomControls />
      <FlowPanHint />
    </ReactFlow>
  )
}

export function AgentFlowCanvas(props: AgentFlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowInner {...props} />
    </ReactFlowProvider>
  )
}

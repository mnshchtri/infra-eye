import { useEffect, useMemo } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, BackgroundVariant,
  useReactFlow, type Node, type Edge, type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { GoalFlowNode, StepFlowNode, ThinkingFlowNode, nodeColor } from './AgentFlowNodes'
import type { AgentRun } from '../../pages/agentTypes'

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

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [
      {
        id: 'goal',
        type: 'goal',
        position: { x: 0, y: 60 },
        data: { kind: 'goal', goal: run.goal, selected: false },
        draggable: false,
        selectable: false,
      },
    ]
    const edges: Edge[] = []
    let prevId = 'goal'
    let prevColor = 'var(--brand-primary)'

    steps.forEach((step, i) => {
      const id = `step-${step.id}`
      const color = nodeColor(step)
      nodes.push({
        id,
        type: 'step',
        position: { x: (i + 1) * NODE_SPACING, y: 60 },
        data: { kind: 'step', step, selected: selectedStepId === step.id, isBusy: busyStepId === step.id, onApprove, onReject },
        draggable: false,
      })
      edges.push({
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
      nodes.push({
        id,
        type: 'thinking',
        position: { x: (steps.length + 1) * NODE_SPACING, y: 66 },
        data: { kind: 'thinking' },
        draggable: false,
        selectable: false,
      })
      edges.push({
        id: `e-${prevId}-${id}`,
        source: prevId,
        target: id,
        type: 'smoothstep',
        animated: true,
        style: { stroke: 'var(--brand-primary)', strokeWidth: 2, strokeDasharray: '4 3' },
      })
    }

    return { nodes, edges }
  }, [run.goal, steps, isRunning, selectedStepId, busyStepId, onApprove, onReject])

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
      onPaneClick={() => onSelectStep(null)}
      proOptions={{ hideAttribution: true }}
      minZoom={0.3}
      maxZoom={1.5}
      panOnScroll
      fitView
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--border)" />
      <Controls showInteractive={false} position="bottom-right" />
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

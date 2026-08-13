import type { AgentRunSummary } from '../components/agent/RunSidebar'

export interface ServerData { id: number; name: string; is_k8s?: boolean }

export interface AgentStep {
  id: number
  agent_run_id: number
  step_number: number
  kind: 'ssh_command' | 'mcp_tool' | 'final_answer' | 'unknown_tool'
  tool_name: string
  tool_args: string
  reasoning: string
  status: 'pending_approval' | 'approved' | 'rejected' | 'executed' | 'failed'
  output: string
  error_text: string
  executed_at?: string
}

export interface AgentRun extends AgentRunSummary {
  server_id: number
  provider: string
  model: string
  started_at: string
  finished_at?: string
  error_text: string
  steps: AgentStep[]
}

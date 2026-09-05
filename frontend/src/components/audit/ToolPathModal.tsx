import { useEffect, useState } from 'react'
import { Wrench } from 'lucide-react'
import { api } from '../../api/client'
import { Modal } from '../ui'
import { useToastStore } from '../../store/toastStore'
import { errMessage } from '../../utils/errors'
import type { ScanTool } from '../../types/audit'

interface ToolPathModalProps {
  tool: ScanTool | null
  onClose: () => void
  onSaved: (updated: ScanTool) => void
}

/**
 * InfraEye's backend runs on very different hosts — a bare Linux service, a
 * Mac someone installed things on by hand, inside a container — and these
 * scanners (CodeQL especially, which is usually just unzipped somewhere
 * rather than package-installed) have no one true location. Auto-detection
 * checks PATH and the common install spots, but this is the escape hatch
 * when it guesses wrong: point it at the binary directly.
 */
export function ToolPathModal({ tool, onClose, onSaved }: ToolPathModalProps) {
  const toast = useToastStore()
  const [path, setPath] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setPath(tool?.custom_path || '') }, [tool])

  async function save() {
    if (!tool) return
    setSaving(true)
    try {
      const res = await api.put<ScanTool>(`/api/audit/tools/${tool.id}/path`, { path: path.trim() })
      onSaved(res.data)
      onClose()
    } catch (err: unknown) {
      toast.error('Save failed', errMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen={tool !== null}
      onClose={onClose}
      title={`${tool?.name ?? ''} path`}
      icon={Wrench}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>Save</button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {tool?.available && !tool?.using_override && tool?.path && (
            <>Currently auto-detected at <code style={{ fontFamily: 'var(--font-mono)' }}>{tool.path}</code>. </>
          )}
          Set an exact path to override auto-detection, or leave blank to go back to it.
        </p>
        <input
          className="input" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
          value={path} onChange={e => setPath(e.target.value)}
          placeholder="/usr/local/bin/codeql or ~/codeql-home/codeql/codeql"
          autoFocus
        />
        {tool?.using_override && !tool?.available && (
          <p style={{ fontSize: 12, color: 'var(--danger)' }}>
            The currently saved path (<code style={{ fontFamily: 'var(--font-mono)' }}>{tool.custom_path}</code>) doesn't exist or isn't executable.
          </p>
        )}
      </div>
    </Modal>
  )
}

import { useEffect, useState, useCallback, useMemo, memo } from 'react'
import { Plus, Bell, Trash2, Pencil, History, X, Zap, Activity, FileCode, Server, Shield, Terminal, Search } from 'lucide-react'
import { api } from '../api/client'
import { usePermission } from '../hooks/usePermission'
import { useToastStore } from '../store/toastStore'

// Sub-components
import { RuleCard } from '../components/alerts/RuleCard'
import { HistoryRow } from '../components/alerts/HistoryRow'

interface Rule {
  id: number; name: string; server_id: number;
  condition_type: string; condition_op: string; condition_value: string;
  action_type: string; action_command: string; severity: string; enabled: boolean;
}
interface HistoryAction {
  id: number; created_at: string; server_id: number; trigger_info: string;
  command: string; output: string; status: string;
}
interface ServerData { id: number; name: string; host: string }

const emptyForm = {
  name: '', server_id: 0, condition_type: 'cpu',
  condition_op: 'gt', condition_value: '80', severity: 'warning',
  action_type: 'notify', action_command: '', enabled: true
}

const CONDITION_COLORS: Record<string, string> = {
  cpu: '#f59e0b', mem: '#3b82f6', disk: '#ec4899',
  load: '#10b981', log_keyword: '#ef4444',
  pod_status: '#8b5cf6',
}

export function AlertRules() {
  const [rules, setRules] = useState<Rule[]>([])
  const [history, setHistory] = useState<HistoryAction[]>([])
  const [servers, setServers] = useState<ServerData[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState<number | null>(null)
  const [tab, setTab] = useState<'rules' | 'history' | 'xml'>('rules')
  const [xmlContent, setXmlContent] = useState('')
  const { can } = usePermission()
  const toast = useToastStore()
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [searchHistory, setSearchHistory] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [rRes, hRes, sRes] = await Promise.all([
        api.get('/api/alert-rules'),
        api.get('/api/healing-actions'),
        api.get('/api/servers'),
      ])
      setRules(rRes.data || [])
      setHistory(hRes.data || [])
      setServers(sRes.data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const saveRule = useCallback(async () => {
    try {
      if (editId) await api.put(`/api/alert-rules/${editId}`, { ...form, server_id: Number(form.server_id) })
      else await api.post('/api/alert-rules', { ...form, server_id: Number(form.server_id) })
      setShowForm(false)
      loadData()
      toast.success(editId ? 'Config Updated' : 'Policy Decoupled', 'Self-healing logic synchronized.')
    } catch (e: any) {
      toast.error('Sync Failed', e.response?.data?.error || 'Could not commit rule')
    }
  }, [editId, form, loadData, toast])

  const toggleEnable = useCallback(async (rule: Rule) => {
    await api.put(`/api/alert-rules/${rule.id}`, { ...rule, enabled: !rule.enabled })
    loadData()
  }, [loadData])

  const deleteRule = useCallback(async (id: number) => {
    try {
      await api.delete(`/api/alert-rules/${id}`)
      toast.success('Resource Purged', 'Alert rule decommissioned successfully.')
      setConfirmDelete(null)
      loadData()
    } catch (e: any) {
      toast.error('Decommission Failed', e.response?.data?.error || 'Could not purge rule')
      setConfirmDelete(null)
    }
  }, [loadData, toast])

  const getServerName = useCallback((id: number) => {
    if (id === 0) return 'CLUSTERWIDE_HOSTS'
    return servers.find(s => s.id === id)?.name || `NODE#${id}`
  }, [servers])

  const generateXml = useCallback(() => {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- INFRAEYE_AUTOREMEDIATION_PROTOCOLS -->\n<AlertRules>\n'
    rules.forEach(r => {
      xml += `  <Rule id="${r.id}" name="${r.name}" serverId="${r.server_id}" enabled="${r.enabled}">\n`
      xml += `    <Condition type="${r.condition_type}" op="${r.condition_op}" value="${r.condition_value}" />\n`
      xml += `    <Action type="${r.action_type}">${r.action_command}</Action>\n`
      xml += `  </Rule>\n`
    })
    xml += '</AlertRules>'
    setXmlContent(xml)
  }, [rules])

  const parseXml = useCallback(async () => {
    setLoading(true)
    try {
      const parser = new DOMParser()
      const xmlDoc = parser.parseFromString(xmlContent, "text/xml")
      const ruleNodes = xmlDoc.getElementsByTagName("Rule")
      
      const newRules = Array.from(ruleNodes).map(node => ({
        name: node.getAttribute("name") || "Rule",
        server_id: parseInt(node.getAttribute("serverId") || "0"),
        enabled: node.getAttribute("enabled") !== "false",
        condition_type: node.getElementsByTagName("Condition")[0]?.getAttribute("type") || "cpu",
        condition_op: node.getElementsByTagName("Condition")[0]?.getAttribute("op") || "gt",
        condition_value: node.getElementsByTagName("Condition")[0]?.getAttribute("value") || "80",
        action_type: node.getElementsByTagName("Action")[0]?.getAttribute("type") || "ssh_command",
        action_command: node.getElementsByTagName("Action")[0]?.textContent || ""
      }))

      if (newRules.length === 0) throw new Error("XML schema validation failed : 0_RULES_FOUND")
      await api.post('/api/alert-rules/batch', newRules)
      toast.success("Logic Synchronized", `${newRules.length} protocols patched.`)
      setTab('rules')
      loadData()
    } catch (e: any) {
      toast.error("Handshake Failed", e.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }, [xmlContent, loadData, toast])

  const handleEdit = useCallback((rule: Rule) => {
    setForm(rule as any)
    setEditId(rule.id)
    setShowForm(true)
  }, [])

  const filteredHistory = useMemo(() => {
    if (!searchHistory) return history
    const s = searchHistory.toLowerCase()
    return history.filter(h => 
      getServerName(h.server_id).toLowerCase().includes(s) || 
      h.trigger_info.toLowerCase().includes(s) || 
      h.output.toLowerCase().includes(s)
    )
  }, [history, searchHistory, getServerName])

  return (
    <div className="page">
      <div className="page-header" style={{ marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
        <div>
          <h1 className="page-title">
            Automated Remediation
          </h1>
          <p className="page-subtitle" style={{ 
            fontSize: 8, fontWeight: 900, color: 'var(--text-muted)', 
            textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', marginTop: 2 
          }}>
            Policy Governance : Self-Healing Infrastructure Active
          </p>
        </div>
        {can('manage-alerts') && (
          <button 
            className="btn btn-primary" 
            onClick={() => { setShowForm(true); setForm(emptyForm); setEditId(null) }}
            style={{ height: 44, borderRadius: 0, padding: '0 24px', fontWeight: 900, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}
          >
            <Plus size={16} /> <span className="hidden-mobile">ADD_RULE</span>
          </button>
        )}
      </div>

      <div className="tabs-container" style={{ display: 'flex', gap: 1, marginBottom: 32, background: 'var(--border)', border: '1px solid var(--border)', width: 'fit-content', borderRadius: 0 }}>
        {(['rules', 'history', 'xml'] as const).map(t => (
          <button
            key={t}
            onClick={() => { if (t === 'xml') generateXml(); setTab(t); }}
            style={{
              padding: '10px 20px', borderRadius: 0, fontSize: 11, fontWeight: 900,
              transition: 'all 0.15s', cursor: 'pointer', border: 'none',
              display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
              textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
              background: tab === t ? 'var(--brand-primary)' : 'var(--bg-app)',
              color: tab === t ? '#fff' : 'var(--text-muted)',
            }}
          >
            {t === 'rules' && <Bell size={13} />}
            {t === 'history' && <History size={13} />}
            {t === 'xml' && <FileCode size={13} />}
            {t === 'rules' ? 'Active_Protocols' : t === 'history' ? 'Remediation_Logs' : 'XML_Source'}
          </button>
        ))}
      </div>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setShowForm(false)}>
          <div 
             className="fade-up" 
             style={{ 
               background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 0, 
               padding: 0, width: '100%', maxWidth: 580, boxShadow: '0 40px 100px rgba(0,0,0,0.5)', 
               maxHeight: '92vh', overflowY: 'auto' 
             }} 
             onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '28px 32px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 44, height: 44, background: 'var(--brand-glow)', border: '1px solid var(--brand-primary)30', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                     <Zap size={20} color="var(--brand-primary)" />
                  </div>
                  <div>
                    <h2 style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-primary)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>{editId ? 'Edit Remediation' : 'New System Rule'}</h2>
                    <p style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800, marginTop: 4, fontFamily: 'var(--font-mono)' }}>Define conditional hardware logic</p>
                  </div>
               </div>
               <button onClick={() => setShowForm(false)} className="btn-icon" style={{ borderRadius: 0 }}><X size={14} /></button>
            </div>
            
            <form style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
               <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Rule Handle</label>
                  <input className="input" style={{ borderRadius: 0, fontFamily: 'var(--font-mono)', fontSize: 13 }} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. HIGH_THERMAL_ALERT" />
               </div>
               <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Managed Systems</label>
                  <select className="input" style={{ borderRadius: 0, fontFamily: 'var(--font-mono)', fontSize: 13 }} value={form.server_id} onChange={e => setForm({ ...form, server_id: Number(e.target.value) })}>
                     <option value={0}>BROADCAST_ALL_HOSTS</option>
                     {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
                  </select>
               </div>
               <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.8fr', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                     <label style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Telemetry_Metric</label>
                     <select className="input" style={{ borderRadius: 0, fontFamily: 'var(--font-mono)', fontSize: 12 }} value={form.condition_type} onChange={e => setForm({ ...form, condition_type: e.target.value })}>
                        <option value="cpu">CPU_USAGE</option><option value="mem">MEMORY_LOAD</option><option value="disk">DISK_IO</option>
                        <option value="load">LOAD_AVG</option><option value="log_keyword">KW_LOG_HIT</option><option value="pod_status">K8S_POD_FAIL</option>
                     </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                     <label style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Operator</label>
                     <select className="input" style={{ borderRadius: 0, fontFamily: 'var(--font-mono)', fontSize: 12 }} value={form.condition_op} onChange={e => setForm({ ...form, condition_op: e.target.value })}>
                        <option value="gt">GT (&gt;)</option>
                        <option value="lt">LT (&lt;)</option>
                        <option value="gte">GTE (&gt;=)</option>
                     </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                     <label style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Val_Lim</label>
                     <input className="input" style={{ borderRadius: 0, fontFamily: 'var(--font-mono)', fontSize: 12 }} value={form.condition_value} onChange={e => setForm({ ...form, condition_value: e.target.value })} placeholder="80" />
                  </div>
               </div>
               <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Remediation_Protocol</label>
                  <select className="input" style={{ borderRadius: 0, fontFamily: 'var(--font-mono)', fontSize: 13 }} value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })}>
                     <option value="ssh_command">EXEC_REMOTE_SSH</option>
                     <option value="notify">TELEMETRY_LOG_ONLY</option>
                  </select>
               </div>
               {form.action_type === 'ssh_command' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                     <label style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Command_Payload</label>
                     <textarea className="input" rows={3} style={{ borderRadius: 0, fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-app)', border: '1px solid var(--border)', padding: 16, resize: 'none' }} value={form.action_command} onChange={e => setForm({ ...form, action_command: e.target.value })} placeholder="bash rule_reboot.sh" />
                  </div>
               )}
               <div style={{ display: 'flex', gap: 12, paddingTop: 16 }}>
                  <button type="button" className="btn btn-secondary" style={{ flex: 1, borderRadius: 0, height: 44, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 900, fontSize: 11 }} onClick={() => setShowForm(false)}>Abort</button>
                  <button type="button" className="btn btn-primary" style={{ flex: 2, borderRadius: 0, height: 44, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 900, fontSize: 11 }} onClick={saveRule}>Synchronize Rule</button>
               </div>
            </form>
          </div>
        </div>
      )}

      {tab === 'xml' && (
        <div className="fade-in">
          <div className="card" style={{ padding: 0, borderRadius: 0, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ padding: '28px 32px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 44, height: 44, background: 'var(--brand-glow)', border: '1px solid var(--brand-primary)30', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileCode size={22} color="var(--brand-primary)" /></div>
                <div>
                   <h2 style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-primary)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Rule Configuration (XML)</h2>
                   <p style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800, marginTop: 4, fontFamily: 'var(--font-mono)' }}>Low-level logic orchestration layer</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                 <button className="btn btn-secondary" style={{ borderRadius: 0, height: 40, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 900 }} onClick={generateXml}>RESET_VIEW</button>
                 <button className="btn btn-primary" style={{ borderRadius: 0, height: 40, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 900 }} onClick={parseXml}>SYNC_GATEWAY</button>
              </div>
            </div>
            <textarea className="input" value={xmlContent} onChange={e => setXmlContent(e.target.value)} style={{ width: '100%', height: 500, border: 'none', borderRadius: 0, fontFamily: 'var(--font-mono)', fontSize: 12, padding: 32, background: 'var(--bg-app)', color: 'var(--brand-primary)', lineHeight: 1.6, resize: 'none' }} spellCheck={false} />
          </div>
        </div>
      )}

      {tab === 'rules' && (
        <>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }}><div className="loader-spin" style={{ width: 40, height: 40, border: '2px solid var(--border)', borderTopColor: 'var(--brand-primary)' }} /></div>
          ) : rules.length === 0 ? (
            <div className="empty-state" style={{ border: '1px dashed var(--border)', padding: '120px 40px', borderRadius: 0 }}>
              <div style={{ width: 72, height: 72, background: 'var(--bg-app)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 32 }}><Bell size={32} color="var(--brand-primary)" /></div>
              <h2 style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 900, fontSize: 18, color: 'var(--text-primary)' }}>System Idle : 0_RULES_LOADED</h2>
              <p style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontSize: 10, color: 'var(--text-muted)', marginTop: 16, letterSpacing: '0.05em', maxWidth: 380, lineHeight: 1.6 }}>Deploy automated remediation protocols to manage hardware issues without manual intervention.</p>
              {can('manage-alerts') && (<button className="btn btn-primary" style={{ marginTop: 32, borderRadius: 0, padding: '12px 32px' }} onClick={() => { setShowForm(true); setForm(emptyForm); setEditId(null) }}><Plus size={14} /> INITIALIZE POLICY</button>)}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 24, paddingBottom: 40 }}>
              {rules.map((rule, i) => (
                <RuleCard key={rule.id} rule={rule} serverName={getServerName(rule.server_id)} condColor={CONDITION_COLORS[rule.condition_type] || 'var(--brand-primary)'} canManage={can('manage-alerts')} onEdit={handleEdit} onDelete={deleteRule} onToggle={toggleEnable} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <div className="fade-in">
           <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '0 16px', height: 48 }}>
              <Search size={14} color="var(--text-muted)" />
              <input 
                placeholder="PROBE_LOGS_DATA..." 
                value={searchHistory} 
                onChange={e => setSearchHistory(e.target.value)}
                style={{ flex: 1, height: '100%', background: 'none', border: 'none', outline: 'none', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-primary)', fontWeight: 800, textTransform: 'uppercase' }}
              />
           </div>
           
           <div className="card" style={{ padding: 0, borderRadius: 0, border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
             {history.length === 0 ? (
               <div className="empty-state" style={{ padding: '120px 0' }}><History size={40} color="var(--border)" /><p style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontSize: 11, fontWeight: 900, color: 'var(--text-muted)', marginTop: 24 }}>System Clean : No Anomalies Detected</p></div>
             ) : (
               <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 420px)', overflowY: 'auto' }}>
                 <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 900 }}>
                   <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                     <tr>
                        {['Timestamp', 'Target_Node', 'Anomalous_State', 'System_Response'].map(h => (
                           <th key={h} style={{ padding: '16px 24px', fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', fontFamily: 'var(--font-mono)' }}>{h}</th>
                        ))}
                     </tr>
                   </thead>
                   <tbody>
                      {filteredHistory.map((h, i) => (
                         <HistoryRow key={h.id} history={h} serverName={getServerName(h.server_id)} isLast={i === filteredHistory.length - 1} />
                      ))}
                   </tbody>
                 </table>
               </div>
             )}
           </div>
        </div>
      )}

      <style>{`
        .loader-spin { border-radius: 0; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .table-row-hover:hover { background: var(--bg-elevated)50 ! from var(--bg-hover) !important; }
      `}</style>
    </div>
  )
}

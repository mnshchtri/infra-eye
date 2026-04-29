import { useState } from 'react'
import { Shield, Key, Network, Copy, CheckCircle2, Terminal } from 'lucide-react'
import toast from 'react-hot-toast'

export function VPN() {
  const [authKey, setAuthKey] = useState('')
  const [vpnType, setVpnType] = useState('tailscale')

  const handleSave = () => {
    if (!authKey) {
      toast.error('Auth Key required', 'Please enter a valid VPN authentication key.')
      return
    }
    // Simulate backend save
    toast.success('VPN Configured', 'VPN settings have been securely stored.')
  }

  const handleCopyCommand = () => {
    const command = vpnType === 'tailscale' 
      ? `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --authkey=${authKey || 'YOUR_AUTH_KEY'}`
      : `curl -s https://install.zerotier.com | sudo bash && sudo zerotier-cli join ${authKey || 'YOUR_NETWORK_ID'}`;
    
    navigator.clipboard.writeText(command)
    toast.success('Command Copied', 'Paste this on your target servers to connect them.')
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: 32 }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Shield className="text-brand" size={28} />
          VPN & Networking
        </h1>
        <p className="page-subtitle" style={{ marginTop: 8 }}>
          Configure a secure mesh VPN (like Tailscale) so InfraEye can securely reach private servers.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
        {/* Configuration Card */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Network size={16} /> Global VPN Settings
            </h2>
          </div>
          
          <div className="input-group" style={{ marginBottom: 16 }}>
            <label className="input-label">VPN Provider</label>
            <div style={{ display: 'flex', gap: 12 }}>
              <button 
                type="button"
                onClick={() => setVpnType('tailscale')}
                style={{
                  flex: 1, padding: '12px', fontSize: 12, fontWeight: 700,
                  border: '1px solid var(--border)', transition: 'all 0.2s', cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', textTransform: 'uppercase', borderRadius: 4,
                  ...(vpnType === 'tailscale'
                    ? { background: 'var(--brand-primary)', borderColor: 'var(--brand-primary)', color: 'var(--text-inverse)' }
                    : { background: 'var(--bg-elevated)', color: 'var(--text-muted)' }
                  ),
                }}
              >
                Tailscale
              </button>
              <button 
                type="button"
                onClick={() => setVpnType('zerotier')}
                style={{
                  flex: 1, padding: '12px', fontSize: 12, fontWeight: 700,
                  border: '1px solid var(--border)', transition: 'all 0.2s', cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', textTransform: 'uppercase', borderRadius: 4,
                  ...(vpnType === 'zerotier'
                    ? { background: 'var(--brand-primary)', borderColor: 'var(--brand-primary)', color: 'var(--text-inverse)' }
                    : { background: 'var(--bg-elevated)', color: 'var(--text-muted)' }
                  ),
                }}
              >
                ZeroTier
              </button>
            </div>
          </div>

          <div className="input-group">
            <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Key size={12} /> {vpnType === 'tailscale' ? 'Auth Key' : 'Network ID'}
            </label>
            <input 
              className="input" 
              type="password"
              value={authKey}
              onChange={e => setAuthKey(e.target.value)}
              placeholder={vpnType === 'tailscale' ? 'tskey-auth-...' : '16-character Network ID'}
            />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
              This key will be used by the InfraEye backend to join the VPN, and will be securely provided to new servers you provision.
            </p>
          </div>

          <button className="btn-primary" onClick={handleSave} style={{ width: '100%', marginTop: 24, padding: '12px', fontWeight: 800 }}>
            SAVE CONFIGURATION
          </button>
        </div>

        {/* Instructions Card */}
        <div className="card" style={{ background: 'var(--bg-elevated)', borderStyle: 'dashed' }}>
          <div className="card-header">
            <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={16} className="text-brand" /> Provisioning Target Servers
            </h2>
          </div>
          
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
            To add a remote server to this InfraEye instance over {vpnType === 'tailscale' ? 'Tailscale' : 'ZeroTier'}, run the following command on your target server. It will automatically install the VPN and join your network.
          </p>

          <div style={{ position: 'relative', background: '#000', padding: '16px', borderRadius: 6, border: '1px solid #333' }}>
            <button 
              onClick={handleCopyCommand}
              style={{ position: 'absolute', top: 12, right: 12, background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', padding: 4 }}
              title="Copy to clipboard"
            >
              <Copy size={14} />
            </button>
            <code style={{ color: '#0f0', fontFamily: 'var(--font-mono)', fontSize: 11, wordBreak: 'break-all', display: 'block', paddingRight: 24 }}>
              {vpnType === 'tailscale' 
                ? `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --authkey=${authKey ? '***' : 'YOUR_AUTH_KEY'}`
                : `curl -s https://install.zerotier.com | sudo bash && sudo zerotier-cli join ${authKey ? '***' : 'YOUR_NETWORK_ID'}`}
            </code>
          </div>

          <div style={{ marginTop: 24, padding: 16, background: 'var(--bg-app)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Terminal size={12} /> Next Steps
            </h3>
            <ol style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 16, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>Run the command above on your target servers.</li>
              <li>Wait for the server to appear in your VPN admin console.</li>
              <li>Get the new VPN IP address (e.g. 100.x.x.x).</li>
              <li>Go to the Servers tab and add the server using this new IP.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

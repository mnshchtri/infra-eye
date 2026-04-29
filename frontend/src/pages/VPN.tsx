import { useState } from 'react'
import { Shield, Key, Network, Copy, CheckCircle2, Terminal } from 'lucide-react'
import { useToastStore } from '../store/toastStore'

export function VPN() {
  const [authKey, setAuthKey] = useState('')
  const [vpnType, setVpnType] = useState('tailscale')
  const toast = useToastStore()

  const handleSave = () => {
    if (!authKey) {
      toast.error('Auth Key required', 'Please enter a valid VPN authentication key.')
      return
    }
    // Simulate backend save
    toast.success('VPN Configured', 'VPN settings have been securely stored.')
  }

  const handleCopyCommand = () => {
    let command = ''
    if (vpnType === 'tailscale') {
      command = `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --authkey=${authKey || 'YOUR_AUTH_KEY'}`
    } else if (vpnType === 'zerotier') {
      command = `curl -s https://install.zerotier.com | sudo bash && sudo zerotier-cli join ${authKey || 'YOUR_NETWORK_ID'}`
    } else if (vpnType === 'openvpn') {
      const b64 = authKey ? btoa(authKey) : 'YOUR_BASE64_ENCODED_OVPN';
      command = `sudo apt update && sudo apt install -y openvpn && echo "${b64}" | base64 -d | sudo tee /etc/openvpn/client.conf > /dev/null && sudo systemctl start openvpn@client`
    }
    
    navigator.clipboard.writeText(command)
    toast.success('Command Copied', 'Paste this on your target servers to connect them.')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }} className="page">
      <div style={{ flexShrink: 0 }}>
        <div className="page-header" style={{ marginBottom: 32 }}>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Shield className="text-brand" size={28} />
              VPN & Networking
            </h1>
            <p className="page-subtitle hidden-mobile" style={{ marginTop: 8 }}>
              Configure a secure mesh VPN so InfraEye can securely reach private servers.
            </p>
          </div>
        </div>
      </div>

      <div className="fade-up" style={{ flex: 1, overflowY: 'auto', paddingBottom: 40 }}>
        <div className="grid-2-col" style={{ gap: 24, alignItems: 'start' }}>
          {/* Configuration Card */}
          <div className="card" style={{ padding: '32px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(79, 70, 229, 0.08)', border: '1px solid var(--brand-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Network size={20} color="var(--brand-primary)" />
              </div>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Global VPN Settings</h2>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Select and configure your VPN provider</p>
              </div>
            </div>
            
            <div className="input-group" style={{ marginBottom: 24 }}>
              <label className="input-label">VPN Provider</label>
              <div style={{ display: 'flex', gap: 12 }}>
                {['tailscale', 'zerotier', 'openvpn'].map((type) => (
                  <button 
                    key={type}
                    type="button"
                    onClick={() => setVpnType(type)}
                    style={{
                      flex: 1, padding: '12px', fontSize: 10, fontWeight: 900,
                      border: '1px solid var(--border)', transition: 'all 0.2s', cursor: 'pointer',
                      fontFamily: 'var(--font-mono)', textTransform: 'uppercase', borderRadius: 4,
                      ...(vpnType === type
                        ? { background: 'var(--brand-primary)', borderColor: 'var(--brand-primary)', color: 'var(--text-inverse)' }
                        : { background: 'var(--bg-elevated)', color: 'var(--text-muted)' }
                      ),
                    }}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div className="input-group">
              {vpnType === 'openvpn' ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label className="input-label" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Key size={12} /> OpenVPN Configuration (.ovpn)
                    </label>
                    <label style={{ fontSize: 10, color: 'var(--brand-primary)', cursor: 'pointer', fontWeight: 600, background: 'var(--bg-elevated)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)' }}>
                      Upload .ovpn File
                      <input type="file" accept=".ovpn" style={{ display: 'none' }} onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (ev) => setAuthKey(ev.target?.result as string);
                          reader.readAsText(file);
                        }
                      }} />
                    </label>
                  </div>
                  <textarea 
                    className="input" 
                    value={authKey} 
                    onChange={e => setAuthKey(e.target.value)} 
                    placeholder="client\ndev tun\nproto udp\nremote your-server.com 1194\n..." 
                    style={{ height: 120, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 10, whiteSpace: 'pre' }} 
                  />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
                    Paste your .ovpn configuration here or upload the file. This config will be used to securely connect this node to your OpenVPN network.
                  </p>
                </>
              ) : (
                <>
                  <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Key size={12} /> 
                    {vpnType === 'tailscale' ? 'Auth Key' : 'Network ID'}
                  </label>
                  <input 
                    className="input" 
                    type="password"
                    value={authKey}
                    onChange={e => setAuthKey(e.target.value)}
                    placeholder={
                      vpnType === 'tailscale' ? 'tskey-auth-...' : '16-character Network ID'
                    }
                  />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
                    This key will be used by the InfraEye backend to join the VPN, and will be securely provided to new servers you provision.
                  </p>
                </>
              )}
            </div>

            <div style={{ marginTop: 32, paddingTop: 32, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={handleSave} style={{ width: '100%', maxWidth: 200, height: 44, fontSize: 14, fontWeight: 700 }}>
                Save Configuration
              </button>
            </div>
          </div>

          {/* Instructions Card */}
          <div className="card" style={{ padding: '32px 24px', background: 'var(--bg-elevated)', borderStyle: 'dashed' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <CheckCircle2 size={20} color="var(--success)" />
              </div>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Provisioning Target Servers</h2>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Connect remote servers to the VPN</p>
              </div>
            </div>
            
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
              To add a remote server to this InfraEye instance over {vpnType === 'tailscale' ? 'Tailscale' : vpnType === 'zerotier' ? 'ZeroTier' : 'OpenVPN'}, run the following command on your target server. It will automatically install the VPN and join your network.
            </p>

            <div style={{ position: 'relative', background: '#000', padding: '16px', borderRadius: 6, border: '1px solid #333' }}>
              <button 
                onClick={handleCopyCommand}
                style={{ position: 'absolute', top: 12, right: 12, background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', padding: 4 }}
                title="Copy to clipboard"
              >
                <Copy size={14} />
              </button>
              <code style={{ color: '#0f0', fontFamily: 'var(--font-mono)', fontSize: 11, wordBreak: 'break-all', display: 'block', paddingRight: 24, lineHeight: 1.5 }}>
                {vpnType === 'tailscale' 
                  ? `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --authkey=${authKey ? '***' : 'YOUR_AUTH_KEY'}`
                  : vpnType === 'zerotier'
                  ? `curl -s https://install.zerotier.com | sudo bash && sudo zerotier-cli join ${authKey ? '***' : 'YOUR_NETWORK_ID'}`
                  : `sudo apt update && sudo apt install -y openvpn && echo "${authKey ? '*** (BASE64)' : 'BASE64_OVPN_CONFIG'}" | base64 -d | sudo tee /etc/openvpn/client.conf > /dev/null && sudo systemctl start openvpn@client`
                }
              </code>
            </div>

            <div style={{ marginTop: 24, padding: 20, background: 'var(--bg-app)', borderRadius: 12, border: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Terminal size={14} /> Next Steps
              </h3>
              <ol style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 16, margin: 0, display: 'flex', flexDirection: 'column', gap: 10, lineHeight: 1.5 }}>
                <li>Run the command above on your target servers.</li>
                <li>Wait for the server to appear in your VPN admin console or verify connection status.</li>
                <li>Get the new VPN IP address (e.g. 100.x.x.x for Tailscale, 10.8.x.x for OpenVPN).</li>
                <li>Go to the Servers tab and add the server using this secure VPN IP.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

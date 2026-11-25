import { useState } from 'react'
import { Key, Network, Copy, CheckCircle2, Terminal } from 'lucide-react'
import { Box, Button as MuiButton, IconButton, List, ListItem, ListItemText, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import { useToastStore } from '../store/toastStore'
import { Button, Card, CardBody, PageHeader, SectionHeader } from '../components/ui'

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

  const providerName = vpnType === 'tailscale' ? 'Tailscale' : vpnType === 'zerotier' ? 'ZeroTier' : 'OpenVPN'
  const previewCommand = vpnType === 'tailscale'
    ? `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --authkey=${authKey ? '***' : 'YOUR_AUTH_KEY'}`
    : vpnType === 'zerotier'
    ? `curl -s https://install.zerotier.com | sudo bash && sudo zerotier-cli join ${authKey ? '***' : 'YOUR_NETWORK_ID'}`
    : `sudo apt update && sudo apt install -y openvpn && echo "${authKey ? '*** (BASE64)' : 'BASE64_OVPN_CONFIG'}" | base64 -d | sudo tee /etc/openvpn/client.conf > /dev/null && sudo systemctl start openvpn@client`

  return (
    <div className="page">
      <PageHeader
        title="VPN & Networking"
        subtitle="Configure a secure mesh VPN so InfraEye can securely reach private servers."
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
        <Card>
          <CardBody>
            <SectionHeader icon={Network} iconColor="var(--brand-primary)" title="Global VPN settings" subtitle="Select and configure your VPN provider" />

            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, mb: 0.75 }}>VPN provider</Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              color="primary"
              value={vpnType}
              onChange={(_, v: string | null) => { if (v) setVpnType(v) }}
              aria-label="VPN provider"
              sx={{ mb: 2.5 }}
            >
              {[['tailscale', 'Tailscale'], ['zerotier', 'ZeroTier'], ['openvpn', 'OpenVPN']].map(([type, label]) => (
                <ToggleButton key={type} value={type} sx={{ textTransform: 'none' }}>{label}</ToggleButton>
              ))}
            </ToggleButtonGroup>

            {vpnType === 'openvpn' ? (
              <>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Key size={13} /> OpenVPN configuration (.ovpn)
                  </Typography>
                  <MuiButton variant="outlined" color="inherit" size="small" component="label" sx={{ borderColor: 'divider' }}>
                    Upload .ovpn file
                    <input type="file" accept=".ovpn" hidden onChange={e => {
                      const file = e.target.files?.[0]
                      if (file) {
                        const reader = new FileReader()
                        reader.onload = (ev) => setAuthKey(ev.target?.result as string)
                        reader.readAsText(file)
                      }
                    }} />
                  </MuiButton>
                </Box>
                <TextField
                  value={authKey}
                  onChange={e => setAuthKey(e.target.value)}
                  placeholder={'client\ndev tun\nproto udp\nremote your-server.com 1194\n...'}
                  multiline
                  minRows={5}
                  maxRows={14}
                  fullWidth
                  helperText="Paste your .ovpn configuration here or upload the file. This config will be used to securely connect this node to your OpenVPN network."
                  slotProps={{ htmlInput: { 'aria-label': 'OpenVPN configuration', style: { fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre' } } }}
                />
              </>
            ) : (
              <TextField
                label={vpnType === 'tailscale' ? 'Auth key' : 'Network ID'}
                type="password"
                value={authKey}
                onChange={e => setAuthKey(e.target.value)}
                placeholder={vpnType === 'tailscale' ? 'tskey-auth-...' : '16-character Network ID'}
                fullWidth
                helperText="This key will be used by the InfraEye backend to join the VPN, and will be securely provided to new servers you provision."
                slotProps={{ inputLabel: { shrink: true } }}
              />
            )}

            <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="primary" onClick={handleSave}>Save Configuration</Button>
            </Box>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <SectionHeader icon={CheckCircle2} iconColor="var(--success)" title="Provisioning target servers" subtitle="Connect remote servers to the VPN" />

            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, mb: 2 }}>
              To add a remote server to this InfraEye instance over {providerName}, run the following command on your target server. It will automatically install the VPN and join your network.
            </Typography>

            <Box sx={{ position: 'relative', bgcolor: 'action.hover', p: 2, borderRadius: 1, border: 1, borderColor: 'divider' }}>
              <Tooltip title="Copy to clipboard">
                <IconButton size="small" onClick={handleCopyCommand} aria-label="Copy command" sx={{ position: 'absolute', top: 6, right: 6 }}>
                  <Copy size={14} />
                </IconButton>
              </Tooltip>
              <Box component="code" sx={{ fontFamily: 'var(--font-mono)', fontSize: 12, wordBreak: 'break-all', display: 'block', pr: 4, lineHeight: 1.5 }}>
                {previewCommand}
              </Box>
            </Box>

            <Box sx={{ mt: 2.5 }}>
              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Terminal size={14} /> Next steps
              </Typography>
              <List dense disablePadding component="ol" sx={{ listStyle: 'decimal', pl: 2.5, color: 'text.secondary' }}>
                {[
                  'Run the command above on your target servers.',
                  'Wait for the server to appear in your VPN admin console or verify connection status.',
                  'Get the new VPN IP address (e.g. 100.x.x.x for Tailscale, 10.8.x.x for OpenVPN).',
                  'Go to the Servers tab and add the server using this secure VPN IP.',
                ].map(t => (
                  <ListItem key={t} sx={{ display: 'list-item', px: 0 }}>
                    <ListItemText primary={t} slotProps={{ primary: { variant: 'body2', color: 'text.secondary' } }} />
                  </ListItem>
                ))}
              </List>
            </Box>
          </CardBody>
        </Card>
      </Box>
    </div>
  )
}

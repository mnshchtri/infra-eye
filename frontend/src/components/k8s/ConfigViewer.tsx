import CodeEditor from '@uiw/react-textarea-code-editor'
import { useUIStore } from '../../store/uiStore'

interface ConfigViewerProps {
  content: string;
  onChange: (val: string) => void;
  fullPage?: boolean;
}

export function ConfigViewer({ content, onChange, fullPage }: ConfigViewerProps) {
  const { darkMode } = useUIStore()
  
  return (
    <div style={{ 
      height: fullPage ? '100%' : 'calc(100vh - 200px)', 
      background: 'var(--bg-app)', 
      position: 'relative', 
      overflow: 'auto' 
    }}>
      <CodeEditor
        value={content}
        language="yaml"
        placeholder="Write or paste Kubernetes manifest YAML..."
        onChange={(evn) => onChange(evn.target.value)}
        padding={16}
        data-color-mode={darkMode ? 'dark' : 'light'}
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 13,
          backgroundColor: 'transparent',
          minHeight: '100%',
          overflow: 'auto'
        }}
      />
    </div>
  )
}

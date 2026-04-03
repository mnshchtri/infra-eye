import { Menu, X, Bell } from 'lucide-react'
import { useUIStore } from '../../store/uiStore'
import logo from '../../assets/logo.png'

export function MobileNav() {
  const { mobileNavOpen, toggleMobileNav } = useUIStore()

  return (
    <nav className="mobile-nav">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon" style={{ width: 32, height: 32 }}>
          <img src={logo} alt="L" />
        </div>
        <span className="sidebar-logo-text" style={{ fontSize: 18 }}>InfraEye</span>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button 
          className="sidebar-toggle-btn" 
          onClick={toggleMobileNav}
          aria-label={mobileNavOpen ? "Close Menu" : "Open Menu"}
        >
          {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
    </nav>
  )
}

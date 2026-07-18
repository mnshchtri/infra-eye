# InfraEye Design Principles

Inspired by the [Cockpit Project](https://cockpit-project.org/), InfraEye follows these core design principles to provide an intuitive, reliable, and maintainable server management experience.

## Core Principles

### 1. Discoverable UI

**Principle**: Users should be able to accomplish tasks without reading documentation.

**Implementation in InfraEye**:
- **Clear Visual Hierarchy**: Important actions are prominently displayed
- **Contextual Help**: Tooltips and inline hints guide users
- **Consistent Patterns**: Similar actions use similar UI patterns across pages
- **Progressive Disclosure**: Advanced options are hidden until needed
- **Breadcrumbs & Navigation**: Clear indication of current location and available paths

**Examples**:
- Dashboard shows key metrics with visual indicators (green/red status)
- Server actions have clear icons and descriptive labels
- Alert rule creation uses guided form with validation

### 2. Direct System Interaction

**Principle**: The UI reflects the actual current state of servers without storing opinions.

**Implementation in InfraEye**:
- **Real-time Data**: WebSocket connections stream live metrics and logs
- **No State Caching**: Every view queries actual system state
- **Immediate Reflection**: Changes made via SSH/kubectl immediately visible in UI
- **Bidirectional Sync**: InfraEye doesn't "own" the configuration
- **Existing Tools Respected**: Works alongside Ansible, Terraform, kubectl

**Examples**:
- Metrics update every 30 seconds via WebSocket
- Kubernetes resources refresh without page reload
- Terminal shows actual SSH session, not emulated
- Server status reflects real connectivity, not last known state

### 3. Zero Configuration

**Principle**: InfraEye works out of the box with minimal setup.

**Implementation in InfraEye**:
- **Agentless Design**: No software installation required on monitored servers
- **SSH-Based**: Uses standard SSH (port 22) that's already configured
- **Auto-Discovery**: Detects OS, services, and Kubernetes clusters automatically
- **Sensible Defaults**: Reasonable settings pre-configured
- **Optional Enhancements**: Advanced features (OIDC, MCP) are opt-in

**Examples**:
- Add server with just hostname, port, and SSH credentials
- Kubernetes detected automatically if kubeconfig provided
- Self-healing rules use simple XML format
- Works with password or key-based SSH authentication

### 4. Not Configuration Management

**Principle**: InfraEye is imperative, not declarative. It doesn't enforce desired state.

**Implementation in InfraEye**:
- **Ad-hoc Operations**: Execute commands and queries on demand
- **No State Enforcement**: Doesn't try to "fix" configurations
- **Coexists with CM Tools**: Works alongside Ansible, Puppet, Chef
- **Manual Remediation**: Self-healing actions are explicit, not automatic drift correction
- **Expose, Don't Replace**: Shows system state, doesn't abstract it away

**Examples**:
- Alert rules execute specific commands, don't enforce state
- Terminal provides direct shell access
- kubectl commands run as-is, not wrapped in abstraction
- Resource queries show actual database content

### 5. Zero Footprint

**Principle**: InfraEye should use minimal resources when not actively used.

**Implementation in InfraEye**:
- **Agentless Architecture**: No daemons running on monitored servers
- **SSH Connection Pooling**: Connections created/destroyed on demand
- **Stateless Backend**: Can be stopped without affecting monitored systems
- **Efficient Metrics**: Only collects data when dashboard is open
- **Lazy Loading**: Resources loaded only when needed

**Resource Usage**:
- Backend: ~50 MB RAM idle, ~200 MB under load
- Frontend: Standard React SPA (~2 MB gzipped)
- No processes on monitored servers
- PostgreSQL: 100-500 MB depending on history

### 6. OS-Native Feel

**Principle**: Users should feel they're managing the server OS, not using an external tool.

**Implementation in InfraEye**:
- **System-Appropriate Commands**: Uses OS-specific commands (systemctl, apt, yum)
- **Native Terminal**: Real SSH terminal, not simulated
- **Familiar Patterns**: Follows Linux/Unix conventions
- **Honest Error Messages**: Shows actual system errors, not abstracted messages
- **Branding is Subtle**: Focus on servers, not on InfraEye

**Examples**:
- Terminal runs actual bash/zsh/sh session
- File paths shown as `/etc/nginx/nginx.conf`, not abstracted
- Error messages from failed SSH commands shown verbatim
- Server icons reflect actual OS (Ubuntu, CentOS, etc.)

### 7. Design First

**Principle**: Features are designed based on real-world use cases before implementation.

**Implementation in InfraEye**:
- **User Story Driven**: Each feature solves a specific operations problem
- **Mockups Before Code**: UI designed in Figma/Excalidraw first
- **Usability Testing**: Features tested with actual DevOps teams
- **Iterative Refinement**: Based on feedback from production use

**Design Process**:
1. Identify pain point (e.g., "checking logs on 20 servers is tedious")
2. Design solution (centralized log streaming)
3. Create mockup and validate with users
4. Implement with test coverage
5. Gather feedback and iterate

### 8. Tested & Reliable

**Principle**: Every feature is covered by automated tests.

**Implementation in InfraEye**:
- **Backend Tests**: Unit tests for handlers, integration tests for database
- **Frontend Tests**: Component tests, E2E tests for critical flows
- **Continuous Integration**: Tests run on every commit
- **Manual Testing**: QA testing before release
- **Dogfooding**: InfraEye developers use InfraEye daily

**Test Coverage Goals**:
- Critical paths: 90%+ coverage
- Business logic: 80%+ coverage
- UI components: 70%+ coverage

### 9. Backward Compatible

**Principle**: API changes don't break existing integrations.

**Implementation in InfraEye**:
- **Versioned APIs**: Major changes get new version (v1, v2)
- **Graceful Deprecation**: Old endpoints supported for at least 2 major versions
- **Forward Migration**: Database schema changes include migrations
- **Protocol Stability**: WebSocket and REST APIs maintain compatibility

**Compatibility Promise**:
- Internal JWT structure is stable
- REST API endpoints won't change without version bump
- Database migrations are one-way upgradable
- Configuration format is backward compatible

### 10. Server First, Cloud Second

**Principle**: Prioritize bare-metal and VM use cases over cloud-native.

**Implementation in InfraEye**:
- **SSH Native**: Designed around SSH, not cloud APIs
- **Kubernetes Support**: Added as first-class feature, not afterthought
- **Resource Agnostic**: Works with on-prem databases, not just cloud DBs
- **No Cloud Lock-in**: Doesn't assume AWS/GCP/Azure
- **Hybrid Friendly**: Mix of cloud, on-prem, and edge works seamlessly

**Supported Environments**:
- ✅ Bare-metal Linux servers
- ✅ VMs (KVM, VMware, VirtualBox)
- ✅ Cloud instances (EC2, Compute Engine, Droplets)
- ✅ Kubernetes (any distribution)
- ✅ Hybrid and edge deployments

## UI/UX Guidelines

### Visual Design

Following [PatternFly](https://www.patternfly.org/) and Cockpit patterns:

- **Consistent Spacing**: 4px grid system
- **Color Purposeful**: Status colors (green=good, yellow=warning, red=critical)
- **Typography Clear**: Sans-serif, readable at all sizes
- **Icons Meaningful**: Each icon represents clear action or status
- **Animations Subtle**: Enhance understanding, don't distract

### Interaction Patterns

- **Actions are Obvious**: Buttons clearly labeled ("Reboot Server", not "Execute")
- **Confirmation for Danger**: Destructive actions require confirmation
- **Undo When Possible**: Operations that can be reversed show undo option
- **Progress Indicators**: Long operations show progress
- **Keyboard Accessible**: All actions available via keyboard

### Error Handling

- **Clear Error Messages**: Explain what went wrong and how to fix it
- **Contextual Help**: Errors link to relevant documentation
- **Graceful Degradation**: Partial failures don't crash entire UI
- **Retry Mechanisms**: Transient errors allow retry without page reload

## Anti-Patterns (What We Avoid)

### ❌ Don't Abstract Away Reality

**Bad**: "Configuration Sync Status: Pending"  
**Good**: "SSH Connection Failed: Permission denied (publickey)"

Users need real system errors to troubleshoot.

### ❌ Don't Store Redundant State

**Bad**: Caching server metrics in local database for display  
**Good**: Stream metrics directly from SSH connection

Cached state can become stale and misleading.

### ❌ Don't Require Learning Proprietary Concepts

**Bad**: "Create a Monitoring Pod Template"  
**Good**: "Add Server (SSH)" or "Add Kubernetes Cluster (kubeconfig)"

Use familiar concepts from the underlying systems.

### ❌ Don't Make Users Choose Between InfraEye and CLI

**Bad**: "InfraEye-managed servers cannot be modified via SSH"  
**Good**: "Changes made via SSH are immediately reflected in InfraEye"

Users should use the tool that fits their current task.

### ❌ Don't Hide Important Information

**Bad**: Showing only "Status: Error"  
**Good**: Showing full error message with stack trace option

Hiding details forces users to guess or dig through logs.

## Future Principles

As InfraEye evolves, we're considering:

- **AI-Augmented, Not AI-Controlled**: AI suggests actions, humans approve
- **Privacy by Design**: User data stays on their infrastructure
- **Accessibility First**: WCAG 2.1 AA compliance from day one
- **Mobile-Ready**: Critical functions work on tablets/phones
- **Offline Resilient**: Core functions work without internet

## Contributing to Design

When proposing new features:

1. **User Story**: Describe the problem from user's perspective
2. **Current Workaround**: How do users solve this today?
3. **Proposed Solution**: Mockups or wireframes
4. **Alternatives Considered**: What other approaches did you evaluate?
5. **Impact**: Who benefits and what's the trade-off?

Design discussions happen in GitHub Issues with `design` label.

---

**References**:
- [Cockpit Project Ideals](https://cockpit-project.org/ideals)
- [PatternFly Design System](https://www.patternfly.org/)
- [Unix Philosophy](https://en.wikipedia.org/wiki/Unix_philosophy)

**Last Updated**: July 2026

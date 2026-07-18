# Keycloak OIDC Integration Guide

This guide explains how to configure InfraEye to use Keycloak (or any OIDC-compliant provider) for authentication.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Keycloak Setup](#keycloak-setup)
- [InfraEye Configuration](#infraeye-configuration)
- [Role Mapping](#role-mapping)
- [Frontend Integration](#frontend-integration)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Overview

InfraEye supports OpenID Connect (OIDC) authentication, allowing you to integrate with enterprise identity providers like:

- **Keycloak** (recommended)
- **Auth0**
- **Okta**
- **Azure AD / Microsoft Entra ID**
- **Google Workspace**
- Any OIDC-compliant provider

When OIDC is enabled, users can log in using their existing organizational credentials instead of creating separate InfraEye accounts.

## Prerequisites

- Keycloak 20.0+ (or another OIDC provider)
- InfraEye backend with network access to Keycloak
- Valid SSL certificates (recommended for production)

## Keycloak Setup

### 1. Create a Realm

1. Log in to Keycloak Admin Console
2. Click **Create Realm** (or use an existing one)
3. Set **Realm name**: `infraeye` (or your preference)
4. Enable the realm

### 2. Create a Client

1. Navigate to **Clients** → **Create Client**
2. Configure the client:
   - **Client ID**: `infraeye-web`
   - **Name**: `InfraEye Web Application`
   - **Client Protocol**: `openid-connect`
   - **Access Type**: `confidential`
   
3. Click **Next** and configure:
   - **Valid Redirect URIs**: 
     - `http://localhost:8080/api/auth/oidc/callback` (development)
     - `https://infraeye.yourdomain.com/api/auth/oidc/callback` (production)
   - **Web Origins**: 
     - `http://localhost:3000` (development frontend)
     - `https://infraeye.yourdomain.com` (production)
   
4. Go to **Credentials** tab and copy the **Client Secret**

### 3. Configure Client Scopes

Ensure the following scopes are enabled:
- `openid`
- `profile`
- `email`
- `roles` (for role mapping)

### 4. Create Groups/Roles

InfraEye maps Keycloak groups or roles to its internal roles:

- **infraeye-admin** → `admin` (full system access)
- **infraeye-devops** → `devops` (server management, resources)
- **infraeye-trainee** → `trainee` (limited access)
- **Default** → `intern` (read-only access)

#### Option A: Using Groups (Recommended)

1. Navigate to **Groups** → **Create Group**
2. Create groups:
   - `infraeye-admin`
   - `infraeye-devops`
   - `infraeye-trainee`
3. Assign users to appropriate groups
4. Enable group membership in token:
   - Go to **Client Scopes** → **roles** → **Mappers**
   - Create a new **Group Membership** mapper
   - Set **Token Claim Name**: `groups`
   - Enable **Full group path**: Off

#### Option B: Using Client Roles

1. Navigate to **Clients** → `infraeye-web` → **Roles**
2. Create roles:
   - `admin`
   - `devops`
   - `trainee`
3. Assign roles to users via **Users** → Select User → **Role Mapping**

### 5. Create Test Users

1. Navigate to **Users** → **Add User**
2. Set **Username** and **Email**
3. Click **Save**
4. Go to **Credentials** tab → **Set Password**
5. Assign to appropriate group or role

## InfraEye Configuration

### Environment Variables

Add these variables to your `.env` file or environment:

```bash
# Enable OIDC Authentication
OIDC_ENABLED=true

# Keycloak Configuration
OIDC_ISSUER_URL=https://keycloak.yourdomain.com/realms/infraeye
OIDC_CLIENT_ID=infraeye-web
OIDC_CLIENT_SECRET=your-client-secret-from-keycloak
OIDC_REDIRECT_URL=https://infraeye.yourdomain.com/api/auth/oidc/callback
OIDC_SCOPES=openid profile email roles

# JWT Secret (for internal token signing)
JWT_SECRET=your-strong-random-secret-key
```

### Configuration Details

| Variable | Description | Example |
|----------|-------------|---------|
| `OIDC_ENABLED` | Enable/disable OIDC auth | `true` or `false` |
| `OIDC_ISSUER_URL` | Keycloak realm URL | `https://keycloak.example.com/realms/infraeye` |
| `OIDC_CLIENT_ID` | Client ID from Keycloak | `infraeye-web` |
| `OIDC_CLIENT_SECRET` | Client secret from Keycloak credentials tab | `abc123...` |
| `OIDC_REDIRECT_URL` | Callback URL (must match Keycloak config) | `https://infraeye.example.com/api/auth/oidc/callback` |
| `OIDC_SCOPES` | OAuth scopes to request | `openid profile email roles` |

### Docker Compose Example

```yaml
services:
  app:
    image: ghcr.io/mnshchtri/infra-eye:latest
    environment:
      - OIDC_ENABLED=true
      - OIDC_ISSUER_URL=https://keycloak.yourdomain.com/realms/infraeye
      - OIDC_CLIENT_ID=infraeye-web
      - OIDC_CLIENT_SECRET=${OIDC_CLIENT_SECRET}
      - OIDC_REDIRECT_URL=https://infraeye.yourdomain.com/api/auth/oidc/callback
      - OIDC_SCOPES=openid profile email roles
      - JWT_SECRET=${JWT_SECRET}
```

### Kubernetes Deployment

Create a secret:

```bash
kubectl create secret generic infraeye-oidc \
  --from-literal=client-secret='your-client-secret' \
  --from-literal=jwt-secret='your-jwt-secret' \
  -n infra-eye
```

Update deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: infraeye
  namespace: infra-eye
spec:
  template:
    spec:
      containers:
      - name: infraeye
        env:
        - name: OIDC_ENABLED
          value: "true"
        - name: OIDC_ISSUER_URL
          value: "https://keycloak.yourdomain.com/realms/infraeye"
        - name: OIDC_CLIENT_ID
          value: "infraeye-web"
        - name: OIDC_CLIENT_SECRET
          valueFrom:
            secretKeyRef:
              name: infraeye-oidc
              key: client-secret
        - name: OIDC_REDIRECT_URL
          value: "https://infraeye.yourdomain.com/api/auth/oidc/callback"
        - name: OIDC_SCOPES
          value: "openid profile email roles"
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: infraeye-oidc
              key: jwt-secret
```

## Role Mapping

InfraEye automatically maps Keycloak groups/roles to internal roles:

### Mapping Logic

The system checks in this order:

1. **Groups** (from `groups` claim)
2. **Roles** (from `roles` claim)
3. **Default** → `intern`

### Mapping Table

| Keycloak Group/Role | InfraEye Role | Permissions |
|---------------------|---------------|-------------|
| `infraeye-admin` or contains `admin` | `admin` | Full system access, user management |
| `infraeye-devops` or contains `devops` | `devops` | Server management, resources, alerts |
| `infraeye-trainee` or contains `trainee` | `trainee` | Limited resource access |
| (none or other) | `intern` | Read-only access to dashboard |

### Custom Role Mapping

To customize role mapping, edit `backend/internal/handlers/oidc.go`:

```go
func mapOIDCRoleToInfraEye(userInfo *OIDCUserInfo) string {
    // Add your custom logic here
    for _, group := range userInfo.Groups {
        if group == "engineering-leads" {
            return "admin"
        }
        if strings.HasPrefix(group, "ops-") {
            return "devops"
        }
    }
    return "intern"
}
```

## Frontend Integration

The frontend automatically detects OIDC configuration via `/api/auth/oidc/config`.

### Login Flow

1. User clicks **"Sign in with SSO"** button
2. Frontend calls `/api/auth/oidc/login`
3. User is redirected to Keycloak login page
4. After authentication, Keycloak redirects to `/api/auth/oidc/callback`
5. Backend validates the token and creates/updates user
6. Backend issues internal JWT token
7. User is logged into InfraEye

### Traditional Login Fallback

When OIDC is enabled, you can still use traditional username/password login via `/api/auth/login`. This is useful for:

- Emergency admin access
- Local testing
- Users not in the OIDC system

## Testing

### 1. Verify OIDC Configuration

```bash
curl http://localhost:8080/api/auth/oidc/config
```

Expected response:
```json
{
  "enabled": true,
  "issuer_url": "https://keycloak.yourdomain.com/realms/infraeye",
  "client_id": "infraeye-web"
}
```

### 2. Test Discovery Endpoint

```bash
curl https://keycloak.yourdomain.com/realms/infraeye/.well-known/openid-configuration
```

Should return OIDC discovery document.

### 3. Test Login Flow

1. Navigate to InfraEye login page
2. Click **"Sign in with SSO"**
3. Log in with test user credentials
4. Verify you're redirected back and logged in

### 4. Check Backend Logs

```bash
docker logs infra-eye-app | grep OIDC
```

Look for:
```
OIDC initialized successfully with issuer: https://keycloak.yourdomain.com/realms/infraeye
Created new OIDC user: john.doe@example.com (email: john.doe@example.com, role: devops)
```

## Troubleshooting

### Issue: "OIDC is not configured"

**Cause**: `OIDC_ENABLED` is not set to `true` or configuration is missing.

**Solution**:
1. Verify `.env` file has `OIDC_ENABLED=true`
2. Restart the backend: `docker compose restart app`

### Issue: "Failed to fetch OIDC discovery"

**Cause**: Backend cannot reach Keycloak or issuer URL is wrong.

**Solution**:
1. Check network connectivity: `curl https://keycloak.yourdomain.com/realms/infraeye/.well-known/openid-configuration`
2. Verify `OIDC_ISSUER_URL` is correct (no trailing slash before `/realms`)
3. Check firewall rules

### Issue: "Invalid redirect URI"

**Cause**: Redirect URI in Keycloak doesn't match `OIDC_REDIRECT_URL`.

**Solution**:
1. In Keycloak, go to **Clients** → `infraeye-web` → **Settings**
2. Add exact redirect URI: `https://infraeye.yourdomain.com/api/auth/oidc/callback`
3. Save

### Issue: "Token exchange failed"

**Cause**: Invalid client secret or client configuration.

**Solution**:
1. Verify `OIDC_CLIENT_SECRET` matches Keycloak **Credentials** tab
2. Ensure **Access Type** is `confidential`
3. Check backend logs for detailed error

### Issue: "User created with wrong role"

**Cause**: Role mapping not configured correctly.

**Solution**:
1. Verify user has correct group assignment in Keycloak
2. Check **Client Scopes** → **roles** → **Mappers** includes `groups` claim
3. Test token content: decode the ID token at https://jwt.io

### Issue: SSL/TLS Errors

**Cause**: Certificate validation issues.

**Solution**:
- Development: Use HTTP for Keycloak or disable cert validation (not recommended)
- Production: Ensure valid SSL certificates on both InfraEye and Keycloak

## Security Best Practices

1. **Use HTTPS in Production**: Never send tokens over HTTP in production
2. **Strong Client Secret**: Generate cryptographically random client secrets (32+ characters)
3. **Rotate Secrets**: Periodically rotate `JWT_SECRET` and `OIDC_CLIENT_SECRET`
4. **Limit Token Lifetime**: Configure reasonable token expiration in Keycloak
5. **Audit Logging**: Monitor authentication events in both Keycloak and InfraEye
6. **Least Privilege**: Assign users to the minimum required role
7. **Backup Admin**: Keep at least one local admin account for emergency access

## Migration from Local Auth to OIDC

If you're migrating from local authentication:

1. **Enable OIDC** but keep local auth working
2. **Match user emails**: Ensure Keycloak users have same email as local users
3. **Test thoroughly**: Verify all existing users can log in via OIDC
4. **Gradual rollout**: Inform users about the new login method
5. **Keep fallback**: Maintain local admin account for emergencies

Users will be automatically matched by email when they first log in via OIDC.

## Advanced Configuration

### Custom Token Claims

To use custom claims from Keycloak:

1. Add mapper in Keycloak **Client Scopes**
2. Update `OIDCUserInfo` struct in `backend/internal/handlers/oidc.go`
3. Modify `syncOIDCUser()` to process custom claims

### Multiple OIDC Providers

To support multiple providers, you'll need to:

1. Create separate handler functions for each provider
2. Add provider-specific routes (e.g., `/api/auth/google/login`, `/api/auth/azure/login`)
3. Store provider information in user record

### Session Management

Current implementation issues JWT tokens with 24-hour expiration. To add refresh tokens:

1. Store OIDC refresh token in secure cookie or database
2. Implement `/api/auth/refresh` endpoint
3. Use refresh token to get new access token before expiration

## Support

For issues specific to:
- **Keycloak configuration**: See [Keycloak Documentation](https://www.keycloak.org/documentation)
- **InfraEye OIDC**: Open an issue on [GitHub](https://github.com/mnshchtri/infra-eye/issues)
- **General OIDC**: Refer to [OpenID Connect Specification](https://openid.net/connect/)

---

**Last Updated**: July 2026  
**InfraEye Version**: 1.0+  
**Tested with**: Keycloak 23.0, Auth0, Okta

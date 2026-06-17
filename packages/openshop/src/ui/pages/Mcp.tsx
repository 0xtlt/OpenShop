import { useEffect, useMemo, useState } from 'preact/hooks'
import { apiFetch, apiJson } from '../fetch'
import { eventChecked, eventValue } from '../events'
import type { BannerTone, McpCapabilitySummary, McpPermissionSummary, McpTokenSummary } from '../types'

interface AppBridgeModal extends HTMLElement {
  hideOverlay(): void
}

function hideModal(id: string) {
  ;(document.getElementById(id) as AppBridgeModal | null)?.hideOverlay()
}

function showToast(message: string, opts?: { duration?: number; isError?: boolean }) {
  if (!window.shopify?.toast) return false
  window.shopify.toast.show(message, opts)
  return true
}

function formatDate(value: string | null): string {
  if (!value) return 'Never'
  return new Date(value).toLocaleString()
}

function permissionGroups(permissions: Record<string, McpPermissionSummary>) {
  const groups = new Map<string, McpPermissionSummary[]>()
  for (const permission of Object.values(permissions)) {
    groups.set(permission.group, [...(groups.get(permission.group) ?? []), permission])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function expirationPayload(choice: string) {
  if (choice === 'none') return { expiresInDays: null }
  return { expiresInDays: Number(choice) }
}

function TokenMetadata({ token, fontSize = '12px' }: { token: Pick<McpTokenSummary, 'tokenId' | 'tokenFingerprint'>; fontSize?: string }) {
  return (
    <span style={{ color: '#6d7175', fontSize }}>
      Token ID <code>{token.tokenId}</code> · Fingerprint <code>{token.tokenFingerprint}</code>
    </span>
  )
}

export default function Mcp() {
  const [capabilities, setCapabilities] = useState<McpCapabilitySummary | null>(null)
  const [tokens, setTokens] = useState<McpTokenSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<McpTokenSummary | null>(null)
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState('')
  const [newExpiration, setNewExpiration] = useState('90')
  const [newPermissions, setNewPermissions] = useState<Set<string>>(new Set())
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null)
  const [mcpUrl, setMcpUrl] = useState('/mcp')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: BannerTone; text: string } | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  const groups = useMemo(() => permissionGroups(capabilities?.permissions ?? {}), [capabilities])
  const permissionKeys = useMemo(() => groups.flatMap(([, permissions]) => permissions.map((permission) => permission.key)), [groups])
  const selected = tokens.find((token) => token.id === selectedId) ?? null
  const allNewPermissionsSelected = permissionKeys.length > 0 && permissionKeys.every((permission) => newPermissions.has(permission))
  const allSelectedPermissionsSelected = permissionKeys.length > 0 && permissionKeys.every((permission) => selectedPermissions.has(permission))

  const loadCapabilities = async () => {
    const data = await apiJson<McpCapabilitySummary>('/api/mcp/capabilities')
    setCapabilities(data)
  }

  const loadTokens = async () => {
    const data = await apiJson<McpTokenSummary[]>('/api/mcp/tokens')
    setTokens(data)
    if (!selectedId && data[0]) setSelectedId(data[0].id)
  }

  const loadSelectedDetail = async (id: string | null) => {
    if (!id) {
      setSelectedDetail(null)
      setSelectedPermissions(new Set())
      return
    }
    const data = await apiJson<McpTokenSummary>(`/api/mcp/tokens/${id}`)
    setSelectedDetail(data)
    setSelectedPermissions(new Set(data.permissions.filter((permission) => capabilities?.permissions[permission])))
  }

  useEffect(() => {
    Promise.all([loadCapabilities(), loadTokens()]).catch((error) => {
      setMsg({ tone: 'critical', text: error instanceof Error ? error.message : String(error) })
    })
  }, [])

  useEffect(() => {
    setMcpUrl(new URL('/mcp', window.location.origin).toString())
  }, [])

  useEffect(() => {
    loadSelectedDetail(selectedId).catch((error) => {
      setMsg({ tone: 'critical', text: error instanceof Error ? error.message : String(error) })
    })
  }, [selectedId, capabilities])

  const toggleSet = (current: Set<string>, key: string, enabled: boolean) => {
    const next = new Set(current)
    if (enabled) next.add(key)
    else next.delete(key)
    return next
  }

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      const text = `${label} copied.`
      if (!showToast(text)) setMsg({ tone: 'success', text })
    } catch {
      const text = `Unable to copy ${label.toLowerCase()}.`
      setMsg({ tone: 'critical', text })
      showToast(text, { isError: true })
    }
  }

  const openEditToken = (token: McpTokenSummary) => {
    const knownPermissions = capabilities?.permissions
    setSelectedId(token.id)
    setSelectedDetail(null)
    setSelectedPermissions(new Set(token.permissions.filter((permission) => !knownPermissions || knownPermissions[permission])))
    setEditError(null)
  }

  const createToken = async () => {
    if (!newName.trim()) {
      setCreateError('Token name is required.')
      return
    }
    setBusy('create')
    setMsg(null)
    setCreateError(null)
    try {
      const res = await apiFetch('/api/mcp/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          ...expirationPayload(newExpiration),
          permissions: [...newPermissions],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Unable to create token')
      setOneTimeToken(data.token)
      setNewName('')
      setNewExpiration('90')
      setNewPermissions(new Set())
      setSelectedId(data.item.id)
      await loadTokens()
      hideModal('create-mcp-token-modal')
      showToast('Token created')
      setMsg({ tone: 'success', text: 'Token created. Copy it now; it will not be shown again.' })
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const savePermissions = async () => {
    if (!selected) return
    setBusy('permissions')
    setMsg(null)
    setEditError(null)
    try {
      const res = await apiFetch(`/api/mcp/tokens/${selected.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: [...selectedPermissions] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Unable to save permissions')
      await loadTokens()
      await loadSelectedDetail(selected.id)
      hideModal('edit-mcp-token-modal')
      showToast('Permissions saved')
      setMsg({ tone: 'success', text: 'Permissions saved.' })
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      setEditError(text)
      showToast(text, { isError: true })
    } finally {
      setBusy(null)
    }
  }

  const patchToken = async (token: McpTokenSummary, status: 'active' | 'disabled') => {
    setBusy(token.id)
    try {
      const res = await apiFetch(`/api/mcp/tokens/${token.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Unable to update token')
      await loadTokens()
    } catch (error) {
      setMsg({ tone: 'critical', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }

  const revokeToken = async (token: McpTokenSummary) => {
    setBusy(token.id)
    try {
      const res = await apiFetch(`/api/mcp/tokens/${token.id}/revoke`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Unable to revoke token')
      await loadTokens()
      await loadSelectedDetail(token.id)
    } catch (error) {
      setMsg({ tone: 'critical', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }

  const rotateToken = async (token: McpTokenSummary) => {
    setBusy(token.id)
    setMsg(null)
    try {
      const res = await apiFetch(`/api/mcp/tokens/${token.id}/rotate`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Unable to rotate token')
      setOneTimeToken(data.token)
      await loadTokens()
      await loadSelectedDetail(token.id)
      showToast('Token rotated')
      setMsg({ tone: 'success', text: 'Token rotated. Copy the new value now.' })
    } catch (error) {
      setMsg({ tone: 'critical', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
    <s-modal id="create-mcp-token-modal" heading="Create token" accessibility-label="Create MCP token">
      <s-stack direction="block" gap="base">
        {createError && <s-banner tone="critical">{createError}</s-banner>}
        <s-grid gridTemplateColumns="@container (inline-size > 700px) 2fr 1fr, 1fr" gap="base">
          <s-text-field
            label="Name"
            value={newName}
            onInput={(event) => setNewName(eventValue(event))}
            placeholder="Claude Desktop"
          />
          <s-select label="Expiration" value={newExpiration} onChange={(event) => setNewExpiration(eventValue(event))}>
            <s-option value="30">30 days</s-option>
            <s-option value="90">90 days</s-option>
            <s-option value="365">1 year</s-option>
            <s-option value="none">No expiration</s-option>
          </s-select>
        </s-grid>

        <s-box>
          <s-stack direction="inline" justifyContent="space-between" alignItems="center">
            <s-text type="strong">Permissions</s-text>
            <span style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <s-button
                variant="secondary"
                onClick={() => setNewPermissions(new Set(permissionKeys))}
                disabled={permissionKeys.length === 0 || allNewPermissionsSelected}
              >
                Select all
              </s-button>
              <s-button
                variant="secondary"
                onClick={() => setNewPermissions(new Set())}
                disabled={newPermissions.size === 0}
              >
                Clear all
              </s-button>
            </span>
          </s-stack>
          <div style={{ maxHeight: '55vh', overflowY: 'auto', paddingRight: '4px' }}>
            {groups.map(([group, permissions]) => (
              <div key={group} style={{ marginTop: '12px' }}>
                <div style={{ fontWeight: 600, marginBottom: '6px' }}>{group}</div>
                <div style={{ display: 'grid', gap: '6px' }}>
                  {permissions.map((permission) => (
                    <div key={permission.key} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px', alignItems: 'start' }}>
                      <s-checkbox
                        label={permission.label}
                        labelAccessibilityVisibility="exclusive"
                        checked={newPermissions.has(permission.key)}
                        onChange={(event) => setNewPermissions((current) => toggleSet(current, permission.key, eventChecked(event)))}
                      />
                      <span>
                        <strong>{permission.label}</strong>
                        <span style={{ color: '#6d7175' }}> — {permission.key}</span>
                        {permission.description && <div style={{ color: '#6d7175', fontSize: '12px' }}>{permission.description}</div>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </s-box>
      </s-stack>
      <s-button slot="primary-action" variant="primary" onClick={createToken} disabled={busy === 'create'}>
        {busy === 'create' ? 'Creating...' : 'Create token'}
      </s-button>
      <s-button slot="secondary-actions" variant="secondary" commandFor="create-mcp-token-modal" command="--hide">
        Cancel
      </s-button>
    </s-modal>

    <s-modal id="edit-mcp-token-modal" heading={selected ? `Edit ${selected.name}` : 'Edit token'} accessibility-label="Edit MCP token" size="large">
      <s-stack direction="block" gap="base">
        {editError && <s-banner tone="critical">{editError}</s-banner>}
        {selected ? (
          <>
            <s-box paddingBlockEnd="base">
              <s-stack gap="small">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-badge tone={selected.status === 'active' ? 'success' : selected.status === 'revoked' ? 'critical' : 'neutral'}>
                    {selected.status}
                  </s-badge>
                  <TokenMetadata token={selected} fontSize="14px" />
                </s-stack>
                <s-text color="subdued">Expires {formatDate(selected.expiresAt)} · Last used {formatDate(selected.lastUsedAt)}</s-text>
              </s-stack>
            </s-box>

            <s-box>
              <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                <s-text type="strong">Permissions</s-text>
                <s-text color="subdued">{selectedPermissions.size} of {permissionKeys.length} selected</s-text>
              </s-stack>
              <s-box paddingBlockStart="small">
                <span style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <s-button
                    variant="secondary"
                    onClick={() => setSelectedPermissions(new Set(permissionKeys))}
                    disabled={permissionKeys.length === 0 || allSelectedPermissionsSelected || selected.status === 'revoked'}
                  >
                    Select all
                  </s-button>
                  <s-button
                    variant="secondary"
                    onClick={() => setSelectedPermissions(new Set())}
                    disabled={selectedPermissions.size === 0 || selected.status === 'revoked'}
                  >
                    Clear all
                  </s-button>
                </span>
              </s-box>
              <div style={{ maxHeight: '45vh', overflowY: 'auto', paddingRight: '4px' }}>
                {groups.map(([group, permissions]) => (
                  <div key={group} style={{ marginTop: '12px' }}>
                    <div style={{ fontWeight: 600, marginBottom: '6px' }}>{group}</div>
                    <div style={{ display: 'grid', gap: '6px' }}>
                      {permissions.map((permission) => (
                        <div key={permission.key} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px', alignItems: 'start' }}>
                          <s-checkbox
                            label={permission.label}
                            labelAccessibilityVisibility="exclusive"
                            checked={selectedPermissions.has(permission.key)}
                            onChange={(event) => setSelectedPermissions((current) => toggleSet(current, permission.key, eventChecked(event)))}
                            disabled={selected.status === 'revoked'}
                          />
                          <span>
                            <strong>{permission.label}</strong>
                            <span style={{ color: '#6d7175' }}> — {permission.key}</span>
                            {permission.description && <div style={{ color: '#6d7175', fontSize: '12px' }}>{permission.description}</div>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </s-box>

            {selectedDetail?.recentAudits && selectedDetail.recentAudits.length > 0 && (
              <s-box paddingBlockStart="base">
                <s-text type="strong">Recent audit</s-text>
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Capability</s-table-header>
                    <s-table-header listSlot="inline">Status</s-table-header>
                    <s-table-header listSlot="labeled">When</s-table-header>
                  </s-table-header-row>
	                  <s-table-body>
	                    {selectedDetail.recentAudits.map((audit) => (
	                      <s-table-row key={audit.id}>
	                        <s-table-cell>
	                          {audit.capabilityName ?? 'auth'}
	                          {audit.targetShop && <div style={{ color: '#6d7175', fontSize: '12px' }}>{audit.targetShop}</div>}
	                        </s-table-cell>
	                        <s-table-cell>
	                          <s-badge tone={audit.status === 'success' ? 'success' : audit.status === 'denied' ? 'warning' : 'critical'}>
                            {audit.status}
                          </s-badge>
                        </s-table-cell>
                        <s-table-cell>{formatDate(audit.createdAt)}</s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              </s-box>
            )}
          </>
        ) : (
          <s-text color="subdued">Select a token to edit.</s-text>
        )}
      </s-stack>
      <s-button slot="primary-action" variant="primary" onClick={savePermissions} disabled={!selected || busy === 'permissions' || selected.status === 'revoked'}>
        {busy === 'permissions' ? 'Saving...' : 'Save permissions'}
      </s-button>
      <s-button slot="secondary-actions" variant="secondary" commandFor="edit-mcp-token-modal" command="--hide">
        Cancel
      </s-button>
    </s-modal>

    <s-page heading="MCP">
      <s-button
        slot="primary-action"
        variant="primary"
        commandFor="create-mcp-token-modal"
        command="--show"
        disabled={!capabilities}
        onClick={() => setCreateError(null)}
      >
        Create token
      </s-button>

      {msg && <s-banner tone={msg.tone}>{msg.text}</s-banner>}
      {oneTimeToken && (
        <s-banner tone="warning" heading="Copy this token now">
          <s-stack gap="small">
            <s-text>This value is shown once. Store it before leaving this page.</s-text>
            <s-box padding="base" background="subdued" borderRadius="base" borderWidth="base" borderColor="base">
              <code style={{ wordBreak: 'break-all' }}>{oneTimeToken}</code>
            </s-box>
            <s-button variant="secondary" onClick={() => copyText(oneTimeToken, 'Token')}>Copy token</s-button>
          </s-stack>
        </s-banner>
      )}

      <s-section heading="MCP endpoint" accessibilityLabel="MCP endpoint">
        <s-grid gridTemplateColumns="@container (inline-size > 700px) 1fr auto, 1fr" gap="base" alignItems="center">
          <s-box padding="base" background="subdued" borderRadius="base" borderWidth="base" borderColor="base">
            <code style={{ wordBreak: 'break-all' }}>{mcpUrl}</code>
          </s-box>
          <s-button variant="secondary" onClick={() => copyText(mcpUrl, 'MCP URL')}>Copy URL</s-button>
        </s-grid>
      </s-section>

      {tokens.length === 0 ? (
        <s-section accessibilityLabel="MCP tokens empty state">
          <s-grid justifyItems="center" paddingBlock="large-300">
            <s-box maxInlineSize="420px">
              <s-stack gap="base" alignItems="center">
                <s-text type="strong">No MCP tokens yet</s-text>
                <s-text color="subdued">Create a scoped token to let an MCP client call OpenShop tools and resources.</s-text>
                <s-button
                  variant="primary"
                  commandFor="create-mcp-token-modal"
                  command="--show"
                  disabled={!capabilities}
                  onClick={() => setCreateError(null)}
                >
                  Create token
                </s-button>
              </s-stack>
            </s-box>
          </s-grid>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel="MCP tokens">
          <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Name</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header listSlot="labeled">Expires</s-table-header>
            <s-table-header listSlot="labeled">Last used</s-table-header>
            <s-table-header></s-table-header>
          </s-table-header-row>
          <s-table-body>
            {tokens.map((token) => (
              <s-table-row key={token.id}>
                <s-table-cell>
                  <s-text type="strong">{token.name}</s-text>
                  <div><TokenMetadata token={token} /></div>
                  {token.stalePermissions.length > 0 && (
                    <div style={{ color: '#8a6116', fontSize: '12px' }}>Stale: {token.stalePermissions.join(', ')}</div>
                  )}
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={token.status === 'active' ? 'success' : token.status === 'revoked' ? 'critical' : 'neutral'}>
                    {token.status}
                  </s-badge>
                </s-table-cell>
                <s-table-cell>{formatDate(token.expiresAt)}</s-table-cell>
                <s-table-cell>{formatDate(token.lastUsedAt)}</s-table-cell>
                <s-table-cell>
                  <span style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <s-button
                      variant="secondary"
                      commandFor="edit-mcp-token-modal"
                      command="--show"
                      onClick={() => openEditToken(token)}
                    >
                      Edit
                    </s-button>
                    {token.status === 'active'
                      ? <s-button variant="secondary" onClick={() => patchToken(token, 'disabled')} disabled={busy === token.id}>Disable</s-button>
                      : token.status === 'disabled'
                        ? <s-button variant="secondary" onClick={() => patchToken(token, 'active')} disabled={busy === token.id}>Enable</s-button>
                        : null}
                    <s-button variant="secondary" onClick={() => rotateToken(token)} disabled={busy === token.id || token.status === 'revoked'}>Rotate</s-button>
                    <s-button variant="secondary" tone="critical" onClick={() => revokeToken(token)} disabled={busy === token.id || token.status === 'revoked'}>Revoke</s-button>
                  </span>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
          </s-table>
        </s-section>
      )}

    </s-page>
    </>
  )
}

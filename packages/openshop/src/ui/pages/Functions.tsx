import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { apiJson } from '../fetch'
import { eventChecked, eventValue } from '../events'
import type { BannerTone } from '../types'
import { FunctionInstances } from './functions/FunctionInstances'
import { FunctionList } from './functions/FunctionList'
import {
  defaultValues,
  getPath,
  hasConfigFields,
  payloadValues,
  resolveConfigurationPath,
  setPath,
} from './functions/model'
import { TYPE_LABELS, type FunctionDef, type FunctionField, type FunctionInstance } from './functions/types'

export default function Functions({ handle, action }: { handle?: string; action?: string }) {
  if (handle && action === 'new') return <FunctionForm handle={handle} />
  if (handle && action) return <FunctionForm handle={handle} instanceId={action} />
  if (handle) return <FunctionInstances handle={handle} />
  return <FunctionList />
}

interface FunctionFieldRendererProps {
  fieldKey: string
  field: FunctionField
  value: unknown
  disabled: boolean
  onChange: (key: string, value: unknown) => void
}

function FunctionFieldRenderer({ fieldKey, field, value, disabled, onChange }: FunctionFieldRendererProps) {
  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
    return (
      <s-stack gap="small">
        <s-text>{field.label}</s-text>
        {field.options?.map((option) => (
          <s-checkbox
            key={option.value}
            label={option.label}
            checked={selected.includes(option.value)}
            disabled={disabled}
            onChange={(event) => {
              const next = eventChecked(event)
                ? [...selected, option.value]
                : selected.filter((entry) => entry !== option.value)
              onChange(fieldKey, next)
            }}
          />
        ))}
      </s-stack>
    )
  }

  if (field.type === 'checkbox') {
    return (
      <s-checkbox
        label={field.label}
        checked={value === true}
        disabled={disabled}
        onChange={(event) => onChange(fieldKey, eventChecked(event))}
      />
    )
  }

  if (field.type === 'select') {
    return (
      <s-select
        label={field.label}
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        onChange={(event) => onChange(fieldKey, eventValue(event))}
      >
        {field.options?.map((option) => (
          <s-option key={option.value} value={option.value}>{option.label}</s-option>
        ))}
      </s-select>
    )
  }

  if (field.type === 'number') {
    return (
      <s-number-field
        label={field.label}
        placeholder={field.placeholder}
        value={value === null || value === undefined ? '' : String(value)}
        disabled={disabled}
        onInput={(event) => onChange(fieldKey, eventValue(event))}
      />
    )
  }

  if (field.type === 'password') {
    return (
      <s-password-field
        label={field.label}
        placeholder={field.placeholder}
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        onInput={(event) => onChange(fieldKey, eventValue(event))}
      />
    )
  }

  return (
    <s-text-field
      label={field.label}
      placeholder={field.placeholder}
      value={value === null || value === undefined ? '' : String(value)}
      disabled={disabled}
      onInput={(event) => onChange(fieldKey, eventValue(event))}
    />
  )
}

function FunctionForm({ handle, instanceId }: { handle: string; instanceId?: string }) {
  const [fnDef, setFnDef] = useState<FunctionDef | null>(null)
  const [instance, setInstance] = useState<FunctionInstance | null>(null)
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [msg, setMsg] = useState<{ tone: BannerTone; text: string } | null>(null)
  const { route } = useLocation()
  const isEdit = Boolean(instanceId)

  useEffect(() => {
    let disposed = false
    setLoading(true)
    setMsg(null)

    const load = async () => {
      try {
        const [definitions, instances] = await Promise.all([
          apiJson<FunctionDef[]>('/api/functions'),
          instanceId
            ? apiJson<FunctionInstance[]>(`/api/functions/${handle}/instances`)
            : Promise.resolve([]),
        ])
        if (disposed) return
        const definition = definitions.find((candidate) => candidate.handle === handle)
        if (!definition) throw new Error(`Function "${handle}" was not found`)
        const loadedInstance = instanceId
          ? instances.find((candidate) => candidate.id === decodeURIComponent(instanceId))
          : undefined
        if (instanceId && !loadedInstance) throw new Error('Function instance was not found')

        setFnDef(definition)
        setInstance(loadedInstance ?? null)
        setSettings(loadedInstance?.settings ?? defaultValues(definition.settingsFields, true))
        setConfig(
          loadedInstance?.config.state === 'valid'
            ? loadedInstance.config.value
            : defaultValues(definition.configFields, false),
        )
      } catch (caught) {
        if (!disposed) setMsg({ tone: 'critical', text: caught instanceof Error ? caught.message : 'Unable to load function' })
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    void load()
    return () => { disposed = true }
  }, [handle, instanceId])

  const updateSettingsField = (key: string, value: unknown) => {
    setSettings((current) => setPath(current, key, value))
  }
  const updateConfigField = (key: string, value: unknown) => {
    setConfig((current) => ({ ...current, [key]: value }))
  }

  const save = async () => {
    if (!fnDef) return
    setSaving(true)
    setMsg(null)
    try {
      const input: Record<string, unknown> = {}
      if (!isEdit || instance?.operations.updateSettings) {
        input.settings = payloadValues(settings, fnDef.settingsFields, true)
      }
      if (hasConfigFields(fnDef) && (!isEdit || instance?.operations.updateConfig)) {
        input.config = payloadValues(config, fnDef.configFields, false)
      }
      const endpoint = isEdit
        ? `/api/functions/${handle}/instances/${encodeURIComponent(instanceId!)}`
        : `/api/functions/${handle}/instances`
      await apiJson(endpoint, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (isEdit) {
        setMsg({ tone: 'success', text: 'Updated.' })
      } else {
        route(`/functions/${handle}`)
      }
    } catch (caught) {
      setMsg({ tone: 'critical', text: caught instanceof Error ? caught.message : 'Unable to save instance' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!instanceId) return
    setDeleting(true)
    setMsg(null)
    try {
      await apiJson(`/api/functions/${handle}/instances/${encodeURIComponent(instanceId)}`, { method: 'DELETE' })
      route(`/functions/${handle}`)
    } catch (caught) {
      setMsg({ tone: 'critical', text: caught instanceof Error ? caught.message : 'Unable to delete instance' })
    } finally {
      setDeleting(false)
    }
  }

  if (loading || !fnDef) {
    return (
      <s-page heading="Loading...">
        <s-link slot="breadcrumb-actions" href={`/functions/${handle}`}>Function</s-link>
        {msg && <s-banner tone={msg.tone}>{msg.text}</s-banner>}
        {loading && <s-box padding="large-500"><s-text color="subdued">Loading...</s-text></s-box>}
      </s-page>
    )
  }

  const typeLabel = TYPE_LABELS[fnDef.type] ?? fnDef.type
  const canUpdate = Boolean(instance?.operations.updateSettings || instance?.operations.updateConfig)
  const canSave = !isEdit || canUpdate
  const configurationPath = instance
    ? resolveConfigurationPath(fnDef.ui?.configurationPath, instance.id)
    : null

  return (
    <>
      {isEdit && instance?.operations.delete && (
        <s-modal id="delete-function-instance-modal" heading="Delete instance" accessibility-label="Confirm function instance deletion">
          <s-text>This will permanently remove this function instance from Shopify.</s-text>
          <s-button slot="primary-action" variant="primary" tone="critical" onClick={remove} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </s-button>
          <s-button slot="secondary-actions" variant="secondary" commandFor="delete-function-instance-modal" command="--hide">
            Cancel
          </s-button>
        </s-modal>
      )}
      <s-page heading={isEdit ? `Edit ${instance?.label ?? fnDef.label}` : `New ${typeLabel}`}>
        <s-link slot="breadcrumb-actions" href={`/functions/${handle}`} onClick={(event: Event) => { event.preventDefault(); route(`/functions/${handle}`) }}>
          {fnDef.label}
        </s-link>
        {canSave && (
          <s-button slot="primary-action" variant="primary" onClick={save} disabled={saving}>
            {saving ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save' : 'Create')}
          </s-button>
        )}

        <s-stack gap="large-100">
          {msg && <s-banner tone={msg.tone}>{msg.text}</s-banner>}

          {isEdit && !instance?.operations.updateSettings && (
            <s-banner tone="info">
              Shopify does not support settings updates for this owner. Its current settings are read-only.
            </s-banner>
          )}

          {instance?.config.state === 'invalid' && hasConfigFields(fnDef) && (
            <s-banner tone="critical">
              The stored owner config contains invalid JSON. Saving the config below will replace it.
            </s-banner>
          )}

          {configurationPath && (
            <s-box padding="large-100" background="subdued" borderRadius="large">
              <s-link href={configurationPath}>{fnDef.ui?.configurationLabel ?? 'Open business configuration'}</s-link>
            </s-box>
          )}

          {Object.keys(fnDef.settingsFields).length > 0 && (
            <s-box padding="large-100" background="base" border="base" borderRadius="large">
              <s-stack gap="base">
                <s-heading>Settings</s-heading>
                {Object.entries(fnDef.settingsFields).map(([key, field]) => (
                  <FunctionFieldRenderer
                    key={key}
                    fieldKey={key}
                    field={field}
                    value={getPath(settings, key)}
                    disabled={Boolean(isEdit && !instance?.operations.updateSettings)}
                    onChange={updateSettingsField}
                  />
                ))}
              </s-stack>
            </s-box>
          )}

          {hasConfigFields(fnDef) && (
            <s-box padding="large-100" background="base" border="base" borderRadius="large">
              <s-stack gap="base">
                <s-heading>Owner config</s-heading>
                {Object.entries(fnDef.configFields).map(([key, field]) => (
                  <FunctionFieldRenderer
                    key={key}
                    fieldKey={key}
                    field={field}
                    value={config[key]}
                    disabled={Boolean(isEdit && !instance?.operations.updateConfig)}
                    onChange={updateConfigField}
                  />
                ))}
              </s-stack>
            </s-box>
          )}

          {isEdit && instance?.operations.delete && (
            <s-box padding="large-100" background="base" border="base" borderRadius="large">
              <s-stack gap="base">
                <s-heading>Danger zone</s-heading>
                <s-paragraph>This will permanently remove this function instance from Shopify.</s-paragraph>
                <s-button variant="secondary" tone="critical" commandFor="delete-function-instance-modal" command="--show" disabled={deleting}>
                  {deleting ? 'Deleting...' : 'Delete instance'}
                </s-button>
              </s-stack>
            </s-box>
          )}
        </s-stack>
      </s-page>
    </>
  )
}

import { eventChecked, eventValue } from '../events'

export interface ConfigField {
  type: 'text' | 'password' | 'number' | 'select' | 'checkbox'
  label: string
  placeholder?: string
  options?: { label: string; value: string }[]
  hasValue?: boolean
}

interface ConfigFieldRendererProps {
  fieldKey: string
  field: ConfigField
  value: string
  onChange: (key: string, value: string) => void
}

export function ConfigFieldRenderer({ fieldKey, field, value, onChange }: ConfigFieldRendererProps) {
  if (field.type === 'password') {
    return (
      <s-password-field
        label={field.label}
        placeholder={field.hasValue ? 'Saved; leave blank to keep' : field.placeholder}
        value={value}
        onInput={(event) => onChange(fieldKey, eventValue(event))}
      />
    )
  }

  if (field.type === 'number') {
    return (
      <s-number-field
        label={field.label}
        placeholder={field.placeholder}
        value={value}
        onInput={(event) => onChange(fieldKey, eventValue(event))}
      />
    )
  }

  if (field.type === 'checkbox') {
    return (
      <s-checkbox
        label={field.label}
        checked={value === 'true'}
        onChange={(event) => onChange(fieldKey, String(eventChecked(event)))}
      />
    )
  }

  if (field.type === 'select' && field.options) {
    return (
      <s-select
        label={field.label}
        value={value}
        onChange={(event) => onChange(fieldKey, eventValue(event))}
      >
        {field.options.map((option) => <s-option key={option.value} value={option.value}>{option.label}</s-option>)}
      </s-select>
    )
  }

  return (
    <s-text-field
      label={field.label}
      placeholder={field.placeholder}
      value={value}
      onInput={(event) => onChange(fieldKey, eventValue(event))}
    />
  )
}

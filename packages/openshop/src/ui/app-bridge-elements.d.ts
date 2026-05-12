import type { ComponentChildren } from 'preact'

type ElementProps = {
  children?: ComponentChildren
  [attribute: string]: unknown
}

declare module 'preact' {
  namespace createElement.JSX {
    interface IntrinsicElements {
      'ui-nav-menu': ElementProps
      'ui-modal': ElementProps & { id?: string }
      'ui-title-bar': ElementProps & { id?: string; title?: string }
    }
  }
}

export {}

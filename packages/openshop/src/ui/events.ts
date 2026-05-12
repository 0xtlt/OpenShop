export function eventValue(event: Event): string {
  return String((event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null)?.value ?? '')
}

export function eventChecked(event: Event): boolean {
  return Boolean((event.target as HTMLInputElement | null)?.checked)
}

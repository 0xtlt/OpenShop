import {
  getClientMigrationStatus,
  type MigrationStatus,
} from './schema.ts'

export async function printMigrationStatus(cwd: string): Promise<void> {
  const client = await getClientMigrationStatus(cwd)
  printStatusGroup('Client', client)
}

function printStatusGroup(label: string, status: MigrationStatus): void {
  console.log(`${label} migrations:`)
  if (!status.folder) {
    console.log('  folder: none')
    console.log('  applied: 0')
    console.log('  pending: 0')
    return
  }

  console.log(`  folder: ${status.folder}`)
  console.log(`  applied: ${status.applied.length}${status.applied.length ? ` (${status.applied.join(', ')})` : ''}`)
  console.log(`  pending: ${status.pending.length}${status.pending.length ? ` (${status.pending.join(', ')})` : ''}`)
}

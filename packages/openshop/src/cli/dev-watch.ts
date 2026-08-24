import { existsSync, watch, type FSWatcher } from 'node:fs'
import { resolve } from 'node:path'

export function watchAppDirectories(
  cwd: string,
  directoryNames: readonly string[],
  onChange: (source: string) => void,
): () => void {
  const allowedDirectories = new Set(directoryNames)
  const directoryWatchers = new Map<string, FSWatcher>()

  function watchDirectory(name: string): boolean {
    if (directoryWatchers.has(name)) return true

    const directory = resolve(cwd, name)
    if (!existsSync(directory)) return false

    try {
      const watcher = watch(directory, { recursive: true }, (_, filename) => {
        if (!filename) return
        const source = String(filename).replace(/\\/g, '/')
        if (!source.startsWith('.')) onChange(source)
      })
      watcher.on('error', () => {
        watcher.close()
      })
      watcher.on('close', () => {
        if (directoryWatchers.get(name) === watcher) directoryWatchers.delete(name)
      })
      directoryWatchers.set(name, watcher)
      return true
    } catch {
      return false
    }
  }

  for (const name of directoryNames) watchDirectory(name)

  let rootWatcher: FSWatcher | undefined
  try {
    rootWatcher = watch(cwd, (_, filename) => {
      const sources = filename
        ? [String(filename).replace(/\\/g, '/')]
        : directoryNames.filter((name) => !directoryWatchers.has(name))

      for (const source of sources) {
        const directoryName = source.split('/')[0]
        if (!directoryName || !allowedDirectories.has(directoryName)) continue
        if (directoryWatchers.has(directoryName)) continue
        if (watchDirectory(directoryName)) onChange(source)
      }
    })
    rootWatcher.on('error', () => rootWatcher?.close())
  } catch { /* cwd is expected to exist */ }

  return () => {
    rootWatcher?.close()
    for (const watcher of directoryWatchers.values()) watcher.close()
    directoryWatchers.clear()
  }
}

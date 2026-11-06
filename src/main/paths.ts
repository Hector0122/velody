import { app, shell } from 'electron'
import { join, resolve, sep } from 'path'

// Single library location for both `pnpm dev` and the installed app:
// <userData>/output/stems (Linux: ~/.config/velody/output/stems). Dev used to
// write into the repo's own output/ folder, which meant two separate libraries
// and hundreds of MB of stems sitting inside the project.
export function getStemsRootDir(): string {
  return join(app.getPath('userData'), 'output', 'stems')
}

export function getPythonWorkerDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'python-worker')
  }
  return join(__dirname, '../../python-worker')
}

/** True when `path` is strictly inside `dir` (not `dir` itself, no `..` escape). */
export function isInsideDir(path: string, dir: string): boolean {
  return resolve(path).startsWith(resolve(dir) + sep)
}

/** Opens web links in the browser; anything else (file:, other apps' schemes) is ignored. */
export function openExternalUrl(url: string): Promise<void> {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'http:' || protocol === 'https:') return shell.openExternal(url)
  } catch {
    /* not a URL */
  }
  return Promise.resolve()
}

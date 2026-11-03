import { app } from 'electron'
import { join } from 'path'

// Single library location for both `pnpm dev` and the installed app:
// <userData>/output/stems (Linux: ~/.config/velody/output/stems). Dev used to
// write into the repo's own output/ folder, which meant two separate libraries
// and hundreds of MB of stems sitting inside the project.
export function getStemsRootDir(): string {
  return join(app.getPath('userData'), 'output', 'stems')
}

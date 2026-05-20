import { ipcMain, dialog } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'

export function registerIpcHandlers(): void {
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Audio Files', extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('separation:start', async (_event, songPath: string) => {
    const pythonScript = join(__dirname, '../../python-worker/separate.py')
    const pythonProcess = spawn('python3', [pythonScript, songPath], {
      cwd: join(__dirname, '../../python-worker')
    })

    return new Promise<string[]>((resolve, reject) => {
      let output = ''

      pythonProcess.stdout.on('data', (data: Buffer) => {
        output += data.toString().trim()
      })

      pythonProcess.stderr.on('data', (data: Buffer) => {
        console.error(`Python error: ${data}`)
      })

      pythonProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const stems = JSON.parse(output) as string[]
            resolve(stems)
          } catch {
            reject(new Error('Failed to parse Python output'))
          }
        } else {
          reject(new Error(`Python process exited with code ${code}`))
        }
      })

      pythonProcess.on('error', (err) => {
        reject(err)
      })
    })
  })
}

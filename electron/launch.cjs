/**
 * Electron launcher — When ELECTRON_RUN_AS_NODE=1 is inherited from VSCode terminal,
 * Electron starts as a regular Node.js process instead of a browser process,
 * causing require('electron') to fail. This wrapper removes that env variable
 * before spawning electron.exe.
 */
const { spawn } = require('child_process')
const electron = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, process.argv.slice(2), {
  stdio: 'inherit',
  env,
  windowsHide: false,
})

child.on('close', (code, signal) => {
  if (code === null) {
    console.error('electron exited with signal', signal)
    process.exit(1)
  }
  process.exit(code)
})

process.on('SIGINT', () => { if (!child.killed) child.kill('SIGINT') })
process.on('SIGTERM', () => { if (!child.killed) child.kill('SIGTERM') })

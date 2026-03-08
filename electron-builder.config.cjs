/**
 * @type {import('electron-builder').Configuration}
 */
module.exports = {
  appId: 'com.strata-sync.app',
  productName: 'STRATA SYNC',
  copyright: 'Copyright © 2026 Smilegate',
  directories: {
    output: 'release',
  },
  files: [
    'dist/**/*',
    'electron/**/*',
    'ico.png',
    'strata-sync-icon.svg',
  ],
  win: {
    target: ['nsis', 'portable'],
    icon: 'ico.png',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'STRATA SYNC',
  },
  mac: {
    target: ['dmg'],
    icon: 'ico.png',
    category: 'public.app-category.productivity',
  },
}

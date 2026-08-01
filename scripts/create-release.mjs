import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(rootDir, 'dist')
const staticSourceDir = path.join(rootDir, 'static')
const releaseDir = path.join(rootDir, 'cocos-mcp-server-pkg')

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, { recursive: true })
}

function copyFile(source, destination) {
  fs.copyFileSync(source, destination)
}

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required release file not found: ${path.relative(rootDir, filePath)}`)
  }
}

ensureFile(path.join(distDir, 'main.cjs'))
ensureFile(path.join(distDir, 'scene.cjs'))
ensureFile(staticSourceDir)
ensureFile(path.join(rootDir, 'i18n'))
ensureFile(path.join(rootDir, 'README.md'))
ensureFile(path.join(rootDir, 'README.EN.md'))
ensureFile(path.join(rootDir, 'package.json'))

// Keep dist usable for local Cocos debugging as well as for the release package.
const distStaticDir = path.join(distDir, 'static')
fs.rmSync(distStaticDir, { recursive: true, force: true })
copyDirectory(staticSourceDir, distStaticDir)

fs.rmSync(releaseDir, { recursive: true, force: true })
fs.mkdirSync(releaseDir, { recursive: true })

copyDirectory(distDir, path.join(releaseDir, 'dist'))
copyDirectory(path.join(rootDir, 'i18n'), path.join(releaseDir, 'i18n'))
copyFile(path.join(rootDir, 'README.md'), path.join(releaseDir, 'README.md'))
copyFile(path.join(rootDir, 'README.EN.md'), path.join(releaseDir, 'README.EN.md'))

const sourcePackage = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'),
)

// The release manifest is consumed by Cocos Creator, not by pnpm.
delete sourcePackage.$schema
delete sourcePackage.scripts
delete sourcePackage.dependencies
delete sourcePackage.devDependencies
delete sourcePackage.packageManager
sourcePackage.files = ['README.EN.md', 'README.md', 'dist/', 'i18n/', 'package.json']

fs.writeFileSync(
  path.join(releaseDir, 'package.json'),
  `${JSON.stringify(sourcePackage, null, 2)}\n`,
)

console.log(`Release package created at ${path.relative(rootDir, releaseDir)}/`)

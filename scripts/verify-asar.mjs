#!/usr/bin/env node
/**
 * Verifies a packaged app.asar contains every runtime dependency the app needs.
 *
 * electron-builder's pnpm dependency collector can silently drop a transitive
 * production dependency — v1.1.0 shipped without `ms` (electron-updater →
 * builder-util-runtime → debug → ms) and crashed on launch with
 * "Cannot find module 'ms'". This walks the real production dependency tree
 * (dependencies + optionalDependencies, resolved from node_modules the way
 * Node does) and fails if any package is missing from the asar.
 *
 * Usage: node scripts/verify-asar.mjs [path/to/app.asar]
 *        (default: dist/linux-unpacked/resources/app.asar)
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const asarPath = resolve(
  process.argv[2] ?? join(REPO_ROOT, 'dist/linux-unpacked/resources/app.asar')
)

if (!existsSync(asarPath)) {
  console.error(`app.asar not found: ${asarPath}`)
  process.exit(1)
}

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')

// Package names packed anywhere in the asar (top-level or nested node_modules).
const packed = new Set()
for (const file of asar.listPackage(asarPath)) {
  const m = file.replace(/\\/g, '/').match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\/package\.json$/)
  if (m) packed.add(m[1])
}

function findPackageDir(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) return realpathSync(dirname(candidate))
    if (dirname(dir) === dir) return null
  }
}

const needed = new Map() // real dir -> package name
const missingFromDisk = []
function walk(dir, isRoot) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const optional = isRoot ? {} : (pkg.optionalDependencies ?? {})
  for (const name of Object.keys({ ...pkg.dependencies, ...optional })) {
    const depDir = findPackageDir(name, dir)
    if (!depDir) {
      if (!(name in optional)) missingFromDisk.push(`${name} (required by ${pkg.name})`)
      continue
    }
    if (needed.has(depDir)) continue
    needed.set(depDir, name)
    walk(depDir, false)
  }
}
walk(REPO_ROOT, true)

const missing = [...new Set(needed.values())].filter((name) => !packed.has(name)).sort()

if (missingFromDisk.length) {
  console.error('Dependencies not installed in node_modules:\n  ' + missingFromDisk.join('\n  '))
}
if (missing.length) {
  console.error(
    `app.asar is missing ${missing.length} runtime dependenc${missing.length === 1 ? 'y' : 'ies'}:\n  ` +
      missing.join('\n  ') +
      '\nAdd them as direct dependencies in package.json (see the v1.1.0 `ms` incident).'
  )
}
if (missing.length || missingFromDisk.length) process.exit(1)
console.log(`app.asar OK — all ${needed.size} runtime dependencies are packed (${asarPath})`)

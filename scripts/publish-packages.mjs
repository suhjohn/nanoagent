#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packages = [
  { label: 'agent', dir: 'packages/kernel', name: '@nanoagent/kernel' },
  { label: 'plugin', dir: 'packages/plugin', name: '@nanoagent/plugin' }
]

const args = process.argv.slice(2)
const options = {
  bump: 'patch',
  publish: false,
  write: true,
  otp: undefined
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--publish') {
    options.publish = true
  } else if (arg === '--dry-run') {
    options.publish = false
  } else if (arg === '--no-write') {
    options.write = false
  } else if (arg === '--version') {
    options.version = args[++i]
  } else if (arg === '--bump') {
    options.bump = args[++i]
  } else if (arg === '--otp') {
    options.otp = args[++i]
  } else if (arg === '--help' || arg === '-h') {
    usage(0)
  } else {
    console.error(`unknown argument: ${arg}`)
    usage(1)
  }
}

if (options.version && options.bump !== 'patch') {
  fail('use --version or --bump, not both')
}

if (!['major', 'minor', 'patch'].includes(options.bump)) {
  fail('--bump must be major, minor, or patch')
}

const manifests = Object.fromEntries(
  packages.map(pkg => [pkg.name, readPackage(pkg)])
)

if (options.publish) {
  run('npm', ['whoami'])
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8'
  })
  if (status.status !== 0) {
    fail('could not read git status')
  }
  if (status.stdout.trim()) {
    console.warn('publishing with uncommitted changes:')
    console.warn(status.stdout.trim())
  }
}

const latestVersions = Object.fromEntries(
  packages.map(pkg => [pkg.name, npmLatest(pkg.name)])
)
const baseVersion = maxVersion(
  packages.flatMap(pkg => [
    manifests[pkg.name].version,
    latestVersions[pkg.name]
  ])
)
const targetVersion = options.version ?? bump(baseVersion, options.bump)

assertVersion(targetVersion)

for (const pkg of packages) {
  const latest = latestVersions[pkg.name]
  if (latest && compareVersions(targetVersion, latest) <= 0) {
    fail(`${pkg.name}@${targetVersion} cannot publish over latest ${latest}`)
  }
}

if (options.write) {
  writePackages(targetVersion)
} else {
  console.log(`would set packages to ${targetVersion}`)
}

runPackageCommands('agent', ['format:check', 'typecheck', 'test', 'build'])
runPackageCommands('plugin', ['format:check', 'typecheck', 'test', 'build'])

for (const pkg of packages) {
  const publishArgs = ['publish', '--access', 'public']
  if (!options.publish) {
    publishArgs.push('--dry-run')
  }
  if (options.otp) {
    publishArgs.push('--otp', options.otp)
  }
  run('npm', publishArgs, { cwd: join(root, pkg.dir) })
}

console.log(
  options.publish
    ? `published @nanoagent packages at ${targetVersion}`
    : `dry-run passed for @nanoagent packages at ${targetVersion}`
)

function usage(code) {
  console.log(`Usage:
  node scripts/publish-packages.mjs [--bump major|minor|patch]
  node scripts/publish-packages.mjs --version 0.1.4
  node scripts/publish-packages.mjs --version 0.1.4 --publish
  node scripts/publish-packages.mjs --version 0.1.4 --publish --otp 123456

Default runs npm publish --dry-run after writing package versions.`)
  process.exit(code)
}

function readPackage(pkg) {
  return JSON.parse(readFileSync(join(root, pkg.dir, 'package.json'), 'utf8'))
}

function writePackages(version) {
  for (const pkg of packages) {
    const manifest = { ...manifests[pkg.name], version }
    if (pkg.name === '@nanoagent/plugin') {
      manifest.peerDependencies = {
        ...manifest.peerDependencies,
        '@nanoagent/kernel': version
      }
    }
    writeFileSync(
      join(root, pkg.dir, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`
    )
  }
  console.log(`set @nanoagent packages to ${version}`)
}

function runPackageCommands(label, commands) {
  const pkg = packages.find(candidate => candidate.label === label)
  for (const command of commands) {
    run('bun', ['run', command], { cwd: join(root, pkg.dir) })
  }
}

function npmLatest(name) {
  const result = spawnSync('npm', ['view', name, 'version', '--json'], {
    cwd: root,
    encoding: 'utf8'
  })
  if (result.status === 0) {
    return JSON.parse(result.stdout)
  }
  if (result.stderr.includes('E404') || result.stdout.includes('E404')) {
    return undefined
  }
  process.stderr.write(result.stderr)
  fail(`could not read npm version for ${name}`)
}

function run(command, commandArgs, runOptions = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: runOptions.cwd ?? root,
    stdio: 'inherit'
  })
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(' ')} failed`)
  }
}

function bump(version, type) {
  const parsed = parseVersion(version)
  if (type === 'major') {
    return `${parsed.major + 1}.0.0`
  }
  if (type === 'minor') {
    return `${parsed.major}.${parsed.minor + 1}.0`
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
}

function maxVersion(versions) {
  return versions.filter(Boolean).reduce((max, version) =>
    compareVersions(version, max) > 0 ? version : max
  )
}

function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  )
}

function assertVersion(version) {
  parseVersion(version)
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '')
  if (!match) {
    fail(`invalid semver version: ${version}`)
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

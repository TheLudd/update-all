import { execSync } from 'child_process'
import fsExtra from 'fs-extra'
import { resolve } from 'path'
import { groupBy } from 'yafu'
import { prop, replace, test, filter, both } from 'ramda'

const { readFileSync, readJSONSync, writeFileSync } = fsExtra

const cwd = process.cwd()
const opts = { cwd }

const params = process.argv.slice(2) 
const wantsLatest = test(/-l/, params.join(' '))
const targetedModules = params.filter((s) => !s.startsWith('-'))

const workspaceInfo = JSON.parse(execSync('yarn -s workspaces info', opts))

const { name: pkgName } = readJSONSync(resolve(cwd, 'package.json'))
const baseMapping = {
  [pkgName]: ''
}

const workspaceMapping = Object.entries(workspaceInfo).reduce((acc, item) => {
  const [ key, value ] = item
  const { location } = value
  acc[key] = location
  return acc
}, baseMapping)


function parseLine (line) {
  const [ dependencyName, currentVersion, wantedVersion, latestVersion, workspace ] = line.split(/\s+/)
  return {
    currentVersion,
    dependencyName,
    latestVersion,
    wantedVersion,
    workspace,
  }
}

function wantsUpdate (dep) {
  const { currentVersion } = dep
  return getNewVersion(dep) !== currentVersion
}

function filterWantedUpdates (parsedLines) {
  const targetSet = new Set(targetedModules)
  const isTargeted = ({ dependencyName }) => targetSet.size === 0 || targetSet.has(dependencyName)
  return filter(both(isTargeted, wantsUpdate), parsedLines)
}

function parseOutdated (string) {
  const lines = string.split('\n')
  const headerLine = lines.findIndex((l) => l.startsWith('Package'))
  const doneLine = lines.findIndex((l) => l.startsWith('Done'))
  const payloadLines = lines.slice(headerLine + 1, doneLine)
  const parsedLines = payloadLines.map(parseLine)
  const wantedUpdates = filterWantedUpdates(parsedLines)
  return groupBy(prop('workspace'), wantedUpdates)
}

const isRegularVersion = test(/^\d+\.\d+\.\d+$/)

function getNewVersion (dep) {
  const { wantedVersion, latestVersion } = dep

  return (wantsLatest && isRegularVersion(latestVersion)) ? latestVersion : wantedVersion
}

function updatePackageFile ([ moduleName, dependencies ]) {
  const modulePath = workspaceMapping[moduleName]
  const filePath = resolve(cwd, modulePath, 'package.json')
  const fileContents = readFileSync(filePath, 'utf-8')
  const newFileContents = dependencies.reduce((acc, item) => {
    const { dependencyName } = item
    const newVersion = getNewVersion(item)
    const regex = new RegExp(`"${dependencyName}": "(\\^|~)?\\d+\.\\d+\.\\d+"`)
    const replacement = `"${dependencyName}": "$1${newVersion}"`
    return replace(regex, replacement, acc)
  }, fileContents)

  if (fileContents !== newFileContents) {
    writeFileSync(filePath, newFileContents)
  }
}

try {
  execSync('yarn outdated', opts)
} catch (e) {
  const { stdout } = e
  const groups = parseOutdated(stdout.toString('utf-8'))
  Object.entries(groups).forEach(updatePackageFile)
}


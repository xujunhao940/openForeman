import {existsSync, readdirSync, readFileSync, realpathSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import type {Plugin} from 'vite'

type Manifest = {
    name: string
    version: string
    license?: string
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
}

function readManifest(file: string): Manifest {
    return JSON.parse(readFileSync(file, 'utf8'))
}

export function openSourceLicenses(): Plugin {
    const id = 'virtual:open-source-licenses'
    const chromiumFile = 'node_modules/electron/dist/LICENSES.chromium.html'
    let root: string
    let command: 'build' | 'serve'

    return {
        name: 'open-source-licenses',
        configResolved(config) {
            root = config.root
            command = config.command
        },
        resolveId(source) {
            if (source === id) return '\0' + id
        },
        load(source) {
            if (source !== '\0' + id) return

            const entries = new Map<string, {
                name: string
                version: string
                license: string | null
                notices: {file: string; text: string}[]
            }>()
            const visited = new Set<string>()

            const resolvePackage = (name: string, importer: string) =>
                createRequire(importer).resolve.paths(name)
                    ?.map(directory => path.join(directory, name, 'package.json'))
                    .find(existsSync)

            function visit(file: string) {
                const manifest = realpathSync(file)
                if (visited.has(manifest)) return
                visited.add(manifest)

                const {name, version, license, dependencies, optionalDependencies, peerDependencies} = readManifest(manifest)
                const directory = path.dirname(manifest)
                const notices = readdirSync(directory, {withFileTypes: true})
                    .filter(entry => entry.isFile() && /^(?:licen[cs]e|copying|notice|copyright)(?:[._-]|$)/i.test(entry.name))
                    .map(entry => ({file: entry.name, text: readFileSync(path.join(directory, entry.name), 'utf8')}))
                entries.set(`${name}@${version}`, {name, version, license: license ?? null, notices})

                for (const dependency of Object.keys({...peerDependencies, ...dependencies, ...optionalDependencies})) {
                    const child = resolvePackage(dependency, manifest)
                    if (child) visit(child)
                }
            }

            const appManifest = path.join(root, 'package.json')
            this.addWatchFile(appManifest)
            const {dependencies, optionalDependencies} = readManifest(appManifest)
            for (const name of Object.keys({...dependencies, ...optionalDependencies, electron: true})) {
                const file = resolvePackage(name, appManifest)
                if (file) visit(file)
            }

            const chromium = path.join(root, chromiumFile)
            let chromiumExport = 'export const chromiumNotices = null'
            if (existsSync(chromium)) {
                if (command === 'build') {
                    const asset = this.emitFile({
                        type: 'asset',
                        fileName: 'LICENSES.chromium.html',
                        source: readFileSync(chromium),
                    })
                    chromiumExport = `export const chromiumNotices = import.meta.ROLLUP_FILE_URL_${asset}`
                } else {
                    chromiumExport = `export const chromiumNotices = '/${chromiumFile}'`
                }
            }
            const sorted = Array.from(entries.values()).sort((a, b) =>
                a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en', {numeric: true}))
            return `export const licenses = ${JSON.stringify(sorted)}\n${chromiumExport}`
        },
    }
}

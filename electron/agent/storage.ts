import {createHash, randomUUID} from 'node:crypto'
import {formatPatch, structuredPatch} from 'diff'
import {execFile} from 'node:child_process'
import {constants} from 'node:fs'
import {promisify} from 'node:util'
import {mkdir, open, readFile, readdir, realpath, lstat, writeFile, rename, unlink, chmod} from 'node:fs/promises'
import path from 'node:path'
import type {CheckpointInfo, ReviewFile, TurnChanges} from '../../shared/agent'

const exec = promisify(execFile)
export async function readJson<T>(file: string, fallback: T): Promise<T> {
    try { return JSON.parse(await readFile(file, 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error }
}
export async function atomicJson(file: string, value: unknown) {
    await mkdir(path.dirname(file), {recursive: true})
    const temp = `${file}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(value), {mode: 0o600})
    await rename(temp, file)
}
export async function canonicalProject(input: string) {
    if (typeof input !== 'string' || !input.trim()) throw new Error('Choose a project directory first.')
    const cwd = await realpath(path.resolve(input))
    if (!(await lstat(cwd)).isDirectory()) throw new Error('Project path must be a directory.')
    return cwd
}
export function workspaceDir(dataDir: string, cwd: string) {
    return path.join(dataDir, 'workspaces', createHash('sha256').update(cwd).digest('hex'))
}
export function isWithin(root: string, file: string) {
    const relative = path.relative(root, file)
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}
export async function safeProjectFile(cwd: string, input: string) {
    const target = path.resolve(cwd, input)
    if (!isWithin(cwd, target) || target === cwd || path.relative(cwd, target).split(path.sep).includes('.git')) {
        throw new Error('File mutations must stay inside the project and outside .git.')
    }
    let existing = target
    for (;;) {
        try {
            if (!isWithin(cwd, await realpath(existing))) throw new Error('Symlink points outside the project.')
            break
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            existing = path.dirname(existing)
        }
    }
    return target
}
const excluded = new Set(['.git', 'node_modules', '.yarn', 'dist', 'dist-electron', 'release', '.DS_Store'])
async function mapConcurrent<T, R>(items: T[], limit: number, map: (item: T, signal: AbortSignal) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length)
    const controller = new AbortController()
    let next = 0
    await Promise.all(Array.from({length: Math.min(limit, items.length)}, async () => {
        try {
            while (!controller.signal.aborted && next < items.length) {
                const index = next++
                results[index] = await map(items[index], controller.signal)
            }
        } catch (error) { controller.abort(error) }
    }))
    controller.signal.throwIfAborted()
    return results
}
async function walk(cwd: string, prefix = ''): Promise<string[]> {
    const entries = await readdir(path.join(cwd, prefix), {withFileTypes: true})
    const files: string[] = []
    for (const entry of entries) {
        if (excluded.has(entry.name)) continue
        const name = path.join(prefix, entry.name)
        if (entry.isDirectory()) files.push(...await walk(cwd, name))
        else files.push(name)
        if (files.length > 4000) throw new Error('Checkpoint limit: 4,000 files. Add generated files to .gitignore.')
    }
    return files
}
export async function projectFiles(cwd: string) {
    try {
        const {stdout} = await exec('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'], {cwd, maxBuffer: 4 * 1024 * 1024})
        return [...new Set(stdout.split('\0').filter(Boolean))].filter(file => !file.split('/').some(part => excluded.has(part)))
    } catch (error) {
        if ((error as {code?: number | string}).code !== 128 && (error as {code?: number | string}).code !== 'ENOENT') throw error
        return walk(cwd)
    }
}
type FileVersion = {content: string; mode: number}
type Snapshot = {info: CheckpointInfo; files: Record<string, FileVersion>}
type Manifest = {snapshots: CheckpointInfo[]; cursor: number}
const same = (a?: FileVersion, b?: FileVersion) => a?.content === b?.content && a?.mode === b?.mode
const base64Size = (bytes: number) => Math.ceil(bytes / 3) * 4
export class CheckpointStore {
    constructor(private directory: string, private cwd: string) {}
    async state() { return readJson<Manifest>(path.join(this.directory, 'checkpoints.json'), {snapshots: [], cursor: -1}) }
    private async save(state: Manifest) { await atomicJson(path.join(this.directory, 'checkpoints.json'), state) }
    private async snapshot(id: string) {
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid checkpoint ID.')
        return readJson<Snapshot>(path.join(this.directory, `${id}.json`), null)
    }
    private async version(file: string, account?: (encodedBytes: number) => void, signal?: AbortSignal): Promise<FileVersion | undefined> {
        const target = await safeProjectFile(this.cwd, file)
        try {
            signal?.throwIfAborted()
            // Windows lacks O_NOFOLLOW. Verify the opened file against the inspected path there.
            const entry = constants.O_NOFOLLOW ? undefined : await lstat(target)
            if (entry && !entry.isFile()) throw new Error(`Checkpoint cannot include non-regular file: ${file}`)
            const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
            try {
                const stat = await handle.stat()
                if (!stat.isFile()) throw new Error(`Checkpoint cannot include non-regular file: ${file}`)
                if (entry && (entry.dev !== stat.dev || entry.ino !== stat.ino)) throw new Error(`File changed while opening checkpoint: ${file}`)
                if (stat.size > 8 * 1024 * 1024) throw new Error(`Checkpoint file exceeds 8 MiB: ${file}`)
                signal?.throwIfAborted()
                const reserved = base64Size(stat.size)
                account?.(reserved)
                // One extra byte detects growth without allocating for an unbounded, changing file.
                const buffer = Buffer.allocUnsafe(stat.size + 1)
                let size = 0
                do {
                    signal?.throwIfAborted()
                    const {bytesRead} = await handle.read(buffer, size, buffer.length - size)
                    if (!bytesRead) break
                    size += bytesRead
                } while (size < buffer.length)
                if (size > stat.size) throw new Error(`File grew while creating checkpoint: ${file}. Retry after writes finish.`)
                signal?.throwIfAborted()
                if (size < stat.size) account?.(base64Size(size) - reserved)
                return {content: buffer.toString('base64', 0, size), mode: stat.mode & 0o777}
            } finally { await handle.close() }
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code
            if (code === 'ENOENT') return
            if (code === 'ELOOP') throw new Error(`Checkpoint cannot include non-regular file: ${file}`)
            throw error
        }
    }
    async capture(label: string) {
        return (await this.captureSnapshot(label)).snapshot.info
    }
    async finishRun(beforeId: string): Promise<TurnChanges> {
        const {snapshot, previous} = await this.captureSnapshot('After run')
        const afterId = snapshot.info.id
        if (beforeId === afterId) return {beforeId, afterId, files: []}
        const before = previous?.info.id === beforeId ? previous : await this.snapshot(beforeId)
        if (!before) throw new Error('Checkpoint is unavailable.')
        return {beforeId, afterId, files: compareSnapshots(before, snapshot)}
    }
    private async captureSnapshot(label: string) {
        const names = await projectFiles(this.cwd)
        if (names.length > 4000) throw new Error('Checkpoint limit: 4,000 files.')
        const files: Snapshot['files'] = {}
        let size = 0
        const account = (encodedBytes: number) => {
            size += encodedBytes
            if (size > 48 * 1024 * 1024) throw new Error('Checkpoint exceeds 36 MiB. Ignore large generated files first.')
        }
        const versions = await mapConcurrent(names, 16, (name, signal) => this.version(name, account, signal))
        for (let index = 0; index < names.length; index++) {
            const name = names[index]
            const value = versions[index]
            if (value) files[name] = value
        }
        const state = await this.state()
        const current = state.snapshots[state.cursor]
        const previous = current ? await this.snapshot(current.id) : undefined
        if (previous && Object.keys(previous.files).length === Object.keys(files).length
            && Object.keys(files).every(file => same(files[file], previous.files[file]))) {
            return {snapshot: previous, previous}
        }
        const info = {id: randomUUID(), label, createdAt: new Date().toISOString(), files: Object.keys(files).length}
        const snapshots = state.snapshots.slice(0, state.cursor + 1)
        snapshots.push(info)
        const snapshot = {info, files}
        await atomicJson(path.join(this.directory, `${info.id}.json`), snapshot)
        await this.save({snapshots, cursor: snapshots.length - 1})
        return {snapshot, previous}
    }
    async restore(id: string) {
        const state = await this.state()
        const cursor = state.snapshots.findIndex(item => item.id === id)
        if (cursor < 0 || state.cursor < 0) throw new Error('Checkpoint does not exist.')
        const [from, to] = await Promise.all([this.snapshot(state.snapshots[state.cursor].id), this.snapshot(id)])
        const changes = [...new Set([...Object.keys(from.files), ...Object.keys(to.files)])].filter(file => !same(from.files[file], to.files[file]))
        // Preflight every path before writing anything. Unrelated files are preserved.
        for (const file of changes) {
            if (!same(await this.version(file), from.files[file])) throw new Error(`Restore conflict: ${file} changed outside this checkpoint. Save or review it first.`)
        }
        const apply = async (file: string, version?: FileVersion) => {
            const target = await safeProjectFile(this.cwd, file)
            if (!version) await unlink(target)
            else {
                await mkdir(path.dirname(target), {recursive: true})
                await writeFile(target, Buffer.from(version.content, 'base64'), {mode: version.mode})
                await chmod(target, version.mode)
            }
        }
        const applied: string[] = []
        try {
            for (const file of changes) { await apply(file, to.files[file]); applied.push(file) }
            await this.save({...state, cursor})
        } catch (error) {
            for (const file of applied.reverse()) await apply(file, from.files[file])
            throw error
        }
    }
    async changedFiles(beforeId: string, afterId: string) {
        const [before, after] = await Promise.all([this.snapshot(beforeId), this.snapshot(afterId)])
        if (!before || !after) throw new Error('Checkpoint is unavailable.')
        return compareSnapshots(before, after)
    }
}

function compareSnapshots(before: Snapshot, after: Snapshot) {
    const names = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])]
        .filter(file => !same(before.files[file], after.files[file]))
    return names.map(file => {
        const old = before.files[file] ? Buffer.from(before.files[file].content, 'base64') : undefined
        const next = after.files[file] ? Buffer.from(after.files[file].content, 'base64') : undefined
        const binary = !!old?.includes(0) || !!next?.includes(0)
        const delta = binary ? undefined : structuredPatch(file, file, old?.toString('utf8') ?? '', next?.toString('utf8') ?? '', '', '', {context: 3})
        const fullPatch = delta ? formatPatch(delta) : ''
        const patch = fullPatch.slice(0, 80000)
        let additions = 0
        let deletions = 0
        for (const hunk of delta?.hunks ?? []) {
            for (const line of hunk.lines) {
                if (line.startsWith('+')) additions++
                else if (line.startsWith('-')) deletions++
            }
        }
        return {path: file, status: !old ? 'added' as const : !next ? 'deleted' as const : 'modified' as const,
            additions, deletions,
            patch, binary, truncated: fullPatch.length > patch.length}
    })
}

async function diffBase(cwd: string) {
    const hasHead = await exec('git', ['rev-parse', '--verify', 'HEAD'], {cwd}).then(() => true, () => false)
    return hasHead ? 'HEAD' : (await exec('git', ['hash-object', '-t', 'tree', process.platform === 'win32' ? 'NUL' : '/dev/null'], {cwd})).stdout.trim()
}

export async function workspaceReview(cwd: string): Promise<ReviewFile[]> {
    const options = {cwd, maxBuffer: 4 * 1024 * 1024}
    const base = await diffBase(cwd)
    const {stdout: stats} = await exec('git', ['diff', base, '--no-ext-diff', '--no-renames', '--numstat', '-z', '--', '.'], options)
    const {stdout: untracked} = await exec('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', '.'], options)
    const tracked = stats.split('\0').filter(Boolean).map(line => {
        const [add, remove, ...name] = line.split('\t')
        return {path: name.join('\t'), additions: Number(add) || 0, deletions: Number(remove) || 0, binary: add === '-'}
    })
    const files: ReviewFile[] = []
    if (tracked.length + untracked.split('\0').filter(Boolean).length > 200) throw new Error('More than 200 changed files. Narrow the changes before reviewing.')
    const reviewed = await mapConcurrent(tracked, 16, async file => {
        const target = await safeProjectFile(cwd, file.path)
        const exists = await lstat(target).then(() => true, () => false)
        const {stdout: patch} = await exec('git', ['diff', base, '--no-ext-diff', '--no-color', '--no-renames', '--', file.path], options)
        return {...file, status: !exists ? 'deleted' as const : patch.includes('new file mode') ? 'added' as const : 'modified' as const,
            patch: patch.slice(0, 160000), truncated: patch.length > 160000}
    })
    files.push(...reviewed)
    for (const file of untracked.split('\0').filter(Boolean)) {
        const target = await safeProjectFile(cwd, file)
        const stat = await lstat(target)
        if (!stat.isFile() || stat.size > 512 * 1024) {
            files.push({path: file, status: 'added', additions: 0, deletions: 0, patch: '', binary: true}); continue
        }
        const buffer = await readFile(target)
        const binary = buffer.includes(0)
        const text = binary ? '' : buffer.toString('utf8')
        const lines = text ? text.replace(/\n$/, '').split('\n') : []
        const patch = lines.length ? `@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join('\n')}` : ''
        files.push({path: file, status: 'added', additions: lines.length, deletions: 0, patch: patch.slice(0, 160000), binary, truncated: patch.length > 160000})
    }
    return files
}
export async function workspaceDiff(cwd: string, options?: {path?: string; summary?: boolean}) {
    const scope = options?.path ? path.relative(cwd, await safeProjectFile(cwd, options.path)) : '.'
    const base = await diffBase(cwd)
    const gitOptions = {cwd, maxBuffer: 2 * 1024 * 1024}
    const diff = (summary: boolean) => exec('git', ['--literal-pathspecs', 'diff', '--relative', base, '--no-ext-diff', '--no-textconv', '--no-color',
        ...(summary ? ['--numstat'] : []), '--', scope], {...gitOptions, maxBuffer: options && !summary ? 16384 : gitOptions.maxBuffer})
    const tracked = async () => {
        if (options?.summary) return (await diff(true)).stdout || 'No tracked changes.'
        try { return (await diff(false)).stdout || 'No tracked changes.' }
        catch (error) {
            if (!options || (error as NodeJS.ErrnoException).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error
            return `Patch exceeds 16 KiB. Showing added/deleted line counts. Request a narrower path or read the file in sections.\n${(await diff(true)).stdout}`
        }
    }
    const [patch, untracked] = await Promise.all([tracked(), exec('git', ['--literal-pathspecs', 'ls-files', '--others', '--exclude-standard', '--', scope], gitOptions)])
    return `${patch}${untracked.stdout ? `\n\nUntracked files:\n${untracked.stdout}` : ''}`
}

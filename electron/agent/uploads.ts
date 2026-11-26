import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {canonicalProject} from './storage'

export async function saveUploads(projectPath: string, files: {filename: string; url: string}[]) {
    if (!Array.isArray(files) || !files.length || files.length > 8) throw new Error('Attach up to 8 files at a time.')
    const cwd = await canonicalProject(projectPath)
    const directory = await mkdtemp(path.join(cwd, '.foreman-upload-'))
    try {
        const paths: string[] = []
        for (const file of files) {
            const comma = file.url.indexOf(',')
            if (comma < 0 || !/^data:[^,]*;base64$/i.test(file.url.slice(0, comma))) throw new Error('Could not read attachment.')
            const bytes = Buffer.from(file.url.slice(comma + 1), 'base64')
            if (bytes.length > 10 * 1024 * 1024) throw new Error('Each attachment must be 10 MB or smaller.')
            const name = file.filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+|[. ]+$/g, '') || 'attachment'
            const folder = path.join(directory, String(paths.length + 1))
            await mkdir(folder)
            const destination = path.join(folder, name)
            await writeFile(destination, bytes, {flag: 'wx', mode: 0o600})
            paths.push(path.relative(cwd, destination))
        }
        return paths
    } catch (error) {
        await rm(directory, {recursive: true, force: true})
        throw error
    }
}

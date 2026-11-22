import {app, BrowserWindow, ipcMain} from 'electron'
import {spawn, type ChildProcess} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import type {AddBackgroundTask, BackgroundTask} from '../shared/background-tasks'
import {atomicJson, canonicalProject} from './agent/storage'

const maxOutputLength = 200_000

export class BackgroundTaskManager {
    private tasks = new Map<string, BackgroundTask>()
    private processes = new Map<string, ChildProcess>()
    private storagePath = path.join(app.getPath('userData'), 'agent', 'background-tasks.json')
    private persistQueue = Promise.resolve()

    async initialize() {
        try {
            const saved = JSON.parse(await readFile(this.storagePath, 'utf8')) as BackgroundTask[]
            for (const task of saved) {
                const restored = {...task, name: task.name || task.command}
                this.tasks.set(task.id, restored.status === 'running'
                    ? {...restored, status: 'stopped', finishedAt: Date.now(), output: `${restored.output}\n[Task interrupted when Foreman closed.]`.slice(-maxOutputLength)}
                    : restored)
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        await this.persist()
    }

    list() { return [...this.tasks.values()].sort((a, b) => b.startedAt - a.startedAt) }

    async add(request: AddBackgroundTask) {
        const name = request.name.trim()
        const command = request.command.trim()
        if (!name || name.length > 120 || !command || command.length > 10_000 || !path.isAbsolute(request.cwd)) throw new Error('Enter a task name, command and valid project folder.')
        const cwd = await canonicalProject(request.cwd)
        const task: BackgroundTask = {id: randomUUID(), name, command, cwd, status: 'ready', startedAt: Date.now(), output: ''}
        this.tasks.set(task.id, task)
        this.publish(task)
        await this.persist()
        return task
    }

    async start(id: string) {
        const task = this.tasks.get(id)
        if (!task) throw new Error('Background task was not found.')
        if (task.status === 'running') return task
        task.status = 'running'; task.startedAt = Date.now(); task.finishedAt = undefined; task.exitCode = undefined; task.output = ''
        const child = spawn(task.command, {cwd: task.cwd, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']})
        this.processes.set(task.id, child)
        const append = (chunk: Buffer) => {
            task.output = `${task.output}${chunk.toString()}`.slice(-maxOutputLength)
            this.publish(task)
        }
        child.stdout?.on('data', append)
        child.stderr?.on('data', append)
        child.once('error', error => {
            task.status = 'failed'; task.finishedAt = Date.now(); task.output = `${task.output}\n${error.message}`.slice(-maxOutputLength)
            this.processes.delete(task.id); this.publish(task); void this.persist()
        })
        child.once('close', (code, signal) => {
            if (task.status === 'running') task.status = signal ? 'stopped' : code === 0 ? 'exited' : 'failed'
            task.finishedAt = Date.now(); task.exitCode = code
            this.processes.delete(task.id); this.publish(task); void this.persist()
        })
        this.publish(task)
        await this.persist()
        return task
    }

    async stop(id: string) {
        const task = this.tasks.get(id)
        const child = this.processes.get(id)
        if (!task || !child || task.status !== 'running') return
        task.status = 'stopped'
        if (child.pid) {
            try {
                if (process.platform === 'win32') child.kill()
                else process.kill(-child.pid, 'SIGTERM')
            } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
        }
        this.publish(task)
        await this.persist()
    }

    async remove(id: string) {
        if (this.processes.has(id)) throw new Error('Stop the task before removing it.')
        this.tasks.delete(id)
        await this.persist()
    }

    async stopAll() { await Promise.all([...this.processes.keys()].map(id => this.stop(id))) }

    private publish(task: BackgroundTask) {
        for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('background-task:event', task)
    }

    private async persist() {
        this.persistQueue = this.persistQueue.catch(() => undefined).then(() => atomicJson(this.storagePath, this.list()))
        await this.persistQueue
    }
}

export function registerBackgroundTaskHandlers() {
    const manager = new BackgroundTaskManager()
    const ready = manager.initialize().catch(error => {
        console.error('Could not restore background tasks.', error)
        throw error
    })
    ipcMain.handle('background-task:list', async () => { await ready; return manager.list() })
    ipcMain.handle('background-task:add', async (_event, request: AddBackgroundTask) => { await ready; return manager.add(request) })
    ipcMain.handle('background-task:start', async (_event, id: string) => { await ready; return manager.start(id) })
    ipcMain.handle('background-task:stop', async (_event, id: string) => { await ready; return manager.stop(id) })
    ipcMain.handle('background-task:remove', async (_event, id: string) => { await ready; return manager.remove(id) })
    app.once('before-quit', () => { void manager.stopAll() })
    return manager
}

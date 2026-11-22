export type BackgroundTaskStatus = 'ready' | 'running' | 'exited' | 'failed' | 'stopped'
export type BackgroundTask = {
    id: string
    name: string
    command: string
    cwd: string
    status: BackgroundTaskStatus
    startedAt: number
    finishedAt?: number
    exitCode?: number | null
    output: string
}
export type AddBackgroundTask = {name: string; command: string; cwd: string}
export interface BackgroundTasksAPI {
    list(): Promise<BackgroundTask[]>
    add(request: AddBackgroundTask): Promise<BackgroundTask>
    start(id: string): Promise<BackgroundTask>
    stop(id: string): Promise<void>
    remove(id: string): Promise<void>
    subscribe(listener: (task: BackgroundTask) => void): () => void
}

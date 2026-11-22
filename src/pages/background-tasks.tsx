import {useEffect, useState} from 'react'
import {Play, Square, Trash2} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select'
import type {BackgroundTask} from '../../shared/background-tasks'

type Project = {id: string; name: string; path: string}

export default function BackgroundTasks({projects, initialProjectId}: {projects: Project[]; initialProjectId: string}) {
    const [projectId, setProjectId] = useState(initialProjectId)
    const [tasks, setTasks] = useState<BackgroundTask[]>([])
    const [error, setError] = useState('')
    useEffect(() => {
        const api = window.backgroundTasksAPI
        if (!api) return
        let active = true
        void api.list().then(items => { if (active) setTasks(items) })
        const unsubscribe = api.subscribe(task => setTasks(current => [task, ...current.filter(item => item.id !== task.id)].sort((a, b) => b.startedAt - a.startedAt)))
        return () => { active = false; unsubscribe() }
    }, [])

    return <section className="background-tasks-page" aria-labelledby="background-tasks-title">
        <header className="background-tasks-header">
            <h1 id="background-tasks-title">Background tasks</h1>
            <Select items={projects.map(item => ({value: item.id, label: item.name}))} value={projectId} onValueChange={value => value && setProjectId(value)}>
                <SelectTrigger aria-label="Project"><SelectValue placeholder="Choose project"/></SelectTrigger>
                <SelectContent><SelectGroup>{projects.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
        </header>
        {error && <p className="background-task-error" role="alert">{error}</p>}
        {!window.backgroundTasksAPI && <p className="background-task-empty">Background tasks require the desktop app.</p>}
        {tasks.length === 0 && window.backgroundTasksAPI ? <p className="background-task-empty">No background tasks.</p> : <ul className="background-task-list">
            {tasks.map(task => <li className="background-task-item" key={task.id}>
                <div className="background-task-summary">
                    <strong title={task.name}>{task.name}</strong>
                    <code title={task.command}>{task.command}</code>
                    <span className={`background-task-status status-${task.status}`}>{task.status}</span>
                    <span className="background-task-cwd" title={task.cwd}>{task.cwd}</span>
                    {task.status === 'running' ? <Button variant="ghost" size="icon-sm" aria-label={`Stop ${task.name}`} title="Stop task" onClick={() => void window.backgroundTasksAPI?.stop(task.id)}><Square/></Button>
                        : <>
                            <Button variant="ghost" size="icon-sm" aria-label={`Start ${task.name}`} title="Start task" onClick={async () => { setError(''); try { await window.backgroundTasksAPI?.start(task.id) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } }}><Play/></Button>
                            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${task.name}`} title="Remove task" onClick={async () => { await window.backgroundTasksAPI?.remove(task.id); setTasks(items => items.filter(item => item.id !== task.id)) }}><Trash2/></Button>
                        </>}
                </div>
                <pre className="background-task-output">{task.output || (task.status === 'running' ? 'Waiting for output…' : task.status === 'ready' ? 'Ready to start' : 'No output')}</pre>
            </li>)}
        </ul>}
    </section>
}

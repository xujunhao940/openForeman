import {spawn, type ChildProcess} from 'node:child_process'
import type {AgentEvent} from '../shared/agent'
import type {SleepMode} from '../shared/power'

export class SleepController {
    private mode: SleepMode = 'off'
    private readonly activeRuns = new Set<string>()
    private process: ChildProcess | null = null

    supported() {
        return process.platform === 'darwin'
    }

    setMode(mode: SleepMode) {
        if (!['screen-on', 'screen-off', 'lid-closed', 'off'].includes(mode)) throw new Error('Invalid sleep mode.')
        if (this.mode !== mode) this.stopProcess()
        this.mode = mode
        this.sync()
    }

    handleAgentEvent(event: AgentEvent) {
        if (event.type !== 'status') return
        const key = `${event.chatId}:${event.runId}`
        if (event.status === 'starting' || event.status === 'running') this.activeRuns.add(key)
        if (event.status === 'done' || event.status === 'error' || event.status === 'stopped') this.activeRuns.delete(key)
        this.sync()
    }

    dispose() {
        this.activeRuns.clear()
        this.stopProcess()
    }

    private sync() {
        if (!this.supported() || this.mode === 'off' || this.activeRuns.size === 0) {
            this.stopProcess()
            return
        }
        if (this.process && this.process.exitCode === null && this.process.signalCode === null) return

        const args = this.mode === 'screen-on'
            ? ['-d', '-i', '-m', '-u']
            : this.mode === 'screen-off'
                ? ['-i', '-m']
                : ['-s', '-i', '-m']
        const child = spawn('caffeinate', args, {stdio: 'ignore'})
        this.process = child
        child.once('error', error => {
            console.error('Could not start caffeinate.', error)
            if (this.process === child) this.process = null
        })
        child.once('exit', () => {
            if (this.process === child) this.process = null
        })
    }

    private stopProcess() {
        const child = this.process
        this.process = null
        if (child && child.exitCode === null && child.signalCode === null) child.kill()
    }
}

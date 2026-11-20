import {workSkills, type WorkspaceMode} from '../../shared/work'
import {useEffect, useRef, useState} from 'react'
import {ArrowUpRight, Cpu, Stop, Shield, CircleQuestion, EyeClosed, ShieldCheck, Hammer, ListCheck, CodeCompare} from '@gravity-ui/icons'
import {QueuedPrompts} from '@/components/queued-prompts'
import {Zap, Pencil, Check, X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog'
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert'
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'
import {Slider} from '@/components/ui/slider'
import {DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem} from '@/components/ui/dropdown-menu'
import {ProjectDetails} from '@/components/project-details'
import {ResponseDiff} from '@/components/response-diff'
import {permissionOptions} from '@/lib/agent-client'
import {ProjectArtwork} from '@/components/project-artwork'
import {Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton} from '@/components/ai-elements/conversation'
import {Message, MessageContent, MessageResponse} from '@/components/ai-elements/message'
import {PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools} from '@/components/ai-elements/prompt-input'
import {Task, TaskContent, TaskItem, TaskTrigger} from '@/components/ai-elements/task'
import {Plan, PlanContent, PlanDescription, PlanHeader, PlanTitle} from '@/components/ai-elements/plan'
import {Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationRequest, ConfirmationTitle} from '@/components/ai-elements/confirmation'
import {Reasoning, ReasoningContent, ReasoningTrigger} from '@/components/ai-elements/reasoning'
import {Context, ContextContent, ContextContentBody, ContextContentHeader, ContextTrigger} from '@/components/ai-elements/context'
import {useAgentRun} from '@/hooks/use-agent-events'
import {agentAPI, configuredModels, readAgentConfig} from '@/lib/agent-client'
import {defaultAgentConfig, type AgentConfig, type AgentMessage, type AgentMode, type PermissionMode, type WorkspaceState} from '../../shared/agent'
import './project.css'

type ProjectChat = {id: string; name: string; messages: AgentMessage[]; modelId?: string}
const efforts = ['low', 'medium', 'high', 'xhigh'] as const
const emptyWorkspace: WorkspaceState = {checkpoints: [], cursor: -1, memory: '', skills: []}

export default function Project({workspaceMode, projectId, projectPath, initialName, showOverview, chats, activeChatId, onCreateChat, onChatModelChange, onDeleteProject, onMessagesChange, onRenameProject}: {
    workspaceMode: WorkspaceMode; projectId: string; projectPath: string; initialName: string; showOverview: boolean
    chats: ProjectChat[]; activeChatId?: string; onCreateChat: () => string; onChatModelChange: (chatId: string, modelId: string) => void; onDeleteProject: () => void
    onRenameProject: (name: string) => void
    onMessagesChange: (chatId: string, messages: AgentMessage[] | ((current: AgentMessage[]) => AgentMessage[])) => void
}) {
    const [availableModels] = useState(configuredModels)
    const [enabledModelIds, setEnabledModelIds] = useState<string[] | null>(() => {
        try { const saved = JSON.parse(localStorage.getItem(`foreman_project_models_${projectId}`) ?? 'null'); return Array.isArray(saved) ? saved : null } catch { return null }
    })
    const models = availableModels.filter(model => enabledModelIds === null || enabledModelIds.includes(model.id))
    const activeChat = chats.find(chat => chat.id === activeChatId)
    function configuredDefaultModel() {
        try {
            const value = JSON.parse(localStorage.getItem('foreman_settings') ?? '{}')?.defaultModel
            return typeof value === 'string' && models.some(model => model.id === value && model.enabled) ? value : models[0]?.id ?? ''
        } catch { return models[0]?.id ?? '' }
    }
    const defaultModel = configuredDefaultModel()
    const [modelId, setModelId] = useState(() => activeChat?.modelId ?? defaultModel)
    const [mode, setMode] = useState<AgentMode>('build')
    const [effort, setEffort] = useState<typeof efforts[number]>('medium')
    const [foremanMode, setForemanMode] = useState(false)
    const [config, setConfig] = useState<AgentConfig>(defaultAgentConfig)
    const [workspace, setWorkspace] = useState(emptyWorkspace)
    const [permissionOverride, setPermissionOverride] = useState<PermissionMode | null>(null)
    const [error, setError] = useState('')
    const [actionPending, setActionPending] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [prompt, setPrompt] = useState('')
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
    const [editingText, setEditingText] = useState('')
    const composerRef = useRef<HTMLDivElement>(null)
    const [composerHeight, setComposerHeight] = useState(0)
    const run = useAgentRun(activeChatId)
    const running = submitting || run.status === 'starting' || run.status === 'running'
    const messages = activeChat?.messages ?? []
    const permissionMode = permissionOverride ?? config.permissionMode
    const contextUsage = messages.slice().reverse().find(message => message.contextUsage)?.contextUsage
    const finalAssistantMessageId = messages.slice().reverse().find(message => message.role === 'assistant')?.id
    const summaries = messages.filter(message => message.runSummary)
    const conversationTime = summaries.reduce((sum, message) => sum + (message.durationMs ?? 0), 0)
    const conversationTokens = summaries.reduce((sum, message) => sum + (message.usage?.total ?? 0), 0)
    function contextWindow() {
        try {
            const value = JSON.parse(localStorage.getItem('foreman_settings') ?? '{}')?.contextWindow
            return [128000, 256000, 512000].includes(value) ? value : 128000
        } catch { return 128000 }
    }
    useEffect(() => {
        const next = activeChat?.modelId ?? defaultModel
        setModelId(next)
    }, [activeChatId, activeChat?.modelId, availableModels, enabledModelIds, defaultModel])
    useEffect(() => {
        try { setPermissionOverride(localStorage.getItem(`foreman_chat_permissions_${activeChatId}`) as PermissionMode | null) } catch { setPermissionOverride(null) }
    }, [activeChatId])
    useEffect(() => {
        try {
            const saved = activeChatId ? localStorage.getItem(`foreman_chat_mode_${activeChatId}`) ?? localStorage.getItem(`foreman_chat_radical_subagents_${activeChatId}`) : null
            setForemanMode(saved === 'true')
        } catch { setForemanMode(false) }
    }, [activeChatId])
    function changePermissions(value: PermissionMode) {
        setPermissionOverride(value)
        if (activeChatId) localStorage.setItem(`foreman_chat_permissions_${activeChatId}`, value)
    }
    function toggleForemanMode() {
        if (running) return
        const next = !foremanMode
        setForemanMode(next)
        if (activeChatId) localStorage.setItem(`foreman_chat_mode_${activeChatId}`, String(next))
    }
    useEffect(() => { if (run.workspace) setWorkspace(run.workspace) }, [run.workspace])
    useEffect(() => {
        const element = composerRef.current
        if (!element) return
        const observer = new ResizeObserver(() => {
            // Include the dock's padding so transcript space matches its visible footprint.
            setComposerHeight(Math.ceil(element.getBoundingClientRect().height))
        })
        observer.observe(element)
        return () => observer.disconnect()
    }, [activeChatId, run.queue.length, workspaceMode, messages.length])

    useEffect(() => {
        let cancelled = false
        readAgentConfig().then(value => { if (!cancelled) setConfig(value) }).catch(error => { if (!cancelled) setError(String(error)) })
        if (window.agentAPI) window.agentAPI.workspace(projectPath).then(value => {
            if (!cancelled) { setWorkspace(value) }
        }).catch(error => { if (!cancelled) setError(error.message) })
        return () => { cancelled = true }
    }, [projectPath, activeChatId])

    function toggleModel(id: string, enabled: boolean) {
        const next = enabled ? [...models.map(model => model.id), id] : models.map(model => model.id).filter(value => value !== id)
        if (!next.length) return
        localStorage.setItem(`foreman_project_models_${projectId}`, JSON.stringify(next))
        setEnabledModelIds(next)
        if (!next.includes(modelId)) setModelId(next[0])
    }
    function selectModel(id: string) {
        setModelId(id)
        if (activeChatId) onChatModelChange(activeChatId, id)
    }
    function selectMode(value: AgentMode) {
        if (value === 'review') {
            const reviewModel = models.find(model => model.id === 'codex-auto-review')
            if (!reviewModel) {
                setError('Enable codex-auto-review in Settings → Models and this project before using Review mode.')
                return
            }
            selectModel(reviewModel.id)
        }
        setError('')
        setMode(value)
    }
    async function submitMessage({text, files}: {text: string; files?: unknown[]}, requestedMode: AgentMode = mode) {
        if (!text.trim()) return
        if (running) {
            const chatId = activeChat?.id
            if (!chatId) return
            await action(async () => {
                await agentAPI().enqueue(chatId, text.trim())
                setPrompt('')
            })
            return
        }
        if (files?.length) {
            const message = 'Reference a project file path in your message; attachments are not supported yet.'
            setError(message)
            throw new Error(message)
        }
        const model = models.find(model => model.id === modelId)
        if (!model) { setError('Add a provider, fetch models and enable one in Settings → Models.'); throw new Error('No model configured.') }
        const chatId = activeChat?.id ?? onCreateChat()
        if (!activeChat && permissionOverride) localStorage.setItem(`foreman_chat_permissions_${chatId}`, permissionOverride)
        setSubmitting(true); setError('')
        const message: AgentMessage = {id: crypto.randomUUID(), role: 'user', text: text.trim()}
        onMessagesChange(chatId, current => [...current, message])
        try {
            onChatModelChange(chatId, modelId)
            await agentAPI().start({workspaceMode, chatId, projectPath, text: message.text, mode: requestedMode, modelId, effort, permissionMode,
                provider: model.providers.find(provider => provider.id === model.providerId)!, history: messages, foremanMode, contextWindow: contextWindow()})
            setPrompt('')
        } catch (error) { onMessagesChange(chatId, current => current.filter(item => item.id !== message.id)); setError(error.message); throw error }
        finally { setSubmitting(false) }
    }
    async function reviseMessage(message: AgentMessage) {
        if (!activeChat || !editingText.trim() || running) return
        const revised = `Please treat this as the revised version of my earlier request and continue from the current conversation state:\n\n${editingText.trim()}`
        const updated = {...message, text: editingText.trim()}
        onMessagesChange(activeChat.id, current => current.map(item => item.id === message.id ? updated : item))
        setEditingMessageId(null)
        await submitMessage({text: revised})
    }
    async function action(work: () => Promise<unknown>) {
        setError(''); setActionPending(true)
        try { await work() } catch (error) { setError(error.message) }
        finally { setActionPending(false) }
    }
    async function restore(id: string) {
        await action(async () => {
            const value = await agentAPI().restore(projectPath, id)
            setWorkspace(value)
        })
    }
    return <div className="project-screen">
        <div className={`project-layout${showOverview ? ' project-layout-expanded' : ''}`}>
            <section className="project-overview" aria-label="Project overview" aria-hidden={!showOverview} inert={!showOverview ? true : undefined}>
                <Card className="project-card">
                    {showOverview ? <ProjectArtwork projectId={projectId} label={`${initialName} animated generative artwork`} color="#477e55" speed={running ? 1.2 : 0.3} compact/> : <div className="project-artwork" aria-hidden="true"/>}
                    <CardContent className="project-panel-details"><ProjectDetails open={showOverview} name={initialName} projectPath={projectPath} workspace={workspace} availableModels={availableModels.map(model => model.id)} enabledModels={models.map(model => model.id)} onToggleModel={toggleModel} error={error || run.error} running={running} pending={actionPending} onRename={onRenameProject} onDelete={onDeleteProject} onSaveMemory={text => action(async () => { await agentAPI().saveMemory(projectPath, text); setWorkspace(current => ({...current, memory: text})) })} onRestore={restore}/></CardContent>
                </Card>
            </section>
            <section className="project-workspace" aria-label="Project chat and workspace">
                <div className="project-chat">
                    {!window.agentAPI && <Alert className="agent-notice"><AlertTitle>Desktop runtime required</AlertTitle><AlertDescription>This browser preview shows the interface. Open the Electron app to run pi and access project files.</AlertDescription></Alert>}
                    {(error || run.error) && <Alert variant="destructive" className="agent-notice"><AlertTitle>Action could not complete</AlertTitle><AlertDescription>{error || run.error}</AlertDescription></Alert>}
                    {run.agents.length > 0 && <section className="agent-subagents" aria-label="Subagent status" aria-live="polite">
                        <div className="agent-subagents-heading"><strong>Subagents</strong><span>{run.agents.filter(agent => agent.state === 'working').length} active · {run.agents.length} total</span></div>
                        <div className="agent-subagents-grid">{run.agents.map(agent => <Card key={agent.id} className={`agent-subagent-card is-${agent.state}`}>
                            <CardHeader><CardTitle><span className="agent-subagent-status" aria-hidden="true"/><span>{agent.task}</span></CardTitle><CardDescription>{agent.detail ?? agent.state}{agent.durationMs !== undefined ? ` · ${formatDuration(agent.durationMs)}` : ''}</CardDescription>{agent.modelId && <div className="agent-subagent-model">{agent.modelId}</div>}</CardHeader>
                            {agent.text && <CardContent><Task defaultOpen={false}><TaskTrigger title="Findings"/><TaskContent><MessageResponse>{agent.text}</MessageResponse></TaskContent></Task></CardContent>}
                        </Card>)}</div>
                    </section>}
                    <Conversation className="project-conversation" style={{"--agent-composer-height": `${composerHeight}px`} as React.CSSProperties}><ConversationContent className="project-conversation-content">
                        {messages.length ? messages.map(message => <Message key={message.id} from={message.role}>
                            <MessageContent>
                                {message.reasoning && <Reasoning isStreaming={running && message.id === messages[messages.length - 1]?.id}><ReasoningTrigger/><ReasoningContent>{message.reasoning}</ReasoningContent></Reasoning>}
                                {editingMessageId === message.id ? <><textarea className="agent-message-editor" value={editingText} onChange={event => setEditingText(event.target.value)} aria-label="Edit message"/><div className="agent-message-edit-actions"><Button size="sm" onClick={() => reviseMessage(message)} disabled={running || !editingText.trim()}><Check/>Save and resend</Button><Button size="icon-sm" variant="ghost" aria-label="Cancel edit" onClick={() => setEditingMessageId(null)}><X/></Button></div></> : <MessageResponse>{message.text}</MessageResponse>}
                                {message.delivery && <span className="agent-message-delivery">{message.delivery === 'steer' ? 'Steered into current run' : 'Added to waitlist'}</span>}
                            </MessageContent>
                            {message.role === 'user' && !running && editingMessageId !== message.id && <div className="agent-message-actions"><Button size="icon-sm" variant="ghost" aria-label="Edit message" title="Edit message" onClick={() => {setEditingMessageId(message.id); setEditingText(message.text)}}><Pencil/></Button></div>}
                        </Message>) : <ConversationEmptyState
                            title={workspaceMode === 'work' ? 'What are you working on?' : 'What are we building?'}
                            description={workspaceMode === 'work' ? `Use files in ${initialName} to create a deliverable.` : 'Plan a change, work with your codebase, or review your diff. Your agent runs locally on pi.'}
                            icon={<Cpu/>}
                        />}
                        {run.steps.length > 0 && <Plan defaultOpen><PlanHeader><PlanTitle>Implementation plan</PlanTitle><PlanDescription>{mode === 'plan' ? 'Read-only planning · switch to Build when ready.' : 'Current agent plan'}</PlanDescription></PlanHeader><PlanContent><ol className="agent-plan-steps">{run.steps.map((step, i) => <li key={`${i}-${step}`}>{step}</li>)}</ol></PlanContent></Plan>}
                        {run.tools.length > 0 && <Task defaultOpen={false}><TaskTrigger title={`Tool activity · ${run.tools.length} calls`}/><TaskContent><div className="agent-tool-list">{run.tools.map(tool => <Task key={tool.id} defaultOpen={false}><TaskTrigger title={`${tool.name} · ${tool.state}`}/><TaskContent><TaskItem><pre>{tool.input}</pre>{tool.output && <pre>{tool.output}</pre>}</TaskItem></TaskContent></Task>)}</div></TaskContent></Task>}
                        {running && <p role="status" className="agent-running">{run.permissions.length ? 'Waiting for your permission…' : 'Agent is working…'}</p>}
                        {run.permissions.map(request => <Confirmation key={request.id} approval={{id: request.id}} state="approval-requested"><ConfirmationRequest><ConfirmationTitle><Shield/> Allow {request.tool}?</ConfirmationTitle><pre className="agent-permission-input">{request.input}</pre><ConfirmationActions><ConfirmationAction variant="outline" disabled={actionPending} onClick={() => action(() => agentAPI().approve(request.id, false))}>Deny</ConfirmationAction><ConfirmationAction disabled={actionPending} onClick={() => action(() => agentAPI().approve(request.id, true))}>Allow once</ConfirmationAction></ConfirmationActions></ConfirmationRequest></Confirmation>)}
                        {messages.filter(message => message.role === 'assistant' && (message.id === finalAssistantMessageId && !running && (message.usage || message.durationMs !== undefined || message.modelId || message.foreman) || message.changes?.files.length)).map(message => <div key={`${message.id}-artifacts`} className="response-artifacts">
                            {message.id === finalAssistantMessageId && !running && (message.usage || message.durationMs !== undefined || message.modelId || message.foreman) && <Dialog>
                                <DialogTrigger render={<button type="button" className="response-metrics" aria-label="Show response time and token usage"/>}>
                                    {message.modelId && <span>{message.modelId}</span>}
                                    {message.durationMs !== undefined && <span>{formatDuration(message.durationMs)}</span>}
                                    {message.foreman && <span>{message.foreman.effort} effort</span>}
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader><DialogTitle>Response usage</DialogTitle><DialogDescription>{message.runSummary ? 'Elapsed time and reported tokens across this run, including tools, subagents and permission reviews.' : 'Historical model request. Full run statistics were not recorded.'}</DialogDescription></DialogHeader>
                                    <dl className="response-usage-details">
                                        <div><dt>Model</dt><dd>{message.modelId ?? '—'}</dd></div>
                                        {message.foreman && <><div><dt>Foreman Mode</dt><dd>{message.foreman.enabled ? 'Enabled' : 'Disabled'}</dd></div><div><dt>Reasoning effort</dt><dd>{message.foreman.effort}</dd></div><div><dt>Parallel subagents</dt><dd>{message.foreman.enabled ? `Up to ${message.foreman.maxSubagents}` : 'Standard limit'}</dd></div></>}
                                        <div><dt>Response time</dt><dd>{message.durationMs === undefined ? '—' : formatDuration(message.durationMs)}</dd></div>
                                        <div><dt>Input tokens</dt><dd>{message.usage?.input.toLocaleString() ?? '—'}</dd></div>
                                        <div><dt>Output tokens</dt><dd>{message.usage?.output.toLocaleString() ?? '—'}</dd></div>
                                        <div><dt>Cache read</dt><dd>{message.usage?.cacheRead.toLocaleString() ?? '—'}</dd></div>
                                        <div><dt>Cache write</dt><dd>{message.usage?.cacheWrite.toLocaleString() ?? '—'}</dd></div>
                                        <div><dt>Total tokens</dt><dd>{message.usage?.total.toLocaleString() ?? '—'}</dd></div>
                                        {summaries.length > 0 && <><div><dt>Conversation active time</dt><dd>{formatDuration(conversationTime)}</dd></div><div><dt>Conversation tokens (reported)</dt><dd>{conversationTokens ? conversationTokens.toLocaleString() : '—'}</dd></div><div><dt>Recorded runs</dt><dd>{summaries.length}</dd></div></>}
                                    </dl>
                                </DialogContent>
                            </Dialog>}
                            {message.changes?.files.length > 0 && <ResponseDiff files={message.changes.files}
                                undoDisabled={running || actionPending || workspace.checkpoints[workspace.cursor]?.id !== message.changes.afterId}
                                redoDisabled={running || actionPending || workspace.checkpoints[workspace.cursor]?.id !== message.changes.beforeId}
                                onUndo={() => restore(message.changes.beforeId)} onRedo={() => restore(message.changes.afterId)}/>}
                        </div>)}
                    </ConversationContent><ConversationScrollButton/></Conversation>
                    <div className="agent-composer" ref={composerRef}>
                        {workspaceMode === 'work' && !messages.length && config.plugins.skills && (
                            <div className="work-starters">
                                {workSkills.map(skill => (
                                    <Button key={skill.name} variant="outline" onClick={() => {
                                        setPrompt(skill.starter)
                                        document.querySelector<HTMLTextAreaElement>('.project-prompt textarea')?.focus()
                                    }}>{skill.name}</Button>
                                ))}
                            </div>
                        )}
                        <QueuedPrompts key={activeChatId} items={run.queue} disabled={!running || actionPending} update={async (id, operation) => {
                            setActionPending(true); setError('')
                            try { await agentAPI().updateQueue(activeChatId, id, operation) }
                            catch (err) { setError(String(err)); throw err }
                            finally { setActionPending(false) }
                        }}/>
                        <PromptInput className="project-prompt" onSubmit={message => submitMessage(message)}>
                            <PromptInputTextarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={mode === 'plan' ? 'Describe the change to plan…' : mode === 'review' ? 'What should the agent review?' : workspaceMode === 'work' ? 'Describe your deliverable or reference a file…' : 'Ask Foreman to work on your project…'} aria-label="Message the project agent"/>
                            <PromptInputFooter className="project-prompt-footer"><PromptInputTools className="project-prompt-tools project-prompt-tools-left">
                                <Select items={[{value:"build",label:"Build"},{value:"plan",label:"Plan"},{value:"review",label:"Review"}]} value={mode} disabled={running} onValueChange={value => value && selectMode(value as AgentMode)}><SelectTrigger aria-label="Agent mode" title={modeLabel(mode)} size="sm" className="composer-mode-trigger"><ModeIcon mode={mode}/><SelectValue className="sr-only"/></SelectTrigger><SelectContent className="composer-left-select-menu"><SelectGroup><SelectItem value="build"><ModeIcon mode="build"/><span>Build</span></SelectItem><SelectItem value="plan" disabled={!config.plugins['plan-mode']}><ModeIcon mode="plan"/><span>Plan</span></SelectItem><SelectItem value="review" disabled={!config.plugins.review || !models.some(model => model.id === 'codex-auto-review')}><ModeIcon mode="review"/><span>Review</span></SelectItem></SelectGroup></SelectContent></Select>
                                <Select items={permissionOptions} value={permissionMode} disabled={running} onValueChange={value => value && changePermissions(value as PermissionMode)}><SelectTrigger aria-label="Permission mode" size="sm" className="composer-permission-trigger"><PermissionIcon mode={permissionMode}/><SelectValue/></SelectTrigger><SelectContent className="composer-left-select-menu composer-permission-content"><SelectGroup>{permissionOptions.map(option => <SelectItem key={option.value} value={option.value}><PermissionIcon mode={option.value as PermissionMode}/>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
                            </PromptInputTools><div className="project-prompt-tools project-prompt-tools-right">
                                <DropdownMenu><DropdownMenuTrigger aria-label="Model and reasoning effort" disabled={running || !models.length} render={<Button type="button" size="sm" variant="ghost" className="composer-model-effort"/>}><span className="composer-model-name">{modelId || 'Choose model'}</span><span className="composer-effort-name">{effort}</span><Zap className="composer-radical-icon" aria-hidden="true" fill={foremanMode ? 'currentColor' : 'none'}/></DropdownMenuTrigger><DropdownMenuContent align="start" className="project-model-effort-menu"><DropdownMenuGroup className="project-model-group"><DropdownMenuLabel>Model</DropdownMenuLabel><DropdownMenuRadioGroup className="project-model-list" value={modelId} onValueChange={selectModel}>{models.map(model => <DropdownMenuRadioItem key={model.id} value={model.id}>{model.id}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuGroup><div className="project-effort-menu-heading"><span>Reasoning effort</span><output>{effort}</output></div><Slider disabled={running} value={[efforts.indexOf(effort)]} min={0} max={efforts.length - 1} step={1} thumbLabels={['Reasoning effort']} onValueChange={value => setEffort(efforts[Array.isArray(value) ? value[0] : value])}/><button type="button" className={`foreman-mode-toggle${foremanMode ? ' is-active' : ''}`} aria-label={`${foremanMode ? 'Disable' : 'Enable'} Foreman Mode`} aria-pressed={foremanMode} disabled={running} title="Foreman Mode" onClick={toggleForemanMode}><Zap aria-hidden="true" fill={foremanMode ? 'currentColor' : 'none'}/><span>Foreman Mode</span></button><p className="foreman-mode-description">Handles focused tasks directly. For complex work, independent research can run in parallel.</p></DropdownMenuContent></DropdownMenu>
                                <Context usedTokens={Math.min(contextUsage?.tokens ?? 0, contextUsage?.contextWindow ?? contextWindow())} maxTokens={contextUsage?.contextWindow || contextWindow()}><div className="context-usage"><ContextTrigger aria-label="Context window usage" title="Estimated tokens used in the active pi context window" className="context-trigger"/></div><ContextContent side="top" align="end" className="context-usage-popover"><ContextContentHeader/><ContextContentBody><span className="context-detail-label">Estimated tokens in the active pi context window</span></ContextContentBody></ContextContent></Context>
                                {!running && run.status === 'stopped' && messages.some(message => message.role === 'user') && <Button size="sm" variant="outline" onClick={() => submitMessage({text:'Continue from where you stopped. Review the current conversation and continue the unfinished work.'})}>Continue</Button>}
                                {running && <Button type="button" size="icon-sm" variant="outline" aria-label="Stop run" title="Stop run" onClick={() => action(() => agentAPI().stop(activeChatId))}><Stop/></Button>}
                                <PromptInputSubmit disabled={!running && !models.length} status="ready"><ArrowUpRight/></PromptInputSubmit>
                            </div></PromptInputFooter>
                        </PromptInput>
                    </div>
                </div>
            </section>
        </div>

    </div>
}

function PermissionIcon({mode}: {mode: PermissionMode}) {
    if (mode === 'read-only') return <EyeClosed aria-hidden="true"/>
    if (mode === 'approve-for-me' || mode === 'auto') return <ShieldCheck aria-hidden="true"/>
    return <CircleQuestion aria-hidden="true"/>
}
function formatDuration(durationMs: number) {
    return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`
}
function ModeIcon({mode}: {mode: AgentMode}) {
    if (mode === 'plan') return <ListCheck aria-hidden="true"/>
    if (mode === 'review') return <CodeCompare aria-hidden="true"/>
    return <Hammer aria-hidden="true"/>
}
function modeLabel(mode: AgentMode) {
    return mode.charAt(0).toUpperCase() + mode.slice(1)
}

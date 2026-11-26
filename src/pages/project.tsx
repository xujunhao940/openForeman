import {workSkills, type WorkspaceMode} from '../../shared/work'
import {useEffect, useMemo, useRef, useState} from 'react'
import {ArrowUpRight, Cpu, Stop, Shield, CircleQuestion, EyeClosed, ShieldCheck, Hammer, ListCheck, CodeCompare} from '@gravity-ui/icons'
import {QueuedPrompts} from '@/components/queued-prompts'
import {FeedforwardInput} from '@/components/feedforward-input'
import {Zap, Pencil, Check, X, Paperclip, ChevronDown} from 'lucide-react'
import {CollapsibleTrigger} from '@/components/ui/collapsible'
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
import {PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTools, usePromptInputAttachments, type PromptInputMessage} from '@/components/ai-elements/prompt-input'
import {Task, TaskContent, TaskItem, TaskTrigger} from '@/components/ai-elements/task'
import {Plan, PlanContent} from '@/components/ai-elements/plan'
import {Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationRequest, ConfirmationTitle} from '@/components/ai-elements/confirmation'
import {Reasoning, ReasoningContent, ReasoningTrigger} from '@/components/ai-elements/reasoning'
import {Context, ContextContent, ContextContentBody, ContextContentHeader, ContextTrigger} from '@/components/ai-elements/context'
import {useAgentRun} from '@/hooks/use-agent-events'
import {agentAPI, configuredModels, readAgentConfig} from '@/lib/agent-client'
import {defaultAgentConfig, legacyHistoryLimits, type AgentConfig, type AgentMessage, type AgentMode, type FeedforwardDetail, type PermissionMode, type WorkspaceState} from '../../shared/agent'
import './project.css'

type ProjectChat = {id: string; name: string; messages: AgentMessage[]; modelId?: string}
const efforts = ['low', 'medium', 'high', 'xhigh'] as const
const emptyWorkspace: WorkspaceState = {checkpoints: [], cursor: -1, memory: '', skills: []}

function AttachmentButton() {
    const {openFileDialog} = usePromptInputAttachments()
    return <Button type="button" variant="ghost" size="icon-sm" title="Attach files or images" aria-label="Attach files or images" onClick={openFileDialog}><Paperclip/></Button>
}

function AttachmentPreviews() {
    const {files, remove} = usePromptInputAttachments()
    if (!files.length) return null
    return <div className="attachment-previews">{files.map(file => <div key={file.id} className="attachment-chip">
        {file.mediaType.startsWith('image/') ? <img src={file.url} alt=""/> : <Paperclip size={14}/>}
        <span title={file.filename}>{file.filename}</span>
        <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove ${file.filename}`} onClick={() => remove(file.id)}><X/></Button>
    </div>)}</div>
}

function readModelSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem('foreman_settings') ?? '{}')
        return {defaultModel: saved?.defaultModel, contextWindow: [128000, 256000, 512000].includes(saved?.contextWindow) ? saved.contextWindow : 128000,
            intraTurnEnabled: saved?.intraTurnEnabled === true}
    } catch { return {defaultModel: undefined, contextWindow: 128000, intraTurnEnabled: false} }
}

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
    const models = useMemo(() => availableModels.filter(model => enabledModelIds === null || enabledModelIds.includes(model.id)), [availableModels, enabledModelIds])
    const activeChat = chats.find(chat => chat.id === activeChatId)
    const [modelSettings, setModelSettings] = useState(readModelSettings)
    useEffect(() => {
        const refresh = (event: StorageEvent) => {
            if (event.storageArea === localStorage && (event.key === 'foreman_settings' || event.key === null)) {
                setModelSettings(readModelSettings())
            }
        }
        window.addEventListener('storage', refresh)
        return () => window.removeEventListener('storage', refresh)
    }, [])
    const defaultModel = models.some(model => model.id === modelSettings.defaultModel && model.enabled) ? modelSettings.defaultModel : models[0]?.id ?? ''
    const {contextWindow} = modelSettings
    const [modelId, setModelId] = useState(() => activeChat?.modelId ?? defaultModel)
    const activeModelId = modelId
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
    const [feedforwardDetails, setFeedforwardDetails] = useState<FeedforwardDetail[]>([])
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

    useEffect(() => { setFeedforwardDetails([]) }, [activeChatId])
    const summaries = messages.filter(message => message.runSummary)
    const conversationTime = summaries.reduce((sum, message) => sum + (message.durationMs ?? 0), 0)
    const conversationTokens = summaries.reduce((sum, message) => sum + (message.usage?.total ?? 0), 0)
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
    async function submitMessage({text, files = []}: Partial<PromptInputMessage> & {text: string}, requestedMode: AgentMode = mode, details: FeedforwardDetail[] = feedforwardDetails) {
        if (!text.trim() && !files.length) return
        if (!models.length) { setError('Enable a model in Settings to send a message.'); throw new Error('No model configured.') }
        if (files.length) {
            try {
                const paths = await agentAPI().upload(projectPath, files.map(file => ({filename: file.filename || 'attachment', url: file.url})))
                text = [text.trim(), 'Attached project files:', ...paths.map(path => '• ' + path)].filter(Boolean).join('\n')
            } catch (error) { setError(error.message); throw error }
        }
        const requestText = details.length
            ? `${text.trim()}\n\nAdditional details:\n${details.map(detail => `- ${detail.phrase} · ${detail.label}: ${detail.value}`).join('\n')}`
            : text.trim()
        if (running) {
            const chatId = activeChat?.id
            if (!chatId) return
            try {
                const queuedId = await agentAPI().enqueue(chatId, requestText)
                if (modelSettings.intraTurnEnabled) await agentAPI().updateQueue(chatId, queuedId, {kind: 'steer'})
                setPrompt('')
                setFeedforwardDetails([])
            } catch (error) { setError(error.message); throw error }
            return
        }
        const model = models.find(model => model.id === activeModelId)
        if (!model) { setError('Add a provider, fetch models and enable one in Settings → Models.'); throw new Error('No model configured.') }
        const chatId = activeChat?.id ?? onCreateChat()
        if (!activeChat && permissionOverride) localStorage.setItem(`foreman_chat_permissions_${chatId}`, permissionOverride)
        setSubmitting(true); setError('')
        const message: AgentMessage = {id: crypto.randomUUID(), role: 'user', text: text.trim(), ...(details.length ? {feedforwardDetails: details} : {})}
        onMessagesChange(chatId, current => [...current, message])
        setFeedforwardDetails([])
        try {
            onChatModelChange(chatId, modelId)
            const history = messages.filter(message => !message.planSteps).slice(-legacyHistoryLimits.messages).map(({id, role, text, feedforwardDetails}) => ({
                id, role, text: [String(text), ...(feedforwardDetails?.length ? ['Additional details:', ...feedforwardDetails.map(detail => `- ${detail.phrase} · ${detail.label}: ${detail.value}`)] : [])].join('\n\n').slice(0, legacyHistoryLimits.charactersPerMessage),
            }))
            await agentAPI().start({workspaceMode, chatId, projectPath, text: requestText, mode: requestedMode, modelId: activeModelId, effort, permissionMode,
                provider: model.providers.find(provider => provider.id === model.providerId)!, history, foremanMode, contextWindow: readModelSettings().contextWindow})
            setPrompt('')
        } catch (error) { onMessagesChange(chatId, current => current.filter(item => item.id !== message.id)); setFeedforwardDetails(details); setError(error.message); throw error }
        finally { setSubmitting(false) }
    }
    async function reviseMessage(message: AgentMessage) {
        if (!activeChat || !editingText.trim() || running) return
        const revised = `Please treat this as the revised version of my earlier request and continue from the current conversation state:\n\n${editingText.trim()}`
        const updated = {...message, text: editingText.trim()}
        onMessagesChange(activeChat.id, current => current.map(item => item.id === message.id ? updated : item))
        setEditingMessageId(null)
        await submitMessage({text: revised}, mode, message.feedforwardDetails ?? [])
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
                        {messages.length ? messages.map((message, messageIndex) => message.planSteps ? <Plan className="inline-plan" key={message.id ?? `plan-${messageIndex}`}>
                            <CollapsibleTrigger className="inline-plan-toggle"><ListCheck/>Implementation Plan<ChevronDown/></CollapsibleTrigger>
                            <PlanContent><ol className="agent-plan-steps">{message.planSteps.map((step, i) => <li key={i}>{step}</li>)}</ol></PlanContent>
                        </Plan> : <Message key={message.id ?? `message-${messageIndex}`} id={`turn-${message.id ?? messageIndex}`} from={message.role}>
                            <MessageContent>
                                {message.reasoning && <Reasoning isStreaming={running && message.id === messages[messages.length - 1]?.id}><ReasoningTrigger/><ReasoningContent>{message.reasoning}</ReasoningContent></Reasoning>}
                                {editingMessageId === message.id ? <><textarea className="agent-message-editor" value={editingText} onChange={event => setEditingText(event.target.value)} aria-label="Edit message"/><div className="agent-message-edit-actions"><Button size="sm" onClick={() => reviseMessage(message)} disabled={running || !editingText.trim()}><Check/>Save and resend</Button><Button size="icon-sm" variant="ghost" aria-label="Cancel edit" onClick={() => setEditingMessageId(null)}><X/></Button></div></> : <>
                                    {message.feedforwardDetails?.length ? <dl className="feedforward-message-details" aria-label="Added details">{message.feedforwardDetails.map(detail => <div key={`${detail.phrase}-${detail.label}`}><dt>{detail.phrase} · {detail.label}</dt><dd>{detail.value}</dd></div>)}</dl> : null}
                                    <MessageResponse>{message.text}</MessageResponse>
                                </>}
                                {message.delivery && <span className="agent-message-delivery">{message.delivery === 'steer' ? 'Steered into current run' : 'Added to waitlist'}</span>}
                            </MessageContent>
                            {message.role === 'user' && !running && editingMessageId !== message.id && <div className="agent-message-actions"><Button size="icon-sm" variant="ghost" aria-label="Edit message" title="Edit message" onClick={() => {setEditingMessageId(message.id); setEditingText(message.text)}}><Pencil/></Button></div>}
                        </Message>) : <ConversationEmptyState
                            title={workspaceMode === 'work' ? 'What are you working on?' : 'What are we building?'}
                            description={workspaceMode === 'work' ? `Use files in ${initialName} to create a deliverable.` : 'Plan a change, work with your codebase, or review your diff. Your agent runs locally on pi.'}
                            icon={<Cpu/>}
                        />}
                        {run.tools.length > 0 && <Task defaultOpen={false}><TaskTrigger title={`Tool activity · ${run.tools.length} calls`}/><TaskContent><div className="agent-tool-list">{run.tools.map(tool => <Task key={tool.id} defaultOpen={false}><TaskTrigger title={`${tool.name} · ${tool.state}`}/><TaskContent><TaskItem><pre>{tool.input}</pre>{tool.output && <pre>{tool.output}</pre>}</TaskItem></TaskContent></Task>)}</div></TaskContent></Task>}
                        {running && <p role="status" className="agent-running"><span className="activity-wave" aria-hidden="true"><i/><i/><i/><i/></span>{run.permissions.length ? 'Waiting for your permission…' : run.tools.some(tool => tool.state === 'running') ? 'Using tools…' : 'Agent is working…'}</p>}
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
                    </ConversationContent><ConversationScrollButton/>
                        {messages.some(m => m.role === 'user') && <nav className="turn-handles" aria-label="Conversation history">{messages.map((m, index) => ({message: m, index})).filter(item => item.message.role === 'user').map(({message, index}) =>
                            <button type="button" key={message.id ?? `turn-${index}`} className="turn-handle" aria-label={message.text} title={message.text} onClick={() => document.getElementById(`turn-${message.id ?? index}`)?.scrollIntoView({block: 'start', behavior: 'instant'})}><span/></button>
                        )}</nav>}
                    </Conversation>
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
                        <PromptInput key={activeChatId ?? projectId} className="project-prompt" multiple maxFiles={8} maxFileSize={10 * 1024 * 1024} onError={err => setError(err.message)} onSubmit={message => submitMessage(message)}>
                            <AttachmentPreviews/>
                            <FeedforwardInput value={prompt} onChange={setPrompt} details={feedforwardDetails} onDetailsChange={setFeedforwardDetails} placeholder={mode === 'plan' ? 'Describe the change to plan…' : mode === 'review' ? 'What should the agent review?' : workspaceMode === 'work' ? 'Describe your deliverable or reference a file…' : 'Ask Foreman to work on your project…'} />
                            <PromptInputFooter className="project-prompt-footer"><PromptInputTools className="project-prompt-tools project-prompt-tools-left">
                                <AttachmentButton/>
                                <Select items={[{value:"build",label:"Build"},{value:"plan",label:"Plan"},{value:"review",label:"Review"}]} value={mode} disabled={running} onValueChange={value => value && selectMode(value as AgentMode)}><SelectTrigger aria-label="Agent mode" title={modeLabel(mode)} size="sm" className="composer-mode-trigger"><ModeIcon mode={mode}/><SelectValue className="sr-only"/></SelectTrigger><SelectContent className="composer-left-select-menu"><SelectGroup><SelectItem value="build"><ModeIcon mode="build"/><span>Build</span></SelectItem><SelectItem value="plan" disabled={!config.plugins['plan-mode']}><ModeIcon mode="plan"/><span>Plan</span></SelectItem><SelectItem value="review" disabled={!config.plugins.review || !models.some(model => model.id === 'codex-auto-review')}><ModeIcon mode="review"/><span>Review</span></SelectItem></SelectGroup></SelectContent></Select>
                                <Select items={permissionOptions} value={permissionMode} disabled={running} onValueChange={value => value && changePermissions(value as PermissionMode)}><SelectTrigger aria-label="Permission mode" size="sm" className="composer-permission-trigger"><PermissionIcon mode={permissionMode}/><SelectValue/></SelectTrigger><SelectContent className="composer-left-select-menu composer-permission-content"><SelectGroup>{permissionOptions.map(option => <SelectItem key={option.value} value={option.value}><PermissionIcon mode={option.value as PermissionMode}/>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
                            </PromptInputTools><div className="project-prompt-tools project-prompt-tools-right">
                                <DropdownMenu><DropdownMenuTrigger aria-label="Model and reasoning effort" disabled={running || !models.length} render={<Button type="button" size="sm" variant="ghost" className="composer-model-effort"/>}><span className="composer-model-name">{activeModelId || 'Choose model'}</span><span className="composer-effort-name">{effort}</span><Zap className="composer-radical-icon" aria-hidden="true" fill={foremanMode ? 'currentColor' : 'none'}/></DropdownMenuTrigger><DropdownMenuContent align="start" className="project-model-effort-menu"><DropdownMenuGroup className="project-model-group"><DropdownMenuLabel>Model</DropdownMenuLabel><DropdownMenuRadioGroup className="project-model-list" value={modelId} onValueChange={selectModel}>{models.map(model => <DropdownMenuRadioItem key={model.id} value={model.id}>{model.id}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuGroup><div className="project-effort-menu-heading"><span>Reasoning effort</span><output>{effort}</output></div><Slider disabled={running} value={[efforts.indexOf(effort)]} min={0} max={efforts.length - 1} step={1} thumbLabels={['Reasoning effort']} onValueChange={value => setEffort(efforts[Array.isArray(value) ? value[0] : value])}/><button type="button" className={`foreman-mode-toggle${foremanMode ? ' is-active' : ''}`} aria-label={`${foremanMode ? 'Disable' : 'Enable'} Foreman Mode`} aria-pressed={foremanMode} disabled={running} title="Foreman Mode" onClick={toggleForemanMode}><Zap aria-hidden="true" fill={foremanMode ? 'currentColor' : 'none'}/><span>Foreman Mode</span></button><p className="foreman-mode-description">Handles focused tasks directly. For complex work, independent research can run in parallel.</p></DropdownMenuContent></DropdownMenu>
                                <Context usedTokens={Math.min(contextUsage?.tokens ?? 0, contextUsage?.contextWindow ?? contextWindow)} maxTokens={contextUsage?.contextWindow || contextWindow}><div className="context-usage"><ContextTrigger aria-label="Context window usage" title="Estimated tokens used in the active pi context window" className="context-trigger"/></div><ContextContent side="top" align="end" className="context-usage-popover"><ContextContentHeader/><ContextContentBody><span className="context-detail-label">Estimated tokens in the active pi context window</span></ContextContentBody></ContextContent></Context>
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

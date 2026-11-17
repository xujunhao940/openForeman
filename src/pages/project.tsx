import {useEffect, useState} from 'react'
import {ArrowUpRight, Cpu, Stop, Shield, CircleQuestion, EyeClosed, ShieldCheck, Hammer, ListCheck, CodeCompare} from '@gravity-ui/icons'
import {Button} from '@/components/ui/button'
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

type ProjectChat = {id: string; name: string; messages: AgentMessage[]}
const efforts = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
const emptyWorkspace: WorkspaceState = {checkpoints: [], cursor: -1, memory: '', skills: []}

export default function Project({projectId, projectPath, initialName, showOverview, chats, activeChatId, onCreateChat, onMessagesChange, onRenameProject}: {
    projectId: string; projectPath: string; initialName: string; showOverview: boolean
    chats: ProjectChat[]; activeChatId?: string; onCreateChat: () => string
    onRenameProject: (name: string) => void
    onMessagesChange: (chatId: string, messages: AgentMessage[] | ((current: AgentMessage[]) => AgentMessage[])) => void
}) {
    const [availableModels] = useState(configuredModels)
    const [enabledModelIds, setEnabledModelIds] = useState<string[] | null>(() => {
        try { const saved = JSON.parse(localStorage.getItem(`foreman_project_models_${projectId}`) ?? 'null'); return Array.isArray(saved) ? saved : null } catch { return null }
    })
    const models = availableModels.filter(model => enabledModelIds === null || enabledModelIds.includes(model.id))
    const [modelId, setModelId] = useState(() => models[0]?.id ?? '')
    const [mode, setMode] = useState<AgentMode>('build')
    const [effort, setEffort] = useState<typeof efforts[number]>('off')
    const [config, setConfig] = useState<AgentConfig>(defaultAgentConfig)
    const [workspace, setWorkspace] = useState(emptyWorkspace)
    const [permissionOverride, setPermissionOverride] = useState<PermissionMode | null>(null)
    const [error, setError] = useState('')
    const [actionPending, setActionPending] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [prompt, setPrompt] = useState('')
    const run = useAgentRun(activeChatId)
    const running = submitting || run.status === 'starting' || run.status === 'running'
    const activeChat = chats.find(chat => chat.id === activeChatId)
    const messages = activeChat?.messages ?? []
    const permissionMode = permissionOverride ?? config.permissionMode
    const contextUsage = messages.slice().reverse().find(message => message.contextUsage)?.contextUsage
    useEffect(() => {
        try { setPermissionOverride(localStorage.getItem(`foreman_chat_permissions_${activeChatId}`) as PermissionMode | null) } catch { setPermissionOverride(null) }
    }, [activeChatId])
    function changePermissions(value: PermissionMode) {
        setPermissionOverride(value)
        if (activeChatId) localStorage.setItem(`foreman_chat_permissions_${activeChatId}`, value)
    }
    useEffect(() => { if (run.workspace) setWorkspace(run.workspace) }, [run.workspace])

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
    async function submitMessage({text, files}: {text: string; files?: unknown[]}, requestedMode: AgentMode = mode) {
        if (!text.trim() || running) return
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
            await agentAPI().start({chatId, projectPath, text: message.text, mode: requestedMode, modelId, effort, permissionMode,
                provider: model.providers.find(provider => provider.id === model.providerId)!, history: messages})
            setPrompt('')
        } catch (error) { onMessagesChange(chatId, current => current.filter(item => item.id !== message.id)); setError(error.message); throw error }
        finally { setSubmitting(false) }
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
                    <CardContent className="project-panel-details"><ProjectDetails open={showOverview} name={initialName} projectPath={projectPath} workspace={workspace} availableModels={availableModels.map(model => model.id)} enabledModels={models.map(model => model.id)} onToggleModel={toggleModel} error={error || run.error} running={running} pending={actionPending} onRename={onRenameProject} onSaveMemory={text => action(async () => { await agentAPI().saveMemory(projectPath, text); setWorkspace(current => ({...current, memory: text})) })} onRestore={restore}/></CardContent>
                </Card>
            </section>
            <section className="project-workspace" aria-label="Project chat and workspace">
                <div className="project-chat">
                    {!window.agentAPI && <Alert className="agent-notice"><AlertTitle>Desktop runtime required</AlertTitle><AlertDescription>This browser preview shows the interface. Open the Electron app to run pi and access project files.</AlertDescription></Alert>}
                    {(error || run.error) && <Alert variant="destructive" className="agent-notice"><AlertTitle>Action could not complete</AlertTitle><AlertDescription>{error || run.error}</AlertDescription></Alert>}
                    {run.agents.length > 0 && <div className="agent-subagents" aria-label="Subagent status">{run.agents.map(agent => <Card key={agent.id}><CardHeader><CardTitle>{agent.task}</CardTitle><CardDescription>{agent.state}</CardDescription></CardHeader>{agent.text && <CardContent><Task defaultOpen={false}><TaskTrigger title="Findings"/><TaskContent><MessageResponse>{agent.text}</MessageResponse></TaskContent></Task></CardContent>}</Card>)}</div>}
                    <Conversation className="project-conversation"><ConversationContent>
                        {messages.length ? messages.map(message => <Message key={message.id} from={message.role}>
                            <MessageContent>
                                {message.reasoning && <Reasoning isStreaming={running && message.id === messages[messages.length - 1]?.id}><ReasoningTrigger/><ReasoningContent>{message.reasoning}</ReasoningContent></Reasoning>}
                                <MessageResponse>{message.text}</MessageResponse>
                                {message.changes?.files.length > 0 && <ResponseDiff files={message.changes.files}
                                    undoDisabled={running || actionPending || workspace.checkpoints[workspace.cursor]?.id !== message.changes.afterId}
                                    redoDisabled={running || actionPending || workspace.checkpoints[workspace.cursor]?.id !== message.changes.beforeId}
                                    onUndo={() => restore(message.changes.beforeId)} onRedo={() => restore(message.changes.afterId)}/>}
                            </MessageContent>
                        </Message>) : <ConversationEmptyState title="What are we building?" description="Plan a change, work with your codebase, or review your diff. Your agent runs locally on pi." icon={<Cpu/>}/>}
                        {run.steps.length > 0 && <Plan defaultOpen><PlanHeader><PlanTitle>Implementation plan</PlanTitle><PlanDescription>{mode === 'plan' ? 'Read-only planning · switch to Build when ready.' : 'Current agent plan'}</PlanDescription></PlanHeader><PlanContent><ol className="agent-plan-steps">{run.steps.map((step, i) => <li key={`${i}-${step}`}>{step}</li>)}</ol></PlanContent></Plan>}
                        {run.tools.length > 0 && <Task defaultOpen={false}><TaskTrigger title={`Tool activity · ${run.tools.length} calls`}/><TaskContent><div className="agent-tool-list">{run.tools.map(tool => <Task key={tool.id} defaultOpen={false}><TaskTrigger title={`${tool.name} · ${tool.state}`}/><TaskContent><TaskItem><pre>{tool.input}</pre>{tool.output && <pre>{tool.output}</pre>}</TaskItem></TaskContent></Task>)}</div></TaskContent></Task>}
                        {running && <p role="status" className="agent-running">{run.permissions.length ? 'Waiting for your permission…' : 'Agent is working…'}</p>}
                        {run.permissions.map(request => <Confirmation key={request.id} approval={{id: request.id}} state="approval-requested"><ConfirmationRequest><ConfirmationTitle><Shield/> Allow {request.tool}?</ConfirmationTitle><pre className="agent-permission-input">{request.input}</pre><ConfirmationActions><ConfirmationAction variant="outline" disabled={actionPending} onClick={() => action(() => agentAPI().approve(request.id, false))}>Deny</ConfirmationAction><ConfirmationAction disabled={actionPending} onClick={() => action(() => agentAPI().approve(request.id, true))}>Allow once</ConfirmationAction></ConfirmationActions></ConfirmationRequest></Confirmation>)}
                    </ConversationContent><ConversationScrollButton/></Conversation>
                    <div className="agent-composer">
                        <PromptInput className="project-prompt" onSubmit={message => submitMessage(message)}>
                            <PromptInputTextarea value={prompt} onChange={event => setPrompt(event.target.value)} disabled={running} placeholder={mode === 'plan' ? 'Describe the change to plan…' : mode === 'review' ? 'What should the agent review?' : 'Ask Foreman to work on your project…'} aria-label="Message the project agent"/>
                            <PromptInputFooter className="project-prompt-footer"><PromptInputTools className="project-prompt-tools project-prompt-tools-left">
                                <Select items={[{value:"build",label:"Build"},{value:"plan",label:"Plan"},{value:"review",label:"Review"}]} value={mode} disabled={running} onValueChange={value => value && setMode(value as AgentMode)}><SelectTrigger aria-label="Agent mode" title={modeLabel(mode)} size="sm" className="composer-mode-trigger"><ModeIcon mode={mode}/><SelectValue className="sr-only"/></SelectTrigger><SelectContent><SelectGroup><SelectItem value="build"><ModeIcon mode="build"/><span>Build</span></SelectItem><SelectItem value="plan" disabled={!config.plugins['plan-mode']}><ModeIcon mode="plan"/><span>Plan</span></SelectItem><SelectItem value="review" disabled={!config.plugins.review}><ModeIcon mode="review"/><span>Review</span></SelectItem></SelectGroup></SelectContent></Select>
                                <Select items={permissionOptions} value={permissionMode} disabled={running} onValueChange={value => value && changePermissions(value as PermissionMode)}><SelectTrigger aria-label="Permission mode" size="sm" className="composer-permission-trigger"><PermissionIcon mode={permissionMode}/><SelectValue/></SelectTrigger><SelectContent className="composer-permission-content"><SelectGroup>{permissionOptions.map(option => <SelectItem key={option.value} value={option.value}><PermissionIcon mode={option.value as PermissionMode}/>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
                            </PromptInputTools><div className="project-prompt-tools project-prompt-tools-right">
                                <DropdownMenu><DropdownMenuTrigger aria-label="Model and reasoning effort" disabled={running || !models.length} render={<Button type="button" size="sm" variant="ghost" className="composer-model-effort"/>}><span className="composer-model-name">{modelId || 'Choose model'}</span><span className="composer-effort-name">{effort}</span></DropdownMenuTrigger><DropdownMenuContent align="start" className="project-model-effort-menu"><DropdownMenuGroup><DropdownMenuLabel>Model</DropdownMenuLabel><DropdownMenuRadioGroup value={modelId} onValueChange={setModelId}>{models.map(model => <DropdownMenuRadioItem key={model.id} value={model.id}>{model.id}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuGroup><div className="project-effort-menu-heading"><span>Reasoning effort</span><output>{effort}</output></div><Slider value={[efforts.indexOf(effort)]} min={0} max={efforts.length - 1} step={1} thumbLabels={['Reasoning effort']} onValueChange={value => setEffort(efforts[Array.isArray(value) ? value[0] : value])}/><div className="effort-endpoints"><span>Off</span><span>Max</span></div></DropdownMenuContent></DropdownMenu>
                                <Context usedTokens={Math.min(contextUsage?.tokens ?? 0, contextUsage?.contextWindow ?? 128000)} maxTokens={contextUsage?.contextWindow || 128000}><div className="context-usage"><ContextTrigger aria-label="Context window usage" title="Estimated tokens used in the active pi context window" className="context-trigger"/></div><ContextContent side="top" align="end"><ContextContentHeader/><ContextContentBody><span className="context-detail-label">Estimated tokens in the active pi context window</span></ContextContentBody></ContextContent></Context>
                                <PromptInputSubmit disabled={!running && !models.length} status={running ? 'streaming' : 'ready'} onStop={() => action(() => agentAPI().stop(activeChatId))}>{running ? <Stop/> : <ArrowUpRight/>}</PromptInputSubmit>
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
    if (mode === 'auto') return <ShieldCheck aria-hidden="true"/>
    return <CircleQuestion aria-hidden="true"/>
}
function ModeIcon({mode}: {mode: AgentMode}) {
    if (mode === 'plan') return <ListCheck aria-hidden="true"/>
    if (mode === 'review') return <CodeCompare aria-hidden="true"/>
    return <Hammer aria-hidden="true"/>
}
function modeLabel(mode: AgentMode) {
    return mode.charAt(0).toUpperCase() + mode.slice(1)
}

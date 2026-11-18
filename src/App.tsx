import {ChevronsUpDown} from 'lucide-react'
import {DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem} from '@/components/ui/dropdown-menu'
import type {WorkspaceMode} from '../shared/work'
import {useEffect, useState} from "react"
import {Archive, FolderOpen, Ellipsis as MoreHorizontal, Plus, Puzzle, Gear as Settings2, PencilToSquare as SquarePen} from "@gravity-ui/icons"
import {TooltipProvider, Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip.tsx"
import "./App.css"
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    SidebarProvider,
    SidebarTrigger,
} from "@/components/ui/sidebar.tsx"
import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {Label} from "@/components/ui/label"
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from "@/components/ui/collapsible"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import Project from "@/pages/project.tsx"
import Settings from "@/pages/settings.tsx"
import Plugins from "@/pages/plugins.tsx"
import {useAgentEvents} from '@/hooks/use-agent-events'
import type {AgentMessage} from '../shared/agent'

type ProjectEntry = { id: string; name: string; path: string }
type ChatMessage = AgentMessage
type ProjectChat = { workspaceMode?: WorkspaceMode; id: string; name: string; messages: ChatMessage[]; archived?: boolean; modelId?: string }

const PROJECTS_STORAGE_KEY = "foreman_projects"
const CHATS_STORAGE_KEY = "foreman_project_chats"
const defaultProjects: ProjectEntry[] = [{id: "foreman-model", name: "Foreman", path: "."}]
function summarizeChat(text: string) {
    const clean = text.replace(/\s+/g, ' ').trim()
    return clean.length > 32 ? `${clean.slice(0, 32)}…` : clean || 'New chat'
}

function readProjectChats(projects: ProjectEntry[]): Record<string, ProjectChat[]> {
    try {
        const saved = JSON.parse(window.localStorage.getItem(CHATS_STORAGE_KEY) ?? "{}") as Record<string, ProjectChat[]>
        return Object.fromEntries(projects.map((project) => {
            const chats = saved[project.id]
            return [project.id, Array.isArray(chats) && chats.length > 0 ? chats : [{id: crypto.randomUUID(), name: "New chat", messages: []}]]
        }))
    } catch {
        return Object.fromEntries(projects.map((project) => [project.id, [{id: crypto.randomUUID(), name: "New chat", messages: []}]]))
    }
}

function readProjects(): ProjectEntry[] {
    try {
        const saved = window.localStorage.getItem(PROJECTS_STORAGE_KEY)
        if (!saved) return defaultProjects
        const projects = JSON.parse(saved) as ProjectEntry[]
        return Array.isArray(projects) && projects.length > 0 ? projects : defaultProjects
    } catch {
        return defaultProjects
    }
}

export default function App() {
    const [projects, setProjects] = useState(readProjects)
    const [projectChats, setProjectChats] = useState(() => readProjectChats(projects))
    const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(() => localStorage.getItem('foreman_workspace_mode') === 'work' ? 'work' : 'code')
    const [activeChatIds, setActiveChatIds] = useState<Record<string, string>>({})
    const selectionKey = (projectId: string) => `${workspaceMode}:${projectId}`
    const inMode = (chat: ProjectChat) => (chat.workspaceMode ?? 'code') === workspaceMode
    const [activeProjectId, setActiveProjectId] = useState(projects[0].id)
    const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({[projects[0].id]: true})
    const [dialogOpen, setDialogOpen] = useState(false)
    const [projectName, setProjectName] = useState("")
    const [projectPath, setProjectPath] = useState("")
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [pluginsOpen, setPluginsOpen] = useState(false)
    const [detailsProjectId, setDetailsProjectId] = useState<string | null>(null)
    const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0]
    const activeChats = (projectChats[activeProject.id] ?? []).filter(inMode)
    const activeChatId = activeChatIds[selectionKey(activeProject.id)] ?? activeChats.find(chat => !chat.archived)?.id

    useAgentEvents((event) => {
        if (event.type !== 'message') return
        setProjectChats(current => Object.fromEntries(Object.entries(current).map(([projectId, chats]) => [projectId,
            chats.map(chat => chat.id === event.chatId ? {...chat, messages: chat.messages.some(message => message.id === event.message.id)
                ? chat.messages.map(message => message.id === event.message.id ? event.message : message)
                : [...chat.messages, event.message]} : chat),
        ])))
    })

    useEffect(() => {
        window.localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(projectChats))
    }, [projectChats])

    function addProject(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const name = projectName.trim()
        const path = projectPath.trim()
        if (!name || !path) return

        const project = {id: crypto.randomUUID(), name, path}
        const nextProjects = [...projects, project]
        setProjects(nextProjects)
        window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(nextProjects))
        const chat = {workspaceMode, id: crypto.randomUUID(), name: "New chat", messages: []}
        setProjectChats((current) => ({...current, [project.id]: [chat]}))
        setActiveChatIds((current) => ({...current, [selectionKey(project.id)]: chat.id}))
        setActiveProjectId(project.id)
        setProjectName("")
        setProjectPath("")
        setDialogOpen(false)
    }

    function createChat(projectId: string) {
        const chat = {workspaceMode, id: crypto.randomUUID(), name: "New chat", messages: []}
        setProjectChats((current) => ({...current, [projectId]: [...(current[projectId] ?? []), chat]}))
        setActiveChatIds((current) => ({...current, [selectionKey(projectId)]: chat.id}))
        setExpandedProjects((current) => ({...current, [projectId]: true}))
        return chat.id
    }

    function updateChatMessages(projectId: string, chatId: string, messages: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) {
        setProjectChats((current) => ({
            ...current,
            [projectId]: (current[projectId] ?? []).map((chat) => chat.id === chatId
                ? (() => { const next = typeof messages === "function" ? messages(chat.messages) : messages; const firstUser = next.find(message => message.role === 'user'); return {...chat, name: chat.name === 'New chat' && firstUser ? summarizeChat(firstUser.text) : chat.name, messages: next} })()
                : chat),
        }))
    }

    function updateChatModel(projectId: string, chatId: string, modelId: string) {
        setProjectChats(current => ({...current, [projectId]: (current[projectId] ?? []).map(chat => chat.id === chatId ? {...chat, modelId} : chat)}))
    }

    function deleteProject(projectId: string) {
        const nextProjects = projects.filter(project => project.id !== projectId)
        const fallback = nextProjects[0]
        setProjects(nextProjects)
        localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(nextProjects))
        setProjectChats(current => { const next = {...current}; delete next[projectId]; return next })
        setActiveProjectId(fallback?.id ?? '')
        setDetailsProjectId(null)
    }

    function archiveChat(projectId: string, chatId: string) {
        setProjectChats((current) => ({
            ...current,
            [projectId]: (current[projectId] ?? []).map((chat) => chat.id === chatId ? {...chat, archived: true} : chat),
        }))
        setActiveChatIds((current) => current[selectionKey(projectId)] === chatId || activeChatId === chatId
            ? {...current, [selectionKey(projectId)]: (projectChats[projectId] ?? []).find((chat) => inMode(chat) && chat.id !== chatId && !chat.archived)?.id ?? ""}
            : current)
    }

    return <TooltipProvider>
        <SidebarProvider className="app-shell">
            <Sidebar className="sidebar">
                <SidebarHeader className="sidebar-brand">
                    <DropdownMenu><DropdownMenuTrigger className="brand-switch" aria-label="Switch workspace mode">{workspaceMode === 'work' ? 'ForemanWork' : 'Foreman'}<ChevronsUpDown size={15}/></DropdownMenuTrigger>
                        <DropdownMenuContent align="start"><DropdownMenuRadioGroup value={workspaceMode} onValueChange={value => {
                            if (value !== 'code' && value !== 'work') return
                            localStorage.setItem('foreman_workspace_mode', value)
                            setWorkspaceMode(value); setSettingsOpen(false); setPluginsOpen(false); setDetailsProjectId(null)
                        }}><DropdownMenuRadioItem closeOnClick value="code">Foreman</DropdownMenuRadioItem><DropdownMenuRadioItem closeOnClick value="work">ForemanWork</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuContent>
                    </DropdownMenu>
                </SidebarHeader>
                <SidebarContent>
                    <SidebarGroup className="projects-group">
                        <div className="projects-heading">
                            <SidebarGroupLabel>Projects</SidebarGroupLabel>
                            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                                <Tooltip>
                                    <TooltipTrigger render={<DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Add project" className="add-project-button"><Plus /></Button>}/>}/>
                                    <TooltipContent>Add project</TooltipContent>
                                </Tooltip>
                                <DialogContent>
                                    <form onSubmit={addProject}>
                                        <DialogHeader>
                                            <DialogTitle>Add project</DialogTitle>
                                            <DialogDescription>Add a local codebase to your workspace.</DialogDescription>
                                        </DialogHeader>
                                        <div className="add-project-fields">
                                            <div className="project-field">
                                                <Label htmlFor="new-project-name">Project name</Label>
                                                <Input id="new-project-name" autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="My project" required />
                                            </div>
                                            <div className="project-field">
                                                <Label htmlFor="new-project-path">Folder path</Label>
                                                <Input id="new-project-path" value={projectPath} onChange={(event) => setProjectPath(event.target.value)} placeholder="/path/to/repository" required />
                                                {window.agentAPI && <Button type="button" variant="outline" onClick={async () => {
                                                    const selected = await window.agentAPI.selectDirectory()
                                                    if (selected) { setProjectPath(selected); if (!projectName) setProjectName(selected.split(/[\\/]/).pop() ?? 'Project') }
                                                }}><FolderOpen data-icon="inline-start"/>Choose folder</Button>}
                                            </div>
                                        </div>
                                        <DialogFooter>
                                            <Button type="submit">Add project</Button>
                                        </DialogFooter>
                                    </form>
                                </DialogContent>
                            </Dialog>
                        </div>
                        <SidebarMenu>
                            {projects.map((project) => (
                                <Collapsible
                                    key={project.id}
                                    open={!!expandedProjects[project.id]}
                                    onOpenChange={(open) => setExpandedProjects((current) => ({...current, [project.id]: open}))}
                                    render={<SidebarMenuItem />}
                                >
                                    <CollapsibleTrigger render={<SidebarMenuButton
                                        isActive={!settingsOpen && !pluginsOpen && project.id === activeProject.id && !activeChatId}
                                        onClick={() => {
                                            setActiveProjectId(project.id)
                                            setSettingsOpen(false)
                                            setPluginsOpen(false)
                                        }}
                                        tooltip={project.name}
                                        className="project-nav-item"
                                    />}>
                                        <FolderOpen />
                                        <span className="project-nav-copy">
                                            <span className="project-nav-name">{project.name}</span>
                                        </span>
                                    </CollapsibleTrigger>
                                    <Tooltip>
                                        <TooltipTrigger render={<SidebarMenuAction
                                            showOnHover
                                            className="project-item-action project-new-chat-action"
                                            aria-label={`New chat in ${project.name}`}
                                            onClick={() => {
                                                setActiveProjectId(project.id)
                                                setSettingsOpen(false)
                                                setPluginsOpen(false)
                                                setActiveChatIds((current) => ({...current, [selectionKey(project.id)]: ""}))
                                            }}
                                        />}>
                                            <SquarePen />
                                        </TooltipTrigger>
                                        <TooltipContent side="top">New chat</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger
                                            render={
                                                <SidebarMenuAction
                                                    showOnHover
                                                    className="project-item-action"
                                                    aria-label={`${detailsProjectId === project.id ? "Hide" : "Show"} details for ${project.name}`}
                                                    aria-pressed={detailsProjectId === project.id}
                                                    onClick={(event) => {
                                                        event.stopPropagation()
                                                        setActiveProjectId(project.id)
                                                        setSettingsOpen(false)
                                                        setPluginsOpen(false)
                                                        setExpandedProjects(current => ({...current, [project.id]: true}))
                                                        setDetailsProjectId((current) => current === project.id ? null : project.id)
                                                    }}
                                                />
                                            }
                                        >
                                            <MoreHorizontal />
                                        </TooltipTrigger>
                                        <TooltipContent side="top">{detailsProjectId === project.id ? "Hide project details" : "Show project details"}</TooltipContent>
                                    </Tooltip>
                                    <CollapsibleContent className="project-chat-collapse">
                                        <SidebarMenuSub className="project-chat-submenu">
                                            {(projectChats[project.id] ?? []).filter((chat) => inMode(chat) && !chat.archived).map((chat) => (
                                                <SidebarMenuSubItem key={chat.id}>
                                                    <SidebarMenuSubButton
                                                        size="sm"
                                                        render={<button type="button" />}
                                                        isActive={!settingsOpen && !pluginsOpen && project.id === activeProject.id && chat.id === activeChatId}
                                                        onClick={() => {
                                                            setActiveProjectId(project.id)
                                                            setSettingsOpen(false)
                                                            setPluginsOpen(false)
                                                            setActiveChatIds((current) => ({...current, [selectionKey(project.id)]: chat.id}))
                                                        }}
                                                    >
                                                        <span>{chat.name}</span>
                                                    </SidebarMenuSubButton>
                                                    <Tooltip>
                                                        <TooltipTrigger render={<SidebarMenuAction
                                                            className="project-item-action project-chat-archive-action"
                                                            aria-label={`Archive ${chat.name}`}
                                                            onClick={(event) => {
                                                                event.stopPropagation()
                                                                archiveChat(project.id, chat.id)
                                                            }}
                                                        />}>
                                                            <Archive />
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top">Archive chat</TooltipContent>
                                                    </Tooltip>
                                                </SidebarMenuSubItem>
                                            ))}
                                        </SidebarMenuSub>
                                    </CollapsibleContent>
                                </Collapsible>
                            ))}
                        </SidebarMenu>
                    </SidebarGroup>
                </SidebarContent>
                <SidebarFooter className="sidebar-settings-footer">
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                isActive={pluginsOpen}
                                onClick={() => {
                                    setPluginsOpen(true)
                                    setSettingsOpen(false)
                                }}
                                tooltip="Plugins"
                                className="settings-nav-item"
                            >
                                <Puzzle />
                                <span>Plugins</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                isActive={settingsOpen && !pluginsOpen}
                                onClick={() => {
                                    setSettingsOpen(true)
                                    setPluginsOpen(false)
                                }}
                                tooltip="Settings"
                                className="settings-nav-item"
                            >
                                <Settings2 />
                                <span>Settings</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarFooter>
            </Sidebar>
            <main className="min-w-0 flex-1 pt-9">
                <header className="titlebar fixed inset-x-0 top-0 flex h-9 items-center">
                    <SidebarTrigger aria-label="切换侧栏" className="h-9 w-9" />
                </header>
                {pluginsOpen ? <Plugins /> : settingsOpen ? <Settings /> : <Project
                    key={selectionKey(activeProject.id)}
                    workspaceMode={workspaceMode}
                    projectId={activeProject.id}
                    projectPath={activeProject.path}
                    initialName={activeProject.name}
                    onRenameProject={name => {
                        const next = projects.map(project => project.id === activeProject.id ? {...project, name} : project)
                        localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(next))
                        setProjects(next)
                    }}
                    onChatModelChange={(chatId, modelId) => updateChatModel(activeProject.id, chatId, modelId)}
                    onDeleteProject={() => deleteProject(activeProject.id)}
                    showOverview={detailsProjectId === activeProject.id}
                    chats={activeChats}
                    activeChatId={activeChatId}
                    onCreateChat={() => createChat(activeProject.id)}
                    onMessagesChange={(chatId, messages) => updateChatMessages(activeProject.id, chatId, messages)}
                />}
            </main>
        </SidebarProvider>
    </TooltipProvider>
}

import {useState} from "react"
import {ArrowUpRight, FaceRobot as Bot, Check, CircleDashed, Target as CircleDot, CircleXmark as CircleX, PaperPlane as Send} from "@gravity-ui/icons"
import {Button} from "@/components/ui/button"
import {Checkbox} from "@/components/ui/checkbox"
import {Input} from "@/components/ui/input"
import {Item, ItemContent, ItemDescription, ItemGroup, ItemTitle} from "@/components/ui/item"
import {Slider} from "@/components/ui/slider"
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardTitle,
} from "@/components/ui/card"
import {Label} from "@/components/ui/label"
import {DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger} from "@/components/ui/dropdown-menu"
import {Separator} from "@/components/ui/separator"
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {ProjectArtwork} from "@/components/project-artwork"
import {Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton} from "@/components/ai-elements/conversation"
import {Message, MessageContent, MessageResponse} from "@/components/ai-elements/message"
import {PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools} from "@/components/ai-elements/prompt-input"
import {Task, TaskContent, TaskItem, TaskTrigger} from "@/components/ai-elements/task"
import "./project.css"

const availableModels = [
    "gpt-6-astra",
    "gpt-6.1-sol",
    "gpt-6.1-terra",
    "gpt-6-luna",
]

const effortLevels = ["Minimal", "Low", "Medium", "High", "Max"]

const projectColor = "#477e55"

const subagents = [
    {name: "Scout", task: "Map repository structure", model: "gpt-6-luna", state: "done"},
    {name: "Builder", task: "Implement the feature", model: "gpt-6.1-sol", state: "working"},
    {name: "Reviewer", task: "Check UI and tests", model: "gpt-6-astra", state: "queued"},
    {name: "Release", task: "Prepare a clean handoff", model: "gpt-6.1-terra", state: "blocked"},
]

type ChatMessage = { id: string; role: "assistant" | "user"; text: string }
type ProjectChat = { id: string; name: string; messages: ChatMessage[] }

export default function Project({projectId = "foreman-model", initialName = "Foreman", showOverview = true, chats = [], activeChatId, onCreateChat, onMessagesChange}: {
    projectId?: string
    initialName?: string
    showOverview?: boolean
    chats?: ProjectChat[]
    activeChatId?: string
    onCreateChat: () => string
    onMessagesChange?: (chatId: string, messages: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) => void
}) {
    const [projectName, setProjectName] = useState(initialName)
    const [model, setModel] = useState("gpt-6-astra")
    const [enabledModels, setEnabledModels] = useState(availableModels)
    const [detailsOpen, setDetailsOpen] = useState(false)
    const [effort, setEffort] = useState(3)
    const [debugStatus, setDebugStatus] = useState("working")
    const [showTrace, setShowTrace] = useState(true)
    const [showSample, setShowSample] = useState(true)

    const activeSubagentCount = subagents.filter((subagent) => subagent.state === "working").length
    const hasActiveTasks = debugStatus === "working" && activeSubagentCount > 0
    const artworkSpeed = hasActiveTasks
        ? Math.min(2, 0.3 + effort * 0.18 + activeSubagentCount * 0.2)
        : 0.3

    const statusIcon = debugStatus === "done" ? <Check data-icon="inline-start"/> : debugStatus === "error" ? <CircleX data-icon="inline-start"/> : debugStatus === "queued" ? <CircleDashed data-icon="inline-start"/> : <CircleDot data-icon="inline-start"/>
    const activeChat = chats.find((chat) => chat.id === activeChatId)
    const messages = activeChat?.messages ?? []

    function submitMessage({text}: {text: string}) {
        const trimmed = text.trim()
        if (!trimmed) return
        const chatId = activeChat?.id ?? onCreateChat()
        onMessagesChange?.(chatId, (current) => [...current, {id: crypto.randomUUID(), role: "user", text: trimmed}])
        window.setTimeout(() => {
            onMessagesChange?.(chatId, (current) => [...current, {id: crypto.randomUUID(), role: "assistant", text: "Received. The debug panel is simulating the " + debugStatus + " path for this response."}])
        }, 220)
    }

    function toggleModel(availableModel: string, checked: boolean) {
        setEnabledModels((current) => {
            if (!checked && current.length === 1) return current
            const nextModels = checked
                ? [...current, availableModel]
                : current.filter((entry) => entry !== availableModel)
            if (!checked && model === availableModel) setModel(nextModels[0])
            return nextModels
        })
    }

    return (
        <div className="project-screen">
            <div className={`project-layout${showOverview ? " project-layout-expanded" : ""}`}>
                <section className="project-overview" aria-labelledby="project-overview-heading" aria-hidden={!showOverview}>
                    <Card className="project-card">
                        {showOverview ? <ProjectArtwork
                            projectId={projectId}
                            label={`${projectName} animated generative artwork`}
                            color={projectColor}
                            speed={artworkSpeed}
                        /> : <div className="project-artwork" aria-hidden="true" />}
                        <CardContent className="project-card-info">
                            <CardTitle className="project-card-title">{projectName}</CardTitle>
                            <CardDescription className="project-card-description">
                                Foreman is a desktop agent orchestrator that splits work across sub-agents and matches each piece to the right model, balancing quality, cost, and time.
                            </CardDescription>
                            <CardFooter className="project-card-footer">
                                <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
                                    <DialogTrigger
                                        render={
                                            <div className={"w-full flex justify-end"}>
                                                <Button variant="secondary" className="project-details-trigger">
                                                    Project details <ArrowUpRight data-icon="inline-end"
                                                                                  aria-hidden="true"/>
                                                </Button>
                                            </div>
                                        }
                                    />
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Project details</DialogTitle>
                                            <DialogDescription>
                                                Update the name and model for this project.
                                            </DialogDescription>
                                        </DialogHeader>

                                        <Separator className="project-details-separator"/>

                                        <div className="project-settings-section">
                                            <h3>General</h3>
                                            <div className="project-field">
                                                <Label htmlFor="project-name">Project name</Label>
                                                <Input
                                                    id="project-name"
                                                    value={projectName}
                                                    onChange={(event) => setProjectName(event.target.value)}
                                                    placeholder="Name this project"
                                                />
                                            </div>
                                        </div>

                                        <Separator className="project-details-separator"/>

                                        <div className="project-settings-section">
                                            <h3>Available models</h3>
                                            <div className="project-field">
                                                <Label>Models available to Foreman</Label>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger
                                                        render={<Button type="button" variant="outline" className="project-model-select"/>}
                                                    >
                                                        {enabledModels.length} models enabled
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="start" className="project-model-menu">
                                                        <DropdownMenuGroup>
                                                            <DropdownMenuLabel>Available models</DropdownMenuLabel>
                                                            {availableModels.map((availableModel) => (
                                                                <DropdownMenuCheckboxItem
                                                                    key={availableModel}
                                                                    checked={enabledModels.includes(availableModel)}
                                                                    onCheckedChange={(checked) => toggleModel(availableModel, checked === true)}
                                                                >
                                                                    {availableModel}
                                                                </DropdownMenuCheckboxItem>
                                                            ))}
                                                        </DropdownMenuGroup>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                                <p className="project-field-help">
                                                    Select which models Foreman can use in this project.
                                                </p>
                                            </div>
                                        </div>

                                        <DialogFooter>
                                            <DialogClose render={<Button>Done</Button>}/>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            </CardFooter>
                        </CardContent>
                    </Card>
                </section>

                <section className="project-workspace" aria-label="Project chat and workspace">
                    <div className="project-chat">

                    <div className="project-subagent-strip" aria-label="Subagent status">
                        <ItemGroup className="project-subagent-list">
                            {subagents.map((subagent) => (
                                <Item key={subagent.name} variant="outline" size="xs" className="project-subagent-item">
                                    <ItemContent>
                                        <ItemTitle>{subagent.name}<span className={`project-agent-dot project-agent-${subagent.state}`}/></ItemTitle>
                                        <ItemDescription>{subagent.task}</ItemDescription>
                                        <span className="project-agent-model">{subagent.model}</span>
                                    </ItemContent>
                                </Item>
                            ))}
                        </ItemGroup>
                    </div>

                    <div className="project-debug-panel">
                        <div className="project-debug-heading">
                            <span>Debug panel</span>
                            <span className="project-debug-status">{statusIcon}{debugStatus}</span>
                        </div>
                        <div className="project-debug-controls">
                            <Select value={debugStatus} onValueChange={(value) => typeof value === "string" && setDebugStatus(value)}>
                                <SelectTrigger className="project-debug-select" aria-label="Simulated agent status"><SelectValue/></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="queued">Queued</SelectItem>
                                    <SelectItem value="working">Working</SelectItem>
                                    <SelectItem value="done">Complete</SelectItem>
                                    <SelectItem value="error">Error</SelectItem>
                                </SelectContent>
                            </Select>
                            <label className="project-debug-check"><Checkbox checked={showTrace} onCheckedChange={(checked) => setShowTrace(checked === true)}/><span>Tool trace</span></label>
                            <label className="project-debug-check"><Checkbox checked={showSample} onCheckedChange={(checked) => setShowSample(checked === true)}/><span>Sample messages</span></label>
                        </div>
                    </div>

                    <Conversation className="project-conversation">
                        <ConversationContent>
                            {showSample && messages.length > 0 ? messages.map((message) => (
                                <Message key={message.id} from={message.role}>
                                    <MessageContent><MessageResponse>{message.text}</MessageResponse></MessageContent>
                                    {showTrace && message.role === "assistant" && <Task className="project-message-task" defaultOpen={false}>
                                        <TaskTrigger title={`Agent trace · ${debugStatus}`}/>
                                        <TaskContent><TaskItem>Model: {model}</TaskItem><TaskItem>Route: {debugStatus}</TaskItem></TaskContent>
                                    </Task>}
                                </Message>
                            )) : <ConversationEmptyState title={showSample ? "New chat" : "No messages"} description={showSample ? "Send a message to start this conversation." : "Use the prompt below to test this project agent."} icon={<Bot/>}/>} 
                        </ConversationContent>
                        <ConversationScrollButton />
                    </Conversation>

                        <PromptInput className="project-prompt" onSubmit={submitMessage}>
                            <PromptInputTextarea placeholder="Message the project agent..." aria-label="Message the project agent" />
                            <PromptInputFooter>
                                <PromptInputTools className="project-prompt-tools">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger
                                            aria-label="Adjust reasoning effort"
                                            render={<Button type="button" variant="ghost" size="sm" className="project-effort-trigger"/>}
                                        >
                                            Effort: {["Minimal", "Low", "Medium", "High", "Max"][effort - 1]}
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent className="project-effort-menu" align="start">
                                            <div className="project-effort-menu-heading">
                                                <span>Reasoning effort </span>
                                                <output>{effortLevels[effort - 1]}</output>
                                            </div>
                                            <Slider
                                                id="project-effort"
                                                value={[effort]}
                                                min={1}
                                                max={5}
                                                step={1}
                                                thumbLabels={["Agent reasoning effort"]}
                                                aria-label="Agent reasoning effort"
                                                onValueChange={(value) => {
                                                    const nextValue = Array.isArray(value) ? value[0] : value
                                                    if (typeof nextValue === "number") setEffort(nextValue)
                                                }}
                                            />
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger
                                            aria-label="Select Foreman model"
                                            render={<Button type="button" variant="ghost" size="sm" className="project-model-trigger"/>}
                                        >
                                            {model}
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent className="project-model-menu" align="start">
                                            <DropdownMenuGroup>
                                                <DropdownMenuLabel>Foreman model</DropdownMenuLabel>
                                            </DropdownMenuGroup>
                                            <DropdownMenuRadioGroup value={model} onValueChange={setModel}>
                                                {enabledModels.map((availableModel) => (
                                                    <DropdownMenuRadioItem key={availableModel} value={availableModel}>
                                                        {availableModel}
                                                    </DropdownMenuRadioItem>
                                                ))}
                                            </DropdownMenuRadioGroup>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </PromptInputTools>
                                <PromptInputSubmit status="ready"><Send/></PromptInputSubmit>
                            </PromptInputFooter>
                        </PromptInput>
                    </div>
                </section>
            </div>
        </div>
    )
}

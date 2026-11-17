import {useEffect, useState} from 'react'
import {FolderOpen} from '@gravity-ui/icons'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {Button} from '@/components/ui/button'
import {Badge} from '@/components/ui/badge'
import {Input} from '@/components/ui/input'
import {Textarea} from '@/components/ui/textarea'
import {Field, FieldDescription, FieldGroup, FieldLabel} from '@/components/ui/field'
import {Separator} from '@/components/ui/separator'
import {Checkpoint, CheckpointIcon, CheckpointTrigger} from '@/components/ai-elements/checkpoint'
import type {WorkspaceState} from '../../shared/agent'

export function ProjectDetails({open, name, projectPath, workspace, running, pending, onRename, onSaveMemory, onRestore, availableModels, enabledModels, onToggleModel, error}: {
    availableModels: string[]; enabledModels: string[]; onToggleModel: (id: string, enabled: boolean) => void; error?: string
    open: boolean; name: string; projectPath: string; workspace: WorkspaceState
    running: boolean; pending: boolean; onRename: (name: string) => void; onSaveMemory: (text: string) => Promise<void>; onRestore: (id: string) => void
}) {
    const [draftName, setDraftName] = useState(name)
    const [memory, setMemory] = useState(workspace.memory)
    useEffect(() => { if (open) { setDraftName(name); setMemory(workspace.memory) } }, [open, name, workspace.memory])
    return <div className="project-details-panel" aria-label="Project details" aria-hidden={!open} inert={!open ? true : undefined}>
        <header className="project-details-panel-header"><h2>Project details</h2></header>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <section className="project-details-section"><h3>General</h3><FieldGroup>
            <Field><FieldLabel htmlFor="project-name">Project name</FieldLabel><div className="project-name-edit"><Input id="project-name" value={draftName} onChange={e => setDraftName(e.target.value)}/><Button variant="outline" disabled={!draftName.trim() || draftName.trim() === name} onClick={() => onRename(draftName.trim())}>Save</Button></div></Field>
            <Field><FieldLabel>Folder</FieldLabel><p className="project-details-path"><FolderOpen/>{projectPath}</p></Field>
        </FieldGroup></section>
        <Separator/>
        <section className="project-details-section"><h3>Models</h3><FieldGroup><Field><FieldLabel>Available to Foreman</FieldLabel><DropdownMenu><DropdownMenuTrigger disabled={running || !availableModels.length} render={<Button variant="outline"/>}>{enabledModels.length} enabled</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuGroup>{availableModels.map(id => <DropdownMenuCheckboxItem key={id} checked={enabledModels.includes(id)} disabled={enabledModels.length === 1 && enabledModels.includes(id)} onCheckedChange={checked => onToggleModel(id, checked === true)}>{id}</DropdownMenuCheckboxItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu><FieldDescription>Select which configured models this project can use.</FieldDescription></Field></FieldGroup></section>
        <Separator/>
        <section className="project-details-section"><h3>Memories</h3><FieldGroup><Field><FieldLabel htmlFor="project-memory">Project memory</FieldLabel><Textarea id="project-memory" value={memory} onChange={e => setMemory(e.target.value)} rows={4}/><FieldDescription>Notes carried into future conversations in this project.</FieldDescription></Field></FieldGroup><Button className="project-details-save" disabled={running || pending || memory === workspace.memory} onClick={() => onSaveMemory(memory)}>Save memory</Button></section>
        <Separator/>
        <section className="project-details-section"><h3>Checkpoints <Badge variant="secondary">{workspace.checkpoints.length}</Badge></h3><p className="project-detail-help">Restore file changes. Conflicting manual edits are preserved.</p><div className="project-checkpoint-list">{workspace.checkpoints.length ? workspace.checkpoints.map((checkpoint, index) => <Checkpoint key={checkpoint.id}><CheckpointIcon/><CheckpointTrigger disabled={running || pending || workspace.cursor === index} onClick={() => onRestore(checkpoint.id)}>{checkpoint.label} · {new Date(checkpoint.createdAt).toLocaleString()} {workspace.cursor === index ? '· Current' : ''}</CheckpointTrigger></Checkpoint>) : <p>Checkpoints appear here after the first agent run.</p>}</div></section>
        <Separator/>
        <section className="project-details-section"><h3>Skills <Badge variant="secondary">{workspace.skills.length}</Badge></h3><p className="project-detail-help">Project skills are enabled automatically. Manage global skills in Plugins.</p>{workspace.skills.map(skill => <div key={skill.filePath} className="project-skill"><strong>{skill.name}</strong><Badge variant="secondary">Enabled</Badge><p>{skill.description}</p></div>)}</section>
    </div>
}

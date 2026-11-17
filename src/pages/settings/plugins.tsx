import {useEffect, useState} from 'react'
import {BookOpen, Plus, TrashBin} from '@gravity-ui/icons'
import {Button} from '@/components/ui/button'
import {Badge} from '@/components/ui/badge'
import {Checkbox} from '@/components/ui/checkbox'
import {Input} from '@/components/ui/input'
import {Textarea} from '@/components/ui/textarea'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog'
import {Field, FieldGroup, FieldLabel} from '@/components/ui/field'
import {defaultAgentConfig, type AgentConfig, type McpServer} from '../../../shared/agent'
import {agentAPI, readAgentConfig, saveAgentConfig} from '@/lib/agent-client'

export default function PluginsSettings() {
    const [config, setConfig] = useState<AgentConfig>(defaultAgentConfig)
    const [loading, setLoading] = useState(true)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState('')
    const [open, setOpen] = useState(false)
    const [name, setName] = useState('')
    const [transport, setTransport] = useState<'http' | 'stdio'>('http')
    const [endpoint, setEndpoint] = useState('')
    const [args, setArgs] = useState('[]')
    useEffect(() => {
        let active = true
        readAgentConfig().then(value => { if (active) setConfig(value) })
            .catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [])
    async function save(next: AgentConfig) {
        setPending(true); setError('')
        try { setConfig(await saveAgentConfig({...next, plugins: {...next.plugins, mcp: true, skills: true}})); return true }
        catch (error) { setError(error.message); return false }
        finally { setPending(false) }
    }
    async function addServer(event: React.FormEvent) {
        event.preventDefault()
        let server: McpServer
        try {
            const base = {id: crypto.randomUUID(), name: name.trim(), enabled: true}
            if (transport === 'http') {
                const url = new URL(endpoint)
                if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) URL without embedded credentials.')
                server = {...base, transport, url: url.toString()}
            } else {
                const parsed: unknown = JSON.parse(args)
                if (!Array.isArray(parsed) || parsed.some(arg => typeof arg !== 'string')) throw new Error('Arguments must be a JSON array of strings.')
                server = {...base, transport, command: endpoint.trim(), args: parsed}
            }
        } catch (error) { setError(error.message); return }
        if (await save({...config, mcpServers: [...config.mcpServers, server]})) {
            setOpen(false); setName(''); setEndpoint(''); setArgs('[]')
        }
    }
    const disabled = loading || pending
    return <div className="settings-fields plugins-settings">
        <p className="settings-section-intro">Add skills and MCP servers available across your projects.</p>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <header className="plugins-header"><div><h2>Skills</h2><p className="settings-section-intro">Global skills for every project. Skills inside a project are discovered and enabled automatically.</p></div><Button variant="outline" disabled={disabled || !window.agentAPI} onClick={async () => {
            setPending(true); setError('')
            try { const directory = await agentAPI().selectDirectory(); if (directory) setConfig(await agentAPI().importSkill(directory)) }
            catch (error) { setError(error.message) }
            finally { setPending(false) }
        }}><Plus data-icon="inline-start"/>Add global skill</Button></header>
        {(config.globalSkills ?? []).length ? <ul className="plugins-list" aria-label="Global skills">{config.globalSkills.map(skill => <li className="plugins-item" key={skill.id}><span className="plugins-item-icon"><BookOpen/></span><span className="plugins-item-copy"><span className="plugins-item-name">{skill.name}</span><span className="plugins-item-id">{skill.path}</span></span><Checkbox checked={skill.enabled} disabled={disabled} aria-label={`Enable skill ${skill.name}`} onCheckedChange={checked => save({...config, globalSkills: config.globalSkills.map(item => item.id === skill.id ? {...item, enabled: checked === true} : item)})}/><Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={`Remove skill ${skill.name}`} onClick={() => save({...config, globalSkills: config.globalSkills.filter(item => item.id !== skill.id)})}><TrashBin/></Button></li>)}</ul> : <p className="settings-section-intro">No global skills added. Choose a folder containing SKILL.md to add one.</p>}
        <header className="plugins-header"><h2>MCP servers</h2><Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button disabled={disabled} variant="outline"><Plus data-icon="inline-start"/>Add server</Button>}/><DialogContent><form onSubmit={addServer}><DialogHeader><DialogTitle>Add MCP server</DialogTitle><DialogDescription>Connect a Streamable HTTP endpoint or launch a local stdio server. The agent will request permission before connecting.</DialogDescription></DialogHeader>
            <FieldGroup className="mt-5"><Field><FieldLabel htmlFor="mcp-name">Name</FieldLabel><Input id="mcp-name" value={name} onChange={e => setName(e.target.value)} required/></Field><Field><FieldLabel>Transport</FieldLabel><Select items={[{value:"http",label:"Streamable HTTP"},{value:"stdio",label:"Stdio process"}]} value={transport} onValueChange={value => value && setTransport(value as typeof transport)}><SelectTrigger aria-label="MCP transport"><SelectValue/></SelectTrigger><SelectContent><SelectGroup><SelectItem value="http">Streamable HTTP</SelectItem><SelectItem value="stdio">Stdio process</SelectItem></SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="mcp-endpoint">{transport === 'http' ? 'Server URL' : 'Command'}</FieldLabel><Input id="mcp-endpoint" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder={transport === 'http' ? 'https://example.com/mcp' : 'npx'} required/></Field>{transport === 'stdio' && <Field><FieldLabel htmlFor="mcp-args">Arguments (JSON)</FieldLabel><Textarea id="mcp-args" value={args} onChange={e => setArgs(e.target.value)} placeholder='["-y", "@your/mcp-server"]'/></Field>}</FieldGroup>
            {error && <p role="alert" className="settings-error">{error}</p>}<DialogFooter className="mt-5"><Button type="submit" disabled={disabled}>Add server</Button></DialogFooter></form></DialogContent></Dialog></header>
        {config.mcpServers.length ? <ul className="plugins-list">{config.mcpServers.map(server => <li key={server.id} className="plugins-item"><span className="plugins-item-copy"><span className="plugins-item-name">{server.name}</span><span className="plugins-item-id">{server.transport === 'http' ? server.url : `${server.command} ${server.args.join(' ')}`}</span></span><Badge variant="outline">{server.transport}</Badge><Checkbox disabled={disabled} checked={server.enabled} aria-label={`Enable MCP ${server.name}`} onCheckedChange={checked => save({...config, mcpServers: config.mcpServers.map(item => item.id === server.id ? {...item, enabled: checked === true} : item)})}/><Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={`Remove MCP ${server.name}`} onClick={() => save({...config, mcpServers: config.mcpServers.filter(item => item.id !== server.id)})}><TrashBin/></Button></li>)}</ul> : <p className="settings-section-intro">No MCP servers configured.</p>}
    </div>
}

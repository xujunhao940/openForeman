import {useEffect, useState} from 'react'
import {Field, FieldDescription, FieldGroup, FieldLabel} from '@/components/ui/field'
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {permissionOptions, readAgentConfig, saveAgentConfig} from '@/lib/agent-client'
import {defaultAgentConfig, type PermissionMode} from '../../../shared/agent'

export default function PermissionsSettings() {
    const [config, setConfig] = useState(defaultAgentConfig)
    const [pending, setPending] = useState(true)
    const [error, setError] = useState('')
    useEffect(() => {
        let active = true
        readAgentConfig().then(value => { if (active) setConfig(value) }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setPending(false) })
        return () => { active = false }
    }, [])
    async function save(mode: PermissionMode) {
        setPending(true); setError('')
        try { setConfig(await saveAgentConfig({...config, permissionMode: mode, plugins: {...config.plugins, 'permission-system': true}})) }
        catch (error) { setError(error.message) }
        finally { setPending(false) }
    }
    return <div className="settings-fields permissions-settings">
        <p className="settings-section-intro">Choose the default for new conversations. Change a conversation's permission mode in its message composer.</p>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <FieldGroup><Field><FieldLabel>Default permissions</FieldLabel><Select items={permissionOptions} value={config.permissionMode} disabled={pending} onValueChange={value => value && save(value as PermissionMode)}><SelectTrigger aria-label="Default permissions"><SelectValue/></SelectTrigger><SelectContent><SelectGroup>{permissionOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldDescription>Applies to conversations without an override.</FieldDescription></Field></FieldGroup>
        <dl className="permissions-descriptions"><div><dt>Ask before actions</dt><dd>Request approval before editing files, running commands, accessing web pages or calling MCP tools.</dd></div><div><dt>Approve for me</dt><dd>Uses the selected model to review actions. Foreman asks you about actions it cannot approve.</dd></div><div><dt>Read only</dt><dd>Inspect the project and plan changes. File writes, shell commands and MCP tools are blocked.</dd></div><div><dt>Allow all actions</dt><dd>Run tools without individual approval. Shell commands and MCP servers can access resources beyond the project.</dd></div></dl>
    </div>
}

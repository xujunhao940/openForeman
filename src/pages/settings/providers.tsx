import {useEffect, useRef, useState, type FormEvent} from "react"
import {Plus} from "@gravity-ui/icons"
import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {Field, FieldLabel} from "@/components/ui/field"
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog"
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select"
import {modelsEndpoint, type Provider} from "@/lib/provider-models"
import {deleteProviderKey, fetchProviderModels, readProviderKey, saveProviderKey} from "@/lib/provider-api"
import type {SettingsPageProps} from "@/pages/settings.tsx"

const newProvider = (): Provider => ({id: crypto.randomUUID(), name: 'OpenAI', preset: 'openai', baseUrl: 'https://api.openai.com/v1', models: []})

export default function ProvidersSettings({values, update}: SettingsPageProps) {
    const [draft, setDraft] = useState<Provider | null>(null)
    const [apiKey, setApiKey] = useState('')
    const [busy, setBusy] = useState('')
    const [error, setError] = useState('')
    const [formError, setFormError] = useState('')
    const [status, setStatus] = useState('')
    const mounted = useRef(true)
    useEffect(() => {mounted.current = true; return () => {mounted.current = false}}, [])

    async function edit(provider: Provider) {
        setError('')
        setBusy(provider.id)
        try {
            const key = await readProviderKey(provider.id)
            if (!mounted.current) return
            setApiKey(key)
            setFormError('')
            setDraft({...provider})
        } catch {if (mounted.current) setError('Could not unlock this provider’s API key. Please try again.')}
        finally {if (mounted.current) setBusy('')}
    }

    async function save(event: FormEvent) {
        event.preventDefault()
        if (!draft || busy) return
        setFormError('')
        const provider = {...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim().replace(/\/+$/, '')}
        try {
            if (!provider.name) throw new Error('Enter a provider name.')
            modelsEndpoint(provider.baseUrl)
            if (provider.preset === 'openai' && !apiKey.trim()) throw new Error('Enter an OpenAI API key.')
            setBusy(provider.id)
            await saveProviderKey(provider.id, apiKey.trim())
            if (!mounted.current) return
            const original = values.providers.find((item) => item.id === provider.id)
            if (original && original.baseUrl !== provider.baseUrl) provider.models = []
            update('providers', original ? values.providers.map((item) => item.id === provider.id ? provider : item) : [...values.providers, provider])
            setDraft(null)
            setApiKey('')
            setStatus(`${provider.name} saved. Select Fetch Models to sync its models.`)
        } catch (reason) {if (mounted.current) setFormError(reason instanceof Error ? reason.message : 'Could not save provider.')}
        finally {if (mounted.current) setBusy('')}
    }

    async function fetchModels(provider: Provider) {
        setBusy(provider.id)
        setError('')
        setStatus('')
        try {
            const models = await fetchProviderModels(provider)
            if (!mounted.current) return
            update('providers', values.providers.map((item) => item.id === provider.id ? {...item, models} : item))
            setStatus(`${models.length} models fetched from ${provider.name}. Available in Models.`)
        } catch (reason) {if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not fetch models. Check the connection and provider settings.')}
        finally {if (mounted.current) setBusy('')}
    }

    async function remove(provider: Provider) {
        setBusy(provider.id)
        setError('')
        try {
            await deleteProviderKey(provider.id)
            if (!mounted.current) return
            update('providers', values.providers.filter((item) => item.id !== provider.id))
            setStatus(`${provider.name} removed.`)
        } catch {if (mounted.current) setError('Could not remove provider. Please try again.')}
        finally {if (mounted.current) setBusy('')}
    }

    return <div className="settings-fields">
        <div className="providers-toolbar"><p className="settings-section-intro">Connect providers and fetch their available models.</p>
            <Button size="sm" disabled={!!busy} onClick={() => {setDraft(newProvider()); setApiKey(''); setFormError('')}}><Plus data-icon="inline-start" />Add Provider</Button>
        </div>
        {error && <p role="alert" className="settings-error">{error}</p>}
        {status && <p role="status" className="settings-list-summary">{status}</p>}
        {values.providers.length === 0 && <div className="settings-empty-state"><p>No providers yet</p><span>Add an OpenAI, Anthropic, or custom provider to get started.</span></div>}
        {values.providers.map((provider) => <div className="provider-setting" key={provider.id}>
            <div className="provider-setting-heading"><h2>{provider.name}</h2><span>{provider.preset === 'openai' ? 'OpenAI Responses' : provider.preset === 'anthropic' ? 'Anthropic' : 'OpenAI Responses compatible'} · {provider.models.length} models</span></div>
            <p className="provider-base-url">{provider.baseUrl}</p>
            <div className="provider-actions">
                <Button variant="outline" size="sm" disabled={!!busy} onClick={() => fetchModels(provider)}>{busy === provider.id ? 'Working…' : 'Fetch Models'}</Button>
                <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => edit(provider)}>Edit</Button>
                <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => remove(provider)}>Remove</Button>
            </div>
        </div>)}
        <p className="settings-security-note">{window.providersAPI ? 'API keys are encrypted using your system’s secure storage.' : 'Browser preview: API keys are kept only for this session. Provider settings and models are saved locally.'}</p>
        <Dialog open={!!draft} onOpenChange={(open) => {if (!open && !busy) {setDraft(null); setApiKey('')}}}>
            {draft && <DialogContent className="provider-dialog"><form onSubmit={save}>
                <DialogHeader><DialogTitle>{values.providers.some((item) => item.id === draft.id) ? 'Edit Provider' : 'Add Provider'}</DialogTitle><DialogDescription>Connect to OpenAI Responses, Anthropic Messages, or a compatible API.</DialogDescription></DialogHeader>
                <fieldset className="provider-form-fields" disabled={!!busy}><legend className="sr-only">Provider connection</legend>
                    <div className="provider-form-group">
                        <Field><FieldLabel htmlFor="provider-preset">Preset</FieldLabel>
                            <Select value={draft.preset} items={[{value: 'openai', label: 'OpenAI Responses'}, {value: 'anthropic', label: 'Anthropic'}, {value: 'custom', label: 'Custom (Responses)'}]} onValueChange={(preset) => {
                                if (preset !== 'openai' && preset !== 'anthropic' && preset !== 'custom') return
                                setDraft({...draft, preset, name: preset === 'openai' ? 'OpenAI' : preset === 'anthropic' ? 'Anthropic' : '', baseUrl: preset === 'openai' ? 'https://api.openai.com/v1' : preset === 'anthropic' ? 'https://api.anthropic.com/v1' : ''})
                                setApiKey('')
                            }}>
                                <SelectTrigger id="provider-preset"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectGroup><SelectItem value="openai">OpenAI Responses</SelectItem><SelectItem value="anthropic">Anthropic</SelectItem><SelectItem value="custom">Custom (Responses)</SelectItem></SelectGroup></SelectContent>
                            </Select>
                        </Field>
                        <Field><FieldLabel htmlFor="provider-name">Name</FieldLabel><Input id="provider-name" value={draft.name} onChange={(event) => setDraft({...draft, name: event.target.value})} placeholder="My provider" required maxLength={100} /></Field>
                        <Field><FieldLabel htmlFor="provider-base-url">Base URL</FieldLabel><Input id="provider-base-url" type="url" value={draft.baseUrl} onChange={(event) => setDraft({...draft, baseUrl: event.target.value})} placeholder="https://api.example.com/v1" required aria-describedby="provider-url-help" /><p id="provider-url-help" className="provider-field-help">Models are fetched from your base URL + /models.</p></Field>
                        <Field><FieldLabel htmlFor="provider-api-key">API key{draft.preset === 'custom' ? ' (optional)' : ''}</FieldLabel><Input id="provider-api-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..." required={draft.preset !== 'custom'} /></Field>
                    </div>
                </fieldset>
                {formError && <p role="alert" className="settings-error">{formError}</p>}
                <DialogFooter><Button type="button" variant="ghost" disabled={!!busy} onClick={() => {setDraft(null); setApiKey('')}}>Cancel</Button><Button type="submit" disabled={!!busy}>{busy ? 'Saving…' : 'Save Provider'}</Button></DialogFooter>
            </form></DialogContent>}
        </Dialog>
    </div>
}

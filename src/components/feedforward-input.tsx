import {Checkbox} from '@/components/ui/checkbox'
import {Input} from '@/components/ui/input'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select'
import {Button} from '@/components/ui/button'
import {PromptInputTextarea} from '@/components/ai-elements/prompt-input'
import {configuredModels, agentAPI} from '@/lib/agent-client'
import type {FeedforwardControl as Control, FeedforwardDetail, FeedforwardSuggestion} from '../../shared/agent'
import {Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger} from '@/components/ui/popover'
import {useEffect, useRef, useState} from 'react'

type Match = FeedforwardSuggestion & {start: number; end: number; id: string}
type RecognitionState = {kind: 'idle' | 'working' | 'empty'} | {kind: 'error'; message: string}

function feedforwardSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem('foreman_settings') ?? '{}')
        return {enabled: saved.intraTurnEnabled === true, modelId: typeof saved.intraTurnModelId === 'string' ? saved.intraTurnModelId : ''}
    } catch { return {enabled: false, modelId: ''} }
}

export function FeedforwardInput({value, onChange, placeholder, details, onDetailsChange}: {
    value: string
    onChange: (value: string) => void
    placeholder: string
    details: FeedforwardDetail[]
    onDetailsChange: (details: FeedforwardDetail[]) => void
}) {
    const [matches, setMatches] = useState<Match[]>([])
    const [openId, setOpenId] = useState<string | null>(null)
    const [controlValues, setControlValues] = useState<Record<string, string>>({})
    const [credentialError, setCredentialError] = useState('')
    const [recognition, setRecognition] = useState<RecognitionState>({kind: 'idle'})
    const highlightRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        let cancelled = false
        setRecognition({kind: 'idle'})
        setMatches([])
        setOpenId(null)
        if (value.trim().length < 8) return
        const timer = window.setTimeout(async () => {
            const settings = feedforwardSettings()
            if (!settings.enabled || !settings.modelId || !window.agentAPI || credentialError) return
            const model = configuredModels().find(item => item.id === settings.modelId)
            const provider = model?.providers.find(item => item.id === model.providerId)
            if (!model || !provider) return
            setRecognition({kind: 'working'})
            try {
                const suggestions = await agentAPI().identifyFeedforward(value, provider, model.id)
                if (cancelled) return
                if (!Array.isArray(suggestions)) {
                    setCredentialError(suggestions.credentialError)
                    setRecognition({kind: 'idle'})
                    return
                }
                const resolved = suggestions.flatMap((suggestion, index): Match[] => {
                    const start = value.indexOf(suggestion.phrase)
                    return start < 0 ? [] : [{...suggestion, start, end: start + suggestion.phrase.length, id: `${index}-${suggestion.phrase}`}]
                }).sort((a, b) => a.start - b.start).filter((item, index, all) => index === 0 || item.start >= all[index - 1].end)
                setMatches(resolved)
                setRecognition(resolved.length ? {kind: 'idle'} : {kind: 'empty'})
            } catch (error) {
                if (!cancelled) {
                    setMatches([])
                    setRecognition({kind: 'error', message: error instanceof Error ? error.message : 'Feedforward could not analyze this draft.'})
                }
            }
        }, 300)
        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [value, credentialError])

    function editMatch(match: Match, open: boolean) {
        if (open) {
            const saved = details.filter(detail => detail.phrase === match.phrase)
            setControlValues(Object.fromEntries(saved.map(detail => [detail.label, detail.value])))
        }
        setOpenId(open ? match.id : null)
    }

    function saveDetails(match: Match) {
        const selected = match.control.flatMap(({label}) => {
            const value = controlValues[label]?.trim()
            return value ? [{phrase: match.phrase, label, value}] : []
        })
        onDetailsChange([...details.filter(detail => detail.phrase !== match.phrase), ...selected])
        setOpenId(null)
    }

    function removeDetail(match: Match) {
        onDetailsChange(details.filter(detail => detail.phrase !== match.phrase))
        setOpenId(null)
    }

    function hasDetail(match: Match) {
        return details.some(detail => detail.phrase === match.phrase)
    }

    const parts: Array<{text: string; match?: Match}> = []
    let cursor = 0
    for (const match of matches) {
        parts.push({text: value.slice(cursor, match.start)})
        parts.push({text: match.phrase, match})
        cursor = match.end
    }
    parts.push({text: value.slice(cursor)})

    return <div className="feedforward-input-shell">
        {credentialError && <p role="status" className="feedforward-error">{credentialError}</p>}
        <div role={recognition.kind === 'error' ? 'alert' : 'status'} className="feedforward-generation-status">
            {recognition.kind === 'working' ? 'Generating Feedforward…' : recognition.kind === 'empty' ? 'No specific details to clarify yet' : recognition.kind === 'error' ? recognition.message : ''}
        </div>
        <div className="feedforward-editor">
            <PromptInputTextarea value={value} onChange={event => onChange(event.currentTarget.value)} placeholder={placeholder}
                aria-label="Message the project agent" className={matches.length ? 'feedforward-textarea has-highlights' : 'feedforward-textarea'}
                onScroll={event => { if (highlightRef.current) highlightRef.current.scrollTop = event.currentTarget.scrollTop }} />
            {matches.length > 0 && <div className="feedforward-highlights" ref={highlightRef} aria-label="Feedforward suggestions" aria-hidden="false">
            {parts.map((part, index) => part.match ? <span className="feedforward-match" key={`${part.match.id}-${index}`}>
                <Popover open={openId === part.match.id} onOpenChange={open => editMatch(part.match!, open)}>
                    <PopoverTrigger className="feedforward-highlight" aria-label={`Add detail for ${part.match.phrase}`} title={part.match.label}>{part.text}</PopoverTrigger>
                    <PopoverContent side="top" sideOffset={8} align="center" className="feedforward-popover-content">
                        <PopoverHeader className="feedforward-popover-header">
                            <PopoverTitle>{part.match.label}</PopoverTitle>
                        </PopoverHeader>
                        {part.match.control.map(control => <div key={control.label} className="grid gap-1 text-xs">
                            <span>{control.label}</span>
                            <FeedforwardControl control={control} value={controlValues[control.label] ?? ''}
                                onChange={next => setControlValues(current => ({...current, [control.label]: next}))} />
                        </div>)}
                        <div className="feedforward-popover-footer">
                            {hasDetail(part.match) && <Button type="button" size="sm" variant="ghost" onClick={() => removeDetail(part.match!)}>Remove</Button>}
                            <Button type="button" size="sm" disabled={!part.match.control.some(control => controlValues[control.label]?.trim())}
                                onClick={() => saveDetails(part.match!)}>{hasDetail(part.match) ? 'Save detail' : 'Add detail'}</Button>
                        </div>
                    </PopoverContent>
                </Popover>
            </span> : <span key={`text-${index}`}>{part.text}</span>)}
            </div>}
        </div>
    </div>
}

function FeedforwardControl({control, value, onChange}: {control: Control; value: string; onChange: (value: string) => void}) {
    switch (control.type) {
        case 'color':
            return <input className="feedforward-color" type="color" aria-label={control.label} value={value || '#526579'} onChange={event => onChange(event.currentTarget.value)} />
        case 'select':
            return <Select value={value} onValueChange={next => next && onChange(next)}>
                <SelectTrigger aria-label={control.label} className="feedforward-control-select"><SelectValue placeholder="Choose an option" /></SelectTrigger>
                <SelectContent className="feedforward-select-content">{control.options?.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
            </Select>
        case 'checkbox':
            return <Checkbox aria-label={control.label} checked={value === 'Yes'} indeterminate={!value} onCheckedChange={checked => onChange(checked === true ? 'Yes' : 'No')} />
        case 'text':
            return <Input aria-label={control.label} className="feedforward-control-text" value={value} onChange={event => onChange(event.currentTarget.value)} />
    }
}

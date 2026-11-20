import {useState} from 'react'
import {ChevronDown, ChevronUp, Pencil} from 'lucide-react'
import {Button} from '@/components/ui/button'
import type {QueueAction, QueuedPrompt} from '../../shared/agent'

export function QueuedPrompts({items, disabled, update}: {
    items: QueuedPrompt[]; disabled: boolean; update: (id: string, action: QueueAction) => Promise<void>
}) {
    const [edit, setEdit] = useState<{id: string; text: string} | null>(null)
    if (!items.length) return null
    return <section className="prompt-queue" aria-label="Message queue">
        <small>Queued messages · {items.length}</small>
        <ol>{items.map((item, index) => <li key={item.id}>
            {edit?.id === item.id ? <form onSubmit={async event => {
                event.preventDefault()
                try { await update(item.id, {kind: 'edit', text: edit.text}); setEdit(null) } catch { /* Parent displays the error. */ }
            }}>
                <textarea aria-label="Edit queued message" autoFocus value={edit.text} onChange={e => setEdit({id: item.id, text: e.target.value})}/>
                <Button size="sm" type="submit" disabled={disabled || !edit.text.trim()}>Save</Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            </form> : <>
                <span className="queue-text" title={item.text}>{item.text}</span>
                <div className="queue-actions">
                    {(['up', 'down'] as const).map(kind => <Button key={kind} size="icon-sm" variant="ghost" aria-label={`Move message ${kind}`} disabled={disabled || item.steering || (kind === 'up' ? index === 0 : index === items.length - 1)} onClick={() => void update(item.id, {kind}).catch(() => {})}>{kind === 'up' ? <ChevronUp/> : <ChevronDown/>}</Button>)}
                    <Button size="icon-sm" variant="ghost" aria-label="Edit queued message" title="Edit message" disabled={disabled || item.steering} onClick={() => setEdit({id: item.id, text: item.text})}><Pencil/></Button>
                    <Button size="sm" variant="outline" disabled={disabled || item.steering} onClick={() => void update(item.id, {kind: 'steer'}).catch(() => {})}>{item.steering ? 'Steering…' : 'Steer'}</Button>
                </div>
            </>}
        </li>)}</ol>
    </section>
}

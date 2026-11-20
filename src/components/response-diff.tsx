import {useState} from 'react'
import {ArrowUturnCcwLeft, ArrowUturnCwRight} from '@gravity-ui/icons'
import {ChevronDown, ChevronRight} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Badge} from '@/components/ui/badge'
import {cn} from '@/lib/utils'
import type {TurnChangeFile} from '../../shared/agent'

type DiffLine = {kind: 'add' | 'remove' | 'context' | 'hunk'; text: string; old?: number; next?: number}
function diffLines(patch: string): DiffLine[] {
    let old = 0, next = 0, inHunk = false
    const result: DiffLine[] = []
    for (const text of patch.split('\n')) {
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
        if (hunk) { inHunk = true; old = Number(hunk[1]); next = Number(hunk[2]); result.push({kind: 'hunk', text}); continue }
        if (!inHunk || text.startsWith('\\')) continue
        if (text.startsWith('+')) result.push({kind: 'add', text: text.slice(1), next: next++})
        else if (text.startsWith('-')) result.push({kind: 'remove', text: text.slice(1), old: old++})
        else if (text.startsWith(' ')) result.push({kind: 'context', text: text.slice(1), old: old++, next: next++})
    }
    return result
}

export function ResponseDiff({files, undoDisabled, redoDisabled, onUndo, onRedo}: {
    files: TurnChangeFile[]; undoDisabled: boolean; redoDisabled: boolean; onUndo: () => void; onRedo: () => void
}) {
    const [expanded, setExpanded] = useState(false)
    return <section className="answer-change-diff" aria-label="This response file diff">
        <header className="answer-change-header"><button type="button" className="answer-change-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><span className="answer-change-summary-label">{expanded ? <ChevronDown aria-hidden="true"/> : <ChevronRight aria-hidden="true"/>}{files.length} {files.length === 1 ? 'file changed' : 'files changed'}</span><span className="answer-change-counts">+{files.reduce((sum, file) => sum + file.additions, 0)} −{files.reduce((sum, file) => sum + file.deletions, 0)}</span></button>
            <div className="answer-change-actions"><Button type="button" size="sm" variant="ghost" disabled={undoDisabled} onClick={onUndo}><ArrowUturnCcwLeft data-icon="inline-start"/>Undo</Button><Button type="button" size="sm" variant="ghost" disabled={redoDisabled} onClick={onRedo}><ArrowUturnCwRight data-icon="inline-start"/>Redo</Button></div>
        </header>
        {!expanded && <div className="answer-change-preview" aria-label="Diff preview">{files.slice(0, 3).map(file => {
            const excerpt = file.patch.split('\n').find(line => line.startsWith('+') && !line.startsWith('+++'))
                ?? file.patch.split('\n').find(line => line.startsWith('-') && !line.startsWith('---'))
            return <div key={file.path}><span className="answer-change-preview-path">{file.path}</span>{excerpt && <code className={excerpt.startsWith('+') ? 'is-added' : 'is-removed'}>{excerpt.slice(1).trim().slice(0, 96)}</code>}</div>
        })}{files.length > 3 && <span className="answer-change-preview-more">+{files.length - 3} more files</span>}</div>}
        {expanded && <div className="answer-change-files">{files.map(file => <section key={file.path} className="answer-change-file"><header><strong>{file.path}</strong><Badge variant="outline">{file.status}</Badge><span>+{file.additions} −{file.deletions}</span></header>
            {file.binary ? <p className="review-file-note">Binary file · preview unavailable</p> : <div className="review-lines">{diffLines(file.patch).map((line, index) => <div key={index} className={cn('review-line', `review-line-${line.kind}`)}><span aria-hidden="true">{line.old}</span><span aria-hidden="true">{line.next}</span><code>{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '} {line.text}</code></div>)}</div>}
            {file.truncated && <p className="review-file-note">Diff preview truncated.</p>}
        </section>)}</div>}
    </section>
}

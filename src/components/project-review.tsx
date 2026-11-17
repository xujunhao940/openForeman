import {useEffect, useState} from 'react'
import {Code, Play} from '@gravity-ui/icons'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'
import {Badge} from '@/components/ui/badge'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {agentAPI} from '@/lib/agent-client'
import {cn} from '@/lib/utils'
import type {ReviewFile} from '../../shared/agent'

type DiffLine = {kind: 'add' | 'remove' | 'context' | 'hunk'; text: string; old?: number; next?: number}
function diffLines(patch: string): DiffLine[] {
    let old = 0, next = 0, inHunk = false
    const lines: DiffLine[] = []
    for (const text of patch.split('\n')) {
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
        if (hunk) { inHunk = true; old = Number(hunk[1]); next = Number(hunk[2]); lines.push({kind: 'hunk', text}); continue }
        if (!inHunk || text.startsWith('\\')) continue
        if (text.startsWith('+')) lines.push({kind: 'add', text: text.slice(1), next: next++})
        else if (text.startsWith('-')) lines.push({kind: 'remove', text: text.slice(1), old: old++})
        else if (text.startsWith(' ')) lines.push({kind: 'context', text: text.slice(1), old: old++, next: next++})
    }
    return lines
}
export function ProjectReview({open, onOpenChange, projectPath, canReview, onReview}: {
    open: boolean; onOpenChange: (open: boolean) => void; projectPath: string; canReview: boolean; onReview: () => void
}) {
    const [files, setFiles] = useState<ReviewFile[]>([])
    const [selected, setSelected] = useState('')
    const [pending, setPending] = useState(false)
    const [error, setError] = useState('')
    useEffect(() => {
        if (!open) return
        let active = true
        setPending(true); setError(''); setFiles([])
        Promise.resolve().then(() => agentAPI().review(projectPath)).then(result => {
            if (active) { setFiles(result); setSelected(result[0]?.path ?? '') }
        }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setPending(false) })
        return () => { active = false }
    }, [open, projectPath])
    const file = files.find(file => file.path === selected)
    return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="project-review-dialog">
        <DialogHeader><DialogTitle>Review changes</DialogTitle><DialogDescription>{pending ? 'Loading changed files…' : `${files.length} changed files · +${files.reduce((sum, file) => sum + file.additions, 0)} −${files.reduce((sum, file) => sum + file.deletions, 0)}`}</DialogDescription></DialogHeader>
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : pending ? <p role="status">Loading changes…</p> : !files.length ? <div className="review-empty"><Code/><h3>No changes to review</h3><p>Changed files will appear here after edits.</p></div> : <div className="review-browser">
            <nav className="review-files" aria-label="Changed files">{files.map(file => <Button key={file.path} variant="ghost" aria-current={selected === file.path ? 'true' : undefined} onClick={() => setSelected(file.path)} className="review-file"><span className="review-file-path">{file.path}</span><span className="review-counts">+{file.additions} −{file.deletions}</span></Button>)}</nav>
            <section className="review-file-diff" aria-label={`Changes in ${file?.path}`}><header><strong>{file?.path}</strong><Badge variant="outline">{file?.status}</Badge></header>
                {file?.binary ? <p className="review-file-note">Binary or large file · preview unavailable</p> : file?.patch ? <div className="review-lines">{diffLines(file.patch).map((line, i) => <div key={i} className={cn('review-line', `review-line-${line.kind}`)}><span aria-hidden="true">{line.old}</span><span aria-hidden="true">{line.next}</span><code>{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '} {line.text}</code></div>)}</div> : <p className="review-file-note">File metadata changed · no text changes</p>}
                {file?.truncated && <p className="review-file-note">Preview truncated. Inspect the full file in your editor.</p>}
            </section>
        </div>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button><Button disabled={!canReview || !files.length || pending} onClick={onReview}><Play data-icon="inline-start"/>Review with agent</Button></DialogFooter>
    </DialogContent></Dialog>
}

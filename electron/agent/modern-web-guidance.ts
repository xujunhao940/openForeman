import {readFile, stat} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {homedir} from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {Type} from 'typebox'
import {defineTool, type ToolDefinition} from '@mariozechner/pi-coding-agent'

type Guide = {
    id: string
    description: string
    category: string
    originTrials?: {id: string; chromestatus_url?: string}[]
    volatileFeatures?: {id: string}[]
}
type SearchModule = {searchUseCases: (query: string, limit?: number) => Promise<{id: string; description: string}[]>}

const packageRoot = path.dirname(createRequire(import.meta.url).resolve('modern-web-guidance/package.json'))
const skillRoot = path.join(packageRoot, 'skills')
const guidanceRoot = path.join(skillRoot, 'modern-web-guidance')
const readOnlyResult = (text: string) => ({content: [{type: 'text' as const, text}], details: {}})
let searchModule: Promise<SearchModule> | undefined
let guides: Promise<Guide[]> | undefined

export function modernWebGuidancePaths() {
    return [path.join(guidanceRoot), path.join(skillRoot, 'chrome-extensions')]
}

async function loadSearchModule() {
    searchModule ??= import(pathToFileURL(path.join(guidanceRoot, 'search.mjs')).href) as Promise<SearchModule>
    return searchModule
}

async function loadGuides() {
    guides ??= readFile(path.join(guidanceRoot, 'gen', 'guides.json'), 'utf8').then(value => JSON.parse(value) as Guide[])
    return guides
}

async function projectGuidanceConfig(cwd: string) {
    let directory = path.resolve(cwd)
    let atRoot = false
    let foundRepository = false
    while (!atRoot) {
        const configPath = path.join(directory, '.mwgrc')
        try {
            const value = JSON.parse(await readFile(configPath, 'utf8'))
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.')
            return value as Record<string, unknown>
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Invalid .mwgrc at ${configPath}.`)
        }
        const parent = path.dirname(directory)
        atRoot = parent === directory
        foundRepository = await exists(path.join(directory, '.git'))
        if (atRoot || foundRepository) break
        directory = parent
    }
    if (foundRepository) return {}
    try {
        const configPath = path.join(homedir(), '.mwgrc')
        const value = JSON.parse(await readFile(configPath, 'utf8'))
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.')
        return value as Record<string, unknown>
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
        throw new Error(`Invalid .mwgrc in the user home directory.`)
    }
}

async function exists(file: string) {
    try { await stat(file); return true }
    catch { return false }
}

async function retrieveGuides(cwd: string, ids: string[]) {
    const catalog = await loadGuides()
    const config = await projectGuidanceConfig(cwd)
    const baseline = typeof config.baseline === 'string' ? config.baseline.trim().toLowerCase() : ''
    const output: string[] = []
    for (const id of ids) {
        const guide = catalog.find(item => item.id === id)
        if (!guide) throw new Error(`No modern web guidance guide found for ${id}.`)
        const originTrials = guide.originTrials ?? []
        const volatileFeatures = guide.volatileFeatures ?? []
        if (originTrials.length && config.allowOriginTrials !== true) {
            const idsText = originTrials.map(feature => feature.id).join(', ')
            throw new Error(`Guide ${id} covers Origin Trial features (${idsText}) and requires explicit project opt-in. Set allowOriginTrials to true in .mwgrc before retrieving it.`)
        }
        if (volatileFeatures.length && config.allowVolatileFeatures !== true) {
            const idsText = volatileFeatures.map(feature => feature.id).join(', ')
            throw new Error(`Guide ${id} covers volatile features (${idsText}) and requires explicit project opt-in. Set allowVolatileFeatures to true in .mwgrc before retrieving it.`)
        }
        let baselineNote = ''
        if (baseline === 'newly' || baseline === 'baseline newly available') baselineNote = 'Project Baseline target is Newly available. Omit fallbacks for features that are Baseline Newly or Widely available.\n\n'
        else if (baseline === 'limited' || baseline === 'limited availability') baselineNote = 'Project Baseline target is Limited availability. All features covered by this guide meet the target, so omit compatibility fallbacks.\n\n'
        else if (/^(?:baseline\s+)?\d{4}$/.test(baseline)) baselineNote = `Project Baseline target is ${baseline.replace(/^baseline\s+/, '')}. Omit fallbacks for features at or before that date.\n\n`
        output.push(`--- Guide for ${id} ---\n${baselineNote}${await readFile(path.join(guidanceRoot, 'guides', guide.category, `${id}.md`), 'utf8')}`)
    }
    return output.join('\n\n')
}

export function modernWebGuidanceTools(cwd: string): ToolDefinition[] {
    return [defineTool({
        name: 'modern_web_guidance_search', label: 'Search web guidance',
        description: 'Search Google Chrome modern web best-practice guides. Use a focused 2-5 word English query describing one web platform capability or UI pattern.',
        parameters: Type.Object({query: Type.String({minLength: 2, maxLength: 200})}),
        execute: async (_id, {query}) => {
            const {searchUseCases} = await loadSearchModule()
            return readOnlyResult(JSON.stringify(await searchUseCases(query, 8)))
        },
    }), defineTool({
        name: 'modern_web_guidance_retrieve', label: 'Retrieve web guidance',
        description: 'Retrieve one or more guide IDs returned by modern_web_guidance_search. Project opt-in rules for Origin Trial and volatile features are enforced.',
        parameters: Type.Object({ids: Type.Array(Type.String({minLength: 1, maxLength: 100}), {minItems: 1, maxItems: 5})}),
        execute: async (_id, {ids}) => readOnlyResult(await retrieveGuides(cwd, ids)),
    })]
}

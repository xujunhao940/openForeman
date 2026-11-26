import {useRef, useState} from "react"
import {CircleInfo, Cpu, Shield, PlugConnection as PlugZap} from "@gravity-ui/icons"
import {Button} from "@/components/ui/button"
import AboutSettings from "@/pages/settings/about"
import ModelsSettings from "@/pages/settings/models.tsx"
import IntraTurnSettings from "@/pages/settings/intra-turn.tsx"
import PermissionsSettings from "@/pages/settings/permissions"
import ProvidersSettings from "@/pages/settings/providers.tsx"
import type {ModelPreference, Provider} from "@/lib/provider-models"
import {Zap} from "lucide-react"
import "./settings.css"

export type SettingsValues = {
    // Retain previous general preferences while the category is hidden.
    language: string
    defaultDirectory: string
    launchAtLogin: boolean
    defaultModel: string
    fallbackModel: string
    routingEnabled: boolean
    contextWindow: 128000 | 256000 | 512000
    intraTurnEnabled: boolean
    intraTurnModelId: string
    openaiKey: string
    anthropicKey: string
    providers: Provider[]
    modelPreferences: Record<string, ModelPreference>
}
export type SettingsPageProps = {
    values: SettingsValues
    update: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void
}
const STORAGE_KEY = "foreman_settings"
const defaults: SettingsValues = {
    language: "en",
    defaultDirectory: "",
    launchAtLogin: false,
    defaultModel: "gpt-6-astra",
    fallbackModel: "gpt-6.1-sol",
    routingEnabled: false,
    contextWindow: 128000,
    intraTurnEnabled: false,
    intraTurnModelId: '',
    openaiKey: "",
    anthropicKey: "",
    providers: [],
    modelPreferences: {},
}
const sections = [
    {id: "models", label: "Models", icon: Cpu},
    {id: "intra-turn", label: "Intra-turn", icon: Zap},
    {id: "providers", label: "Providers", icon: PlugZap},
    {id: "permissions", label: "Permissions", icon: Shield},
    {id: "about", label: "About", icon: CircleInfo},
] as const

function readSettings(): SettingsValues {
    try {
        const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")
        return {
            ...defaults,
            language: typeof stored.language === 'string' ? stored.language : defaults.language,
            defaultDirectory: typeof stored.defaultDirectory === 'string' ? stored.defaultDirectory : '',
            launchAtLogin: stored.launchAtLogin === true,
            defaultModel: typeof stored.defaultModel === "string" ? stored.defaultModel : defaults.defaultModel,
            fallbackModel: typeof stored.fallbackModel === "string" ? stored.fallbackModel : defaults.fallbackModel,
            routingEnabled: stored.routingEnabled === true,
            contextWindow: [128000, 256000, 512000].includes(stored.contextWindow) ? stored.contextWindow : defaults.contextWindow,
            intraTurnEnabled: stored.intraTurnEnabled === true,
            intraTurnModelId: typeof stored.intraTurnModelId === 'string' ? stored.intraTurnModelId : '',
            openaiKey: "",
            anthropicKey: "",
            providers: Array.isArray(stored.providers) ? stored.providers.filter((provider: Provider) =>
                provider && typeof provider.id === 'string' && typeof provider.name === 'string' &&
                typeof provider.baseUrl === 'string' && ['openai', 'anthropic', 'custom'].includes(provider.preset) &&
                Array.isArray(provider.models) && provider.models.every((id) => typeof id === 'string')) : [],
            modelPreferences: stored.modelPreferences && typeof stored.modelPreferences === 'object' && !Array.isArray(stored.modelPreferences)
                ? stored.modelPreferences : {},
        }
    } catch {
        return defaults
    }
}

export default function Settings() {
    const [section, setSection] = useState<(typeof sections)[number]['id']>("models")
    const [values, setValues] = useState(readSettings)
    const valuesRef = useRef(values)
    const [storageError, setStorageError] = useState('')

    function update<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) {
        const nextValues = {...valuesRef.current, [key]: value}
        try {
            if (key !== "openaiKey" && key !== "anthropicKey") {
                const persistedValues = {...nextValues}
                delete persistedValues.openaiKey
                delete persistedValues.anthropicKey
                // Persist first, so failed writes do not silently appear saved.
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedValues))
            }
            valuesRef.current = nextValues
            setStorageError('')
            setValues(nextValues)
        } catch {
            setStorageError('Could not save settings. Check available storage and try again.')
            throw new Error('Could not save settings.')
        }
    }

    return (
        <div className="settings-page">
            <aside className="settings-navigation" aria-label="Settings categories">
                <div className="settings-navigation-heading">Settings</div>
                <nav className="settings-category-list">
                    {sections.map(({id, label, icon: Icon}) => (
                        <Button key={id} type="button" variant="ghost" aria-current={section === id ? "page" : undefined}
                            className={`settings-category${section === id ? " is-active" : ""}`} onClick={() => setSection(id)}>
                            <Icon aria-hidden="true" /><span>{label}</span>
                        </Button>
                    ))}
                </nav>
            </aside>
            <section className="settings-detail" aria-labelledby="settings-title">
                <div className="settings-detail-inner">
                    <header className="settings-detail-header"><h1 id="settings-title">{sections.find((item) => item.id === section)!.label}</h1></header>
                    {storageError && <p role="alert" className="settings-error">{storageError}</p>}
                    {section === "models" && <ModelsSettings values={values} update={update} />}
                    {section === "intra-turn" && <IntraTurnSettings values={values} update={update} />}
                    {section === "permissions" && <PermissionsSettings/>}
                    {section === "about" && <AboutSettings/>}
                    <div hidden={section !== "providers"}><ProvidersSettings values={values} update={update} /></div>
                </div>
            </section>
        </div>
    )
}

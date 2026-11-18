import {Checkbox} from "@/components/ui/checkbox"
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select"
import {isTextModel, modelsUnion} from "@/lib/provider-models"
import type {SettingsPageProps} from "@/pages/settings.tsx"

export default function ModelsSettings({values, update}: SettingsPageProps) {
    const models = modelsUnion(values.providers, values.modelPreferences)
    const enabledTextModels = models.filter((model) => model.enabled && isTextModel(model.id))
    const defaultModel = enabledTextModels.some((model) => model.id === values.defaultModel) ? values.defaultModel : ''
    return <div className="settings-fields">
        <div className="settings-section-intro">Text input models from your providers, combined. Image and other multimodal input are not supported yet.</div>
        {models.length === 0 ? <div className="settings-empty-state"><p>No models yet</p><span>Add a provider in Providers, then select Fetch Models.</span></div> : <>
            <p className="settings-list-summary">{models.filter((model) => model.enabled).length} of {models.length} models enabled</p>
            <div className="model-list" aria-label="Models">
                {models.map((model) => <div key={model.id} className="model-setting-row">
                    <Checkbox id={`model-${model.id}`} checked={model.enabled} disabled={!isTextModel(model.id)} aria-label={`Enable ${model.id}`}
                        onCheckedChange={(checked) => update('modelPreferences', {...values.modelPreferences, [model.id]: {providerId: model.providerId, enabled: checked === true}})} />
                    <label htmlFor={`model-${model.id}`} className={`model-name${isTextModel(model.id) ? '' : ' is-unsupported'}`} title={isTextModel(model.id) ? undefined : 'This model does not support text input'}>{model.id}</label>
                    <Select value={model.providerId} disabled={!isTextModel(model.id)} items={model.providers.map((provider) => ({value: provider.id, label: provider.name}))}
                        onValueChange={(providerId) => providerId && update('modelPreferences', {...values.modelPreferences, [model.id]: {providerId, enabled: model.enabled}})}>
                        <SelectTrigger className="settings-select model-provider-select" aria-label={`Provider for ${model.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent><SelectGroup>{model.providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                </div>)}
            </div>
        </>}
        <div className="settings-row">
            <div className="settings-row-copy">
                <span className="settings-row-label">Default model</span>
                <span className="settings-row-help">Used for new chats when no chat-specific model has been selected.</span>
            </div>
            <Select value={defaultModel} disabled={!enabledTextModels.length} onValueChange={(value) => value && update('defaultModel', value)}>
                <SelectTrigger className="settings-select" aria-label="Default model"><SelectValue placeholder={enabledTextModels.length ? 'Choose a model' : 'No enabled models'} /></SelectTrigger>
                <SelectContent><SelectGroup>{enabledTextModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.id}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
        </div>
        <div className="settings-row">
            <div className="settings-row-copy">
                <span className="settings-row-label">Context window</span>
                <span className="settings-row-help">Maximum conversation context sent to the model.</span>
            </div>
            <Select value={String(values.contextWindow)} onValueChange={(value) => value && update('contextWindow', Number(value) as typeof values.contextWindow)}>
                <SelectTrigger className="settings-select" aria-label="Context window"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="128000">128K</SelectItem><SelectItem value="256000">256K</SelectItem><SelectItem value="512000">512K</SelectItem></SelectContent>
            </Select>
        </div>
    </div>
}

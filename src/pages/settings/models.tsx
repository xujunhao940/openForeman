import {Checkbox} from "@/components/ui/checkbox"
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select"
import {modelsUnion} from "@/lib/provider-models"
import type {SettingsPageProps} from "@/pages/settings.tsx"

export default function ModelsSettings({values, update}: SettingsPageProps) {
    const models = modelsUnion(values.providers, values.modelPreferences)
    return <div className="settings-fields">
        <div className="settings-section-intro">All models from your providers, combined. Choose a provider and enable the models you want to use.</div>
        {models.length === 0 ? <div className="settings-empty-state"><p>No models yet</p><span>Add a provider in Providers, then select Fetch Models.</span></div> : <>
            <p className="settings-list-summary">{models.filter((model) => model.enabled).length} of {models.length} models enabled</p>
            <div className="model-list" aria-label="Models">
                {models.map((model) => <div key={model.id} className="model-setting-row">
                    <Checkbox id={`model-${model.id}`} checked={model.enabled} aria-label={`Enable ${model.id}`}
                        onCheckedChange={(checked) => update('modelPreferences', {...values.modelPreferences, [model.id]: {providerId: model.providerId, enabled: checked === true}})} />
                    <label htmlFor={`model-${model.id}`} className="model-name">{model.id}</label>
                    <Select value={model.providerId} items={model.providers.map((provider) => ({value: provider.id, label: provider.name}))}
                        onValueChange={(providerId) => providerId && update('modelPreferences', {...values.modelPreferences, [model.id]: {providerId, enabled: model.enabled}})}>
                        <SelectTrigger className="settings-select model-provider-select" aria-label={`Provider for ${model.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent><SelectGroup>{model.providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                </div>)}
            </div>
        </>}
        <div className="settings-row settings-checkbox-row">
            <span className="settings-row-copy"><span className="settings-row-label">Automatic model routing</span><span className="settings-row-help">Select a capable, cost-efficient model for each task.</span></span>
            <Checkbox id="settings-routing" checked={values.routingEnabled} onCheckedChange={(checked) => update('routingEnabled', checked === true)} />
        </div>
    </div>
}

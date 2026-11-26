import {Checkbox} from "@/components/ui/checkbox"
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select"
import {isTextModel, modelsUnion} from "@/lib/provider-models"
import type {SettingsPageProps} from "@/pages/settings.tsx"

export default function IntraTurnSettings({values, update}: SettingsPageProps) {
    const models = modelsUnion(values.providers, values.modelPreferences).filter(model => model.enabled && isTextModel(model.id))
    const selectedModel = models.some(model => model.id === values.intraTurnModelId) ? values.intraTurnModelId : ''

    return <div className="settings-fields">
        <p className="settings-section-intro">Feedforward finds details in your draft that can be specified with a quick control. Select a model to recognize these details.</p>
        <div className="settings-row settings-checkbox-row">
            <div className="settings-row-copy">
                <label htmlFor="intra-turn-enabled">Enable Feedforward</label>
                <p>{models.length ? 'Underline configurable phrases as you write and add details with a popup.' : 'Enable a text model in Models to use Feedforward.'}</p>
            </div>
            <Checkbox id="intra-turn-enabled" checked={values.intraTurnEnabled} disabled={!models.length && !values.intraTurnEnabled} onCheckedChange={checked => update('intraTurnEnabled', checked === true)} />
        </div>
        <div className="settings-row">
            <div className="settings-row-copy">
                <span className="settings-row-label">Recognition model</span>
                <span className="settings-row-help">Used to find phrases and generate their input controls.</span>
            </div>
            <Select value={selectedModel} disabled={!models.length} onValueChange={value => value && update('intraTurnModelId', value)}>
                <SelectTrigger className="settings-select" aria-label="Feedforward recognition model">
                    <SelectValue placeholder={models.length ? 'Choose a model' : 'No enabled models'} />
                </SelectTrigger>
                <SelectContent><SelectGroup>{models.map(model => <SelectItem key={model.id} value={model.id}>{model.id}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
        </div>
    </div>
}

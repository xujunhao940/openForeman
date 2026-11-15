import {Checkbox} from "@/components/ui/checkbox"
import {Input} from "@/components/ui/input"
import {Label} from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import type {SettingsPageProps} from "@/pages/settings.tsx"

export default function GeneralSettings({values, update}: SettingsPageProps) {
    return <div className="settings-fields">
        <div className="settings-row">
            <div className="settings-row-copy">
                <Label htmlFor="settings-language">Language</Label>
                <p>Choose the language used in Foreman.</p>
            </div>
            <Select value={values.language} onValueChange={(value) => value && update("language", value)}>
                <SelectTrigger id="settings-language" className="settings-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="zh-CN">简体中文</SelectItem>
                </SelectContent>
            </Select>
        </div>
        <div className="settings-row">
            <div className="settings-row-copy">
                <Label htmlFor="settings-directory">Default project folder</Label>
                <p>Starting location when adding a project.</p>
            </div>
            <Input id="settings-directory" value={values.defaultDirectory} onChange={(event) => update("defaultDirectory", event.target.value)} placeholder="/Users/you/Code" className="settings-input" />
        </div>
        <label className="settings-row settings-checkbox-row" htmlFor="settings-launch">
            <span className="settings-row-copy">
                <span className="settings-row-label">Launch at login</span>
                <span className="settings-row-help">Open Foreman when you sign in.</span>
            </span>
            <Checkbox id="settings-launch" checked={values.launchAtLogin} onCheckedChange={(checked) => update("launchAtLogin", checked === true)} />
        </label>
    </div>
}

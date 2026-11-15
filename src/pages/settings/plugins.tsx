import {useState} from "react"
import {Plus, Puzzle, TrashBin as Trash2} from "@gravity-ui/icons"
import {Button} from "@/components/ui/button"
import {Checkbox} from "@/components/ui/checkbox"
import {Input} from "@/components/ui/input"
import {Label} from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"

type PluginRecord = {
    id: string
    name: string
    packageId: string
    enabled: boolean
}

const STORAGE_KEY = "foreman_plugins"

function readPlugins(): PluginRecord[] {
    try {
        const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as PluginRecord[]
        return Array.isArray(saved) ? saved : []
    } catch {
        return []
    }
}

export default function PluginsSettings() {
    const [plugins, setPlugins] = useState(readPlugins)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [name, setName] = useState("")
    const [packageId, setPackageId] = useState("")

    function savePlugins(nextPlugins: PluginRecord[]) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPlugins))
        setPlugins(nextPlugins)
    }

    function addPlugin(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const nextName = name.trim()
        const nextPackageId = packageId.trim()
        if (!nextName || !nextPackageId) return

        savePlugins([...plugins, {id: crypto.randomUUID(), name: nextName, packageId: nextPackageId, enabled: true}])
        setName("")
        setPackageId("")
        setDialogOpen(false)
    }

    return <div className="settings-fields plugins-settings">
        <header className="plugins-header">
            <p className="settings-section-intro">Manage plugin registrations for this workspace.</p>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger render={<Button type="button" className="plugins-add-button"><Plus aria-hidden="true" /> Add plugin</Button>} />
                <DialogContent>
                    <form onSubmit={addPlugin}>
                        <DialogHeader>
                            <DialogTitle>Add plugin</DialogTitle>
                            <DialogDescription>Register a plugin by its display name and package ID.</DialogDescription>
                        </DialogHeader>
                        <div className="plugins-form-fields">
                            <div className="project-field">
                                <Label htmlFor="plugin-name">Plugin name</Label>
                                <Input id="plugin-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="My plugin" required />
                            </div>
                            <div className="project-field">
                                <Label htmlFor="plugin-package-id">Package ID</Label>
                                <Input id="plugin-package-id" value={packageId} onChange={(event) => setPackageId(event.target.value)} placeholder="@scope/plugin-name" required />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="submit">Add plugin</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </header>
        <p className="plugins-runtime-note">Plugin code is not loaded yet. These entries are stored locally.</p>

        {plugins.length === 0 ? (
            <div className="plugins-empty-state">
                <Puzzle aria-hidden="true" />
                <p>No plugins registered</p>
            </div>
        ) : (
            <ul className="plugins-list">
                {plugins.map((plugin) => (
                    <li className="plugins-item" key={plugin.id}>
                        <span className="plugins-item-icon"><Puzzle aria-hidden="true" /></span>
                        <span className="plugins-item-copy">
                            <span className="plugins-item-name">{plugin.name}</span>
                            <span className="plugins-item-id">{plugin.packageId}</span>
                        </span>
                        <Checkbox
                            checked={plugin.enabled}
                            aria-label={`Enable ${plugin.name}`}
                            onCheckedChange={(checked) => savePlugins(plugins.map((item) => item.id === plugin.id ? {...item, enabled: checked === true} : item))}
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${plugin.name}`}
                            onClick={() => savePlugins(plugins.filter((item) => item.id !== plugin.id))}
                        >
                            <Trash2 aria-hidden="true" />
                        </Button>
                    </li>
                ))}
            </ul>
        )}
    </div>
}

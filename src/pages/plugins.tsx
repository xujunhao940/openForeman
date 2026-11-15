import PluginsSettings from "@/pages/settings/plugins.tsx"
import "@/pages/settings.css"

export default function Plugins() {
    return (
        <div className="settings-page plugins-page">
            <section className="settings-detail" aria-labelledby="plugins-title">
                <div className="settings-detail-inner">
                    <header className="settings-detail-header">
                        <h1 id="plugins-title">Plugins</h1>
                    </header>
                    <PluginsSettings />
                </div>
            </section>
        </div>
    )
}

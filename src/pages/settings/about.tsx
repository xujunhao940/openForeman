import {useState, type MouseEvent} from "react"
import {ArrowUpRightFromSquare, ChevronRight} from "@gravity-ui/icons"
import {description, homepage, version} from "../../../package.json"
import appIcon from "../../../icons/Foreman.png"
import {Button} from "@/components/ui/button"

type LicenseCatalog = typeof import("virtual:open-source-licenses")

export default function AboutSettings() {
    const [catalog, setCatalog] = useState<LicenseCatalog>()
    const [licenseError, setLicenseError] = useState(false)
    const [homepageError, setHomepageError] = useState(false)
    const [noticeError, setNoticeError] = useState(false)
    const [query, setQuery] = useState("")

    async function loadLicenses() {
        setLicenseError(false)
        try {
            setCatalog(await import("virtual:open-source-licenses"))
        } catch {
            setLicenseError(true)
        }
    }

    async function openHomepage(event: MouseEvent<HTMLAnchorElement>) {
        if (!window.ipcRenderer) return
        event.preventDefault()
        setHomepageError(false)
        try {
            await window.ipcRenderer.invoke("app:open-homepage")
        } catch {
            setHomepageError(true)
        }
    }

    async function saveChromiumNotices(event: MouseEvent<HTMLAnchorElement>) {
        if (!window.ipcRenderer) return
        event.preventDefault()
        setNoticeError(false)
        try {
            await window.ipcRenderer.invoke("app:save-chromium-notices")
        } catch {
            setNoticeError(true)
        }
    }

    const search = query.trim().toLowerCase()
    const licenses = catalog?.licenses.filter(({name, license}) =>
        name.toLowerCase().includes(search) || license?.toLowerCase().includes(search))

    return (
        <>
            <div className="settings-about-app">
                <img src={appIcon} width={60} height={60} alt="" />
                <div className="settings-row-copy">
                    <h2>Foreman</h2>
                    <p>Version {version}</p>
                    <p>{description}</p>
                    <a className="settings-about-link" href={homepage} target="_blank" rel="noreferrer" onClick={openHomepage}>
                        GitHub <ArrowUpRightFromSquare aria-hidden="true" />
                    </a>
                    {homepageError && <p role="alert">Could not open the GitHub repository.</p>}
                </div>
            </div>

            <details className="settings-about-licenses" onToggle={event => {
                if (event.currentTarget.open && !catalog && !licenseError) void loadLicenses()
            }}>
                <summary className="settings-about-summary">
                    <ChevronRight aria-hidden="true" />
                    <strong>Open source licenses</strong>
                </summary>
                {licenseError ? (
                    <div className="settings-about-license-content">
                        <p role="alert">Could not load the license list.</p>
                        <Button variant="outline" size="sm" onClick={loadLicenses}>Try again</Button>
                    </div>
                ) : !licenses ? (
                    <p className="settings-section-intro" role="status">Loading licenses…</p>
                ) : (
                    <div className="settings-about-license-content">
                        {catalog.chromiumNotices && (
                            <a href={catalog.chromiumNotices} className="settings-about-link" download="LICENSES.chromium.html" onClick={saveChromiumNotices}>
                                Download Chromium license notices
                            </a>
                        )}
                        {noticeError && <p role="alert">Could not save the Chromium license notices.</p>}
                        <input
                            aria-label="Search licenses"
                            className="settings-about-search"
                            type="search"
                            placeholder="Search by package or license"
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                        />
                        {licenses.length === 0 && <p role="status">No matching licenses.</p>}
                        {licenses.map(({name, version, license, notices}) => (
                            <details key={`${name}@${version}`} className="settings-about-license">
                                <summary className="settings-about-summary">
                                    <ChevronRight aria-hidden="true" />
                                    <span>{name}</span>
                                    <span className="settings-about-license-meta">{version} · {license ?? "See notices"}</span>
                                </summary>
                                {notices.length ? notices.map(({file, text}) => (
                                    <pre key={file} aria-label={file} tabIndex={0}>{text}</pre>
                                )) : (
                                    <p className="settings-row-help">
                                        {license ? `Declared license: ${license}` : "No license information provided by the package."}
                                    </p>
                                )}
                            </details>
                        ))}
                    </div>
                )}
            </details>
        </>
    )
}

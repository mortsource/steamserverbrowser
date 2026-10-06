import { constSysfsExpr } from '@steambrew/client';
import { logToConsole, updatePluginData, loadLocalBlocklist, removeFromLocalBlocklist } from '../shared';
import { escapeHtml, onDocumentReady, debounce, injectStyle } from './ui_shared';
import { listAlerts, getAlert, removeAlert, describeTriggers, editAlert, onAlertsChanged } from './alert';

// #region CONFIGURATION
const DEFAULT_MAP_TILE_PROVIDER = 'arcgis';

export const DEFAULTS: Record<string, any> = {
    filter_remote_blocklist: true,
    filter_personal_blocklist: true,
    filter_player_spoof: true,
    filter_unusual_port: false,
    filter_cyrillic: true,
    filter_chinese: false,
    filter_emoji: false,
    map_tile_provider: DEFAULT_MAP_TILE_PROVIDER,
    cartocdn_api_key: ''
};

const FILTERS: Array<{ key: string; label: string; description: string }> = [
    { key: 'filter_remote_blocklist', label: 'Remote Blocklist', description: "Block servers/hostnames from the maintained blocklist" },
    { key: 'filter_personal_blocklist', label: 'Personal Blocklist', description: 'Block servers/hostnames added to your personal blocklist' },
    { key: 'filter_player_spoof', label: 'Player Spoof', description: 'Block servers with more than 64 players' },
    { key: 'filter_unusual_port', label: 'Unusual Port', description: 'Block servers outside the 26000-30000 port range' },
    { key: 'filter_cyrillic', label: 'Cyrillic Hostname', description: 'Block servers with Cyrillic characters in the hostname' },
    { key: 'filter_chinese', label: 'Chinese Hostname', description: 'Block servers with Chinese characters in the hostname' },
    { key: 'filter_emoji', label: 'Emoji Hostname', description: 'Block servers with emoji in the hostname' }
];

const MAP_TILE_PROVIDERS: Record<string, { label: string; url: string; attribution: string; maxZoom: number; needsApiKey: boolean }> = {
    arcgis: {
        label: 'ArcGIS',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        attribution: '&copy; Esri &copy; HERE &copy; Garmin &copy; OpenStreetMap contributors',
        maxZoom: 19,
        needsApiKey: false,
    },
    cartocdn: {
        label: 'CartoDB',
        url: 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        maxZoom: 19,
        needsApiKey: true,
    },
};

export const CONFIG_KEY = 'sbplus_config';

const loadSettings = () => {
    try {
        const stored = localStorage.getItem(CONFIG_KEY);
        return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : { ...DEFAULTS };
    } catch {
        return { ...DEFAULTS };
    }
};

const saveSettings = (settings: any): void => {
    try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(settings));
    } catch (e) {
        logToConsole('SYSTEM', `Failed to save settings: ${e}`, 'Error');
    }
};
// #endregion



// #region ASSETS
const ICON_GEAR = constSysfsExpr('gear-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content;
const ICON_GITHUB = constSysfsExpr('mark-github-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content;
const ICON_KOFI = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 12 12" fill="none"><path d="M2 6.2l2.6 2.6L10 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ROW_EXTRAS: Record<string, string> = {
    filter_remote_blocklist: `
        <span class="sbplus-settings-row-extra">
            <button type="button" class="sbplus-settings-row-action" id="sbplus-remote-update">Update</button>
        </span>`,
};

const SETTINGS_CSS = constSysfsExpr('settings.css', { encoding: 'utf8' }).content;
const SETTINGS_BTN_CSS = `
    .sbplus-settings-btn svg { width: 16px; height: 16px; display: block; transform: none !important; }
    .sbplus-settings-btn svg path { fill: currentColor; }
`;
// #endregion



// #region MAP TILES
const mapTileListeners = new Set<() => void>();

export function onMapTileConfigChanged(cb: () => void): void {
    mapTileListeners.add(cb);
}

function notifyMapTileConfigChanged(): void {
    mapTileListeners.forEach((cb) => cb());
}

const activeProviderKey = (settings: any): string =>
    MAP_TILE_PROVIDERS[settings.map_tile_provider] ? settings.map_tile_provider : DEFAULT_MAP_TILE_PROVIDER;

export function getMapTileConfig(): { url: string; attribution: string; maxZoom: number } {
    const settings = loadSettings();
    const provider = MAP_TILE_PROVIDERS[activeProviderKey(settings)];

    let url = provider.url;
    if (provider.needsApiKey && settings.cartocdn_api_key) {
        url += `?key=${encodeURIComponent(settings.cartocdn_api_key)}`;
    }

    return { url, attribution: provider.attribution, maxZoom: provider.maxZoom };
}

function MapTilesSection(settings: any): string {
    const provider = activeProviderKey(settings);
    return `
        <div class="sbplus-settings-section">
            <div class="sbplus-settings-header">Map Tiles</div>
            <div role="radiogroup" aria-label="Tile provider">
                ${Object.entries(MAP_TILE_PROVIDERS).map(([key, p]) => `
                    <div class="sbplus-settings-row" title="${escapeHtml(p.label)}">
                        <span class="sbplus-settings-row-label">${escapeHtml(p.label)}</span>
                        ${p.needsApiKey ? `<input type="text" class="sbplus-settings-row-input" id="sbplus-map-apikey" placeholder="Paste your CARTO API key" value="${escapeHtml(settings.cartocdn_api_key ?? '')}">` : ''}
                        <button type="button" class="sbplus-settings-toggle${key === provider ? ' on' : ''}" role="radio" aria-checked="${key === provider}" aria-label="${escapeHtml(p.label)}" data-provider="${key}">${ICON_CHECK}</button>
                    </div>`).join('')}
            </div>
        </div>`;
}
// #endregion



// #region LOCAL BLOCKLIST
function renderBlocklistRows(): string {
    const entries = loadLocalBlocklist();
    if (!entries.length) return `<div class="sbplus-settings-blocklist-empty">No entries yet — right-click a server to block its IP or subnet.</div>`;
    return entries.map((entry) => `
        <div class="sbplus-settings-blocklist-row" data-entry="${escapeHtml(entry)}">
            <span class="sbplus-settings-blocklist-value">${escapeHtml(entry)}</span>
            <button type="button" class="sbplus-settings-blocklist-remove" title="Remove" aria-label="Remove ${escapeHtml(entry)}">✕</button>
        </div>`).join('');
}
// #endregion



// #region ALERTS
function timeAgo(ms: number): string {
    const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function renderAlertRows(): string {
    const alerts = listAlerts();
    if (!alerts.length) return `<div class="sbplus-settings-blocklist-empty">No alerts yet — right-click a server to set one.</div>`;
    return alerts.map((a) => `
        <div class="sbplus-settings-blocklist-row sbplus-settings-alert-row${a.disabled ? ' disabled' : ''}" data-key="${escapeHtml(a.key)}" title="Click to edit">
            <span class="sbplus-settings-alert-main">
                <span class="sbplus-settings-alert-name">${escapeHtml(a.name)}</span>
                <span class="sbplus-settings-alert-meta">${escapeHtml(describeTriggers(a) || 'No triggers')}</span>
                <span class="sbplus-settings-alert-fired">${a.disabled ? 'Disabled · ' : ''}${a.firedAt ? `Fired ${timeAgo(a.firedAt)}: ${escapeHtml(a.firedReason ?? '')}` : 'Not fired yet'}</span>
            </span>
            <button type="button" class="sbplus-settings-blocklist-remove" title="Remove" aria-label="Remove alert for ${escapeHtml(a.name)}">✕</button>
        </div>`).join('');
}

onAlertsChanged(() => {
    const list = modalEl?.querySelector<HTMLElement>('#sbplus-alerts-list');
    if (list) list.innerHTML = renderAlertRows();
});
// #endregion



// #region MODAL
let modalEl: HTMLElement | null = null;
let modalDoc: Document | null = null;
// let settingsBtnLoggedMissing = false;
const escapeHookedDocs = new WeakSet<Document>();

function ToggleSwitch(key: string, label: string, description: string, checked: boolean): string {
    return `
        <div class="sbplus-settings-row" title="${escapeHtml(description)}">
            <span class="sbplus-settings-row-label">${escapeHtml(label)}</span>
            ${ROW_EXTRAS[key] ?? ''}
            <button type="button" class="sbplus-settings-toggle${checked ? ' on' : ''}" role="switch" aria-checked="${checked}" aria-label="${escapeHtml(label)}" data-key="${key}">${ICON_CHECK}</button>
        </div>`;
}

function buildModal(doc: Document): HTMLElement {
    injectStyle(doc, 'sbplus-settings-modal-style', SETTINGS_CSS);

    let settings = loadSettings();
    const update = (key: string, value: any) => {
        settings = { ...settings, [key]: value };
        saveSettings(settings);
    };

    const overlay = doc.createElement('div');
    overlay.className = 'sbplus-settings-overlay';
    overlay.id = 'sbplus-settings-overlay';
    overlay.innerHTML = `
        <div class="sbplus-settings-panel">
            <div class="sbplus-settings-head">
                <span class="sbplus-settings-title">ServerBrowserPlus Settings</span>
                <div class="sbplus-settings-head-links">
                    <a class="sbplus-settings-link" href="https://github.com/mortsource" target="_blank" rel="noopener noreferrer" title="GitHub">${ICON_GITHUB}</a>
                    <a class="sbplus-settings-link kofi" href="https://ko-fi.com/mortsource" target="_blank" rel="noopener noreferrer" title="Support on Ko-fi">${ICON_KOFI}</a>
                </div>
                <button type="button" class="sbplus-settings-close" title="Close">✕</button>
            </div>
            <div class="sbplus-settings-body">
                <div class="sbplus-settings-col sbplus-settings-col-toggles">
                    <div class="sbplus-settings-section">
                        <div class="sbplus-settings-header">Spam Filters</div>
                        <div class="sbplus-settings-list">
                            ${FILTERS.map((f) => ToggleSwitch(f.key, f.label, f.description, settings[f.key] as boolean)).join('')}
                        </div>
                    </div>
                    ${MapTilesSection(settings)}
                </div>
                <div class="sbplus-settings-col sbplus-settings-col-list">
                    <div class="sbplus-settings-section sbplus-settings-section-fill">
                        <div class="sbplus-settings-header">Personal Blocklist</div>
                        <div class="sbplus-settings-blocklist" id="sbplus-blocklist-list">${renderBlocklistRows()}</div>
                    </div>
                </div>
                <div class="sbplus-settings-col sbplus-settings-col-list">
                    <div class="sbplus-settings-section sbplus-settings-section-fill">
                        <div class="sbplus-settings-header">Server Alerts</div>
                        <div class="sbplus-settings-blocklist" id="sbplus-alerts-list">${renderAlertRows()}</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const q = <T extends Element>(sel: string) => overlay.querySelector(sel) as T;
    q<HTMLElement>('.sbplus-settings-panel').addEventListener('click', (e) => e.stopPropagation());
    q<HTMLElement>('.sbplus-settings-close').addEventListener('click', () => closeSettingsModal());

    overlay.addEventListener('click', () => closeSettingsModal());

    overlay.querySelectorAll<HTMLElement>('.sbplus-settings-row').forEach((row) => {
        const sw = row.querySelector<HTMLButtonElement>('.sbplus-settings-toggle');
        const key = sw?.dataset.key as string | undefined;
        if (!sw || !key) return;
        row.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.sbplus-settings-row-extra')) return;
            const next = !sw.classList.contains('on');
            sw.classList.toggle('on', next);
            sw.setAttribute('aria-checked', String(next));
            update(key, next);
        });
    });

    const mapApiKeyInput = q<HTMLInputElement>('#sbplus-map-apikey');
    const providerToggles = Array.from(overlay.querySelectorAll<HTMLButtonElement>('[data-provider]'));

    const selectProvider = (key: string) => {
        if (!MAP_TILE_PROVIDERS[key] || settings.map_tile_provider === key) return;
        update('map_tile_provider', key);
        providerToggles.forEach((toggle) => {
            const on = toggle.dataset.provider === key;
            toggle.classList.toggle('on', on);
            toggle.setAttribute('aria-checked', String(on));
        });
        notifyMapTileConfigChanged();
    };

    providerToggles.forEach((toggle) => {
        toggle.closest('.sbplus-settings-row')
            ?.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).closest('.sbplus-settings-row-input')) return;
                selectProvider(toggle.dataset.provider as string);
            });
    });
    const scheduleMapTileConfigChanged = debounce(notifyMapTileConfigChanged, 400);
    mapApiKeyInput.addEventListener('input', () => {
        update('cartocdn_api_key', mapApiKeyInput.value.trim());
        scheduleMapTileConfigChanged();
    });

    const blocklistEl = q<HTMLElement>('#sbplus-blocklist-list');
    blocklistEl.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.sbplus-settings-blocklist-remove') as HTMLButtonElement | null;
        if (!btn) return;
        const entry = (btn.closest('.sbplus-settings-blocklist-row') as HTMLElement | null)?.dataset.entry;
        if (!entry) return;
        removeFromLocalBlocklist(entry);
        blocklistEl.innerHTML = renderBlocklistRows();
    });

    const alertsEl = q<HTMLElement>('#sbplus-alerts-list');
    alertsEl.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const row = target.closest('.sbplus-settings-alert-row') as HTMLElement | null;
        const alert = getAlert(row?.dataset.key ?? '');
        if (!alert) return;
        if (target.closest('.sbplus-settings-blocklist-remove')) removeAlert(alert.key);
        else editAlert(doc, alert);
    });

    const remoteUpdateBtn = q<HTMLButtonElement>('#sbplus-remote-update');
    remoteUpdateBtn.addEventListener('click', async () => {
        remoteUpdateBtn.disabled = true;
        remoteUpdateBtn.textContent = 'Updating…';
        const result = await updatePluginData();
        remoteUpdateBtn.disabled = false;
        remoteUpdateBtn.textContent = result;
        setTimeout(() => {
            remoteUpdateBtn.textContent = 'Update';
        }, 2000);
    });

    return overlay;
}

function openSettingsModal(doc: Document): void {
    if (!modalEl || !modalEl.isConnected || modalDoc !== doc) {
        modalEl = buildModal(doc);
        modalDoc = doc;
        (doc.body ?? doc.documentElement).appendChild(modalEl);
    }

    if (!escapeHookedDocs.has(doc)) {
        escapeHookedDocs.add(doc);
        doc.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape' && modalEl?.classList.contains('open')) closeSettingsModal();
        });
    }

    const blocklistEl = modalEl.querySelector<HTMLElement>('#sbplus-blocklist-list');
    if (blocklistEl) blocklistEl.innerHTML = renderBlocklistRows();
    const alertsEl = modalEl.querySelector<HTMLElement>('#sbplus-alerts-list');
    if (alertsEl) alertsEl.innerHTML = renderAlertRows();

    modalEl.classList.add('open');
}

function closeSettingsModal(): void {
    modalEl?.classList.remove('open');
}

export function SettingsModal(doc: Document): void {
    injectStyle(doc, 'sbplus-settings-btn-style', SETTINGS_BTN_CSS);

    const tryInsert = () => {
        if (doc.getElementById('sbplus-settings-btn')) return;

        const group = doc.getElementById('sbplus-viewtoggle-group');
        if (!group) {
            // if (!settingsBtnLoggedMissing) {
            //     settingsBtnLoggedMissing = true;
            //     logToConsole('SYSTEM', 'Settings button: still waiting on -> #sbplus-viewtoggle-group', 'Warn');
            // }
            return;
        }

        const refBtn = group.querySelector<HTMLElement>('.sbplus-viewtoggle-btn');
        const refClasses = refBtn?.className.split(/\s+/).filter((c) => c && c !== 'active').join(' ') ?? '';

        const btn = doc.createElement('button');
        btn.id = 'sbplus-settings-btn';
        btn.type = 'button';
        btn.className = `${refClasses} sbplus-settings-btn`.trim();
        btn.title = 'ServerBrowserPlus Settings';
        btn.setAttribute('aria-label', 'ServerBrowserPlus Settings');
        btn.innerHTML = ICON_GEAR;
        btn.addEventListener('click', () => openSettingsModal(doc));

        group.appendChild(btn);
    };

    onDocumentReady(doc, tryInsert);
}
// #endregion
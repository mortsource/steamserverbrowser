import { constSysfsExpr } from '@steambrew/client';
import { logToConsole, updatePluginData } from '../shared';
import { escapeHtml, notifyMapTileConfigChanged, onDocumentReady, debounce } from './ui_shared';

// CONFIGURATION ————————————————————————————————————————
const FILTERS: Array<{ key: string; label: string; description: string }> = [
    { key: 'filter_blocklist', label: 'Blocklist', description: "Block servers/hostnames from the maintained blocklist" },
    { key: 'filter_player_spoof', label: 'Player Spoof', description: 'Block servers reporting more than 64 players/slots (engine limit)' },
    { key: 'filter_port_range', label: 'Port Range', description: 'Block servers outside the 27000-27999 range used by real CS dedicated servers' },
    { key: 'filter_cyrillic', label: 'Cyrillic', description: 'Block servers with Cyrillic characters in the name' },
    { key: 'filter_emoji', label: 'Emoji', description: 'Block servers with emoji in the name' }
];

export const CONFIG_KEY = 'sbplus_config';

export const MAP_TILE_PROVIDERS: Record<string, { label: string; url: string; attribution: string; maxZoom: number; needsApiKey: boolean }> = {
    arcgis: {
        label: 'ArcGIS',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        attribution: '&copy; Esri &copy; HERE &copy; Garmin &copy; OpenStreetMap contributors',
        maxZoom: 19,
        needsApiKey: false,
    },
    cartocdn: {
        label: 'CartoDB (requires API key)',
        url: 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        maxZoom: 19,
        needsApiKey: true,
    },
};
const DEFAULT_MAP_TILE_PROVIDER = 'arcgis';

const DEFAULTS = {
    filter_blocklist: true,
    filter_player_spoof: true,
    filter_port_range: true,
    filter_cyrillic: true,
    filter_emoji: false, // let user decide
    map_tile_provider: DEFAULT_MAP_TILE_PROVIDER,
    cartocdn_api_key: ''
};

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
        logToConsole(`Failed to save settings: ${e}`, 'Error');
    }
};

export function getMapTileConfig(): { url: string; attribution: string; maxZoom: number } {
    const settings = loadSettings();
    const providerKey = MAP_TILE_PROVIDERS[settings.map_tile_provider] ? settings.map_tile_provider : DEFAULT_MAP_TILE_PROVIDER;
    const provider = MAP_TILE_PROVIDERS[providerKey];

    let url = provider.url;
    if (provider.needsApiKey && settings.cartocdn_api_key) {
        url += `?key=${encodeURIComponent(settings.cartocdn_api_key)}`;
    }

    return { url, attribution: provider.attribution, maxZoom: provider.maxZoom };
}



// BUTTON ————————————————————————————————————————
const ICON_GEAR = constSysfsExpr('gear-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content;

function ensureButtonStyles(doc: Document): void {
    if (doc.getElementById('sbplus-settingsbtn-style')) return;
    const s = doc.createElement('style');
    s.id = 'sbplus-settingsbtn-style';
    s.textContent = `
        .sbplus-settings-btn svg { width: 16px; height: 16px; display: block; transform: none !important; }
        .sbplus-settings-btn svg path { fill: currentColor; }
    `;
    doc.head.appendChild(s);
}



// MODAL ————————————————————————————————————————
const ICON_GITHUB = constSysfsExpr('mark-github-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content;
const ICON_KOFI = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 12 12" fill="none"><path d="M2 6.2l2.6 2.6L10 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ROW_EXTRAS: Record<string, string> = {
    filter_blocklist: `
        <span class="sbplus-settings-row-extra">
            <span class="sbplus-settings-row-status" id="sbplus-remote-status"></span>
            <button type="button" class="sbplus-settings-row-action" id="sbplus-remote-update">Update</button>
        </span>`,
};

let modalEl: HTMLElement | null = null;
let modalDoc: Document | null = null;
let settingsBtnLoggedMissing = false;

function ensureModalStyles(doc: Document): void {
    if (doc.getElementById('sbplus-settingsmodal-style')) return;
    const s = doc.createElement('style');
    s.id = 'sbplus-settingsmodal-style';
    s.textContent = `
        .sbplus-settings-overlay {
            --border: rgba(255,255,255,0.10);
            --border-soft: rgba(255,255,255,0.07);
            --text: #e8e8e8;
            --text-dim: rgba(255,255,255,0.45);
            --text-faint: rgba(255,255,255,0.35);
            --transition-ui: 120ms ease;
            position: fixed; inset: 0; z-index: 1000;
            background: rgba(0,0,0,0.6);
            display: none; align-items: center; justify-content: center;
        }
        .sbplus-settings-overlay.open { display: flex; }
        .sbplus-settings-panel {
            width: 740px; max-width: 95vw; max-height: 90vh;
            background: #161616; border: 1px solid var(--border);
            border-radius: 8px; box-shadow: 0 12px 40px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; overflow: hidden;
        }
        .sbplus-settings-head {
            display: flex; align-items: center; justify-content: space-between;
            padding: 14px 20px; border-bottom: 1px solid var(--border-soft);
            flex-shrink: 0;
        }
        .sbplus-settings-title { font-size: 14px; font-weight: 600; color: var(--text); flex: 1 1 auto; }
        .sbplus-settings-head-links { display: flex; align-items: center; gap: 12px; margin-right: 12px; }
        .sbplus-settings-link {
            display: inline-flex; align-items: center; justify-content: center;
            width: 18px; height: 18px; color: var(--text-dim);
        }
        .sbplus-settings-link svg { width: 16px; height: 16px; display: block; fill: currentColor; }
        .sbplus-settings-close {
            width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
            color: var(--text-dim); border: none; background: transparent; cursor: pointer; font-size: 16px; line-height: 1;
        }
        .sbplus-settings-link:hover, .sbplus-settings-close:hover { color: #fff; }

        .sbplus-settings-body {
            display: grid; grid-template-columns: 240px 1fr; gap: 24px;
            padding: 18px 20px 20px; overflow-y: auto;
        }
        .sbplus-settings-col { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
        .sbplus-settings-col-right { border-left: 1px solid var(--border-soft); padding-left: 24px; }

        .sbplus-settings-section { display: flex; flex-direction: column; gap: 2px; }
        .sbplus-settings-header {
            font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;
            color: var(--text-dim); margin-bottom: 4px;
        }
        .sbplus-settings-row, .sbplus-settings-field { padding: 10px 0; border-bottom: 1px solid var(--border-soft); }
        .sbplus-settings-row:last-child, .sbplus-settings-field:last-child { border-bottom: none; }
        .sbplus-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .sbplus-settings-row-label { font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .sbplus-settings-toggle {
            flex-shrink: 0; width: 18px; height: 18px; padding: 0; box-sizing: border-box;
            border: 1px solid rgba(255,255,255,0.3); border-radius: 3px; background: transparent;
            display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
            color: #161616; transition: background var(--transition-ui), border-color var(--transition-ui);
        }
        .sbplus-settings-toggle:hover { border-color: rgba(255,255,255,0.55); }
        .sbplus-settings-toggle svg { width: 11px; height: 11px; display: none; }
        .sbplus-settings-toggle.on { background: #e8e8e8; border-color: #e8e8e8; }
        .sbplus-settings-toggle.on svg { display: block; }

        .sbplus-settings-field { display: flex; flex-direction: column; gap: 4px; }
        .sbplus-settings-field-label { font-size: 12px; color: var(--text); }
        .sbplus-settings-field-desc { font-size: 11px; color: var(--text-faint); }
        .sbplus-settings-input {
            width: 100%; box-sizing: border-box; background: transparent; border: none;
            border-bottom: 1px solid rgba(255,255,255,0.2); border-radius: 0;
            color: var(--text); font-size: 12px; padding: 6px 0; margin-top: 2px;
        }
        .sbplus-settings-input:focus { outline: none; border-bottom-color: rgba(255,255,255,0.6); }

        .sbplus-settings-row-extra { display: flex; align-items: center; gap: 8px; margin-left: auto; }
        .sbplus-settings-row-status { font-size: 11px; color: var(--text-faint); white-space: nowrap; }
        .sbplus-settings-row-action {
            padding: 3px 10px; box-sizing: border-box; border: 1px solid rgba(255,255,255,0.28); border-radius: 4px;
            background: transparent; color: var(--text); font-size: 11px; cursor: pointer; text-align: center;
            white-space: nowrap; transition: background var(--transition-ui), border-color var(--transition-ui);
        }
        .sbplus-settings-row-action:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.45); }
        .sbplus-settings-row-action:disabled { opacity: 0.5; cursor: default; }
    `;
    doc.head.appendChild(s);
}

function ToggleSwitch(key: string, label: string, description: string, checked: boolean): string {
    return `
        <div class="sbplus-settings-row" title="${description}">
            <span class="sbplus-settings-row-label">${label}</span>
            ${ROW_EXTRAS[key] ?? ''}
            <button type="button" class="sbplus-settings-toggle${checked ? ' on' : ''}" role="switch" aria-checked="${checked}" aria-label="${label}" data-key="${key}">${ICON_CHECK}</button>
        </div>`;
}

function MapTilesSection(settings: any): string {
    const provider = MAP_TILE_PROVIDERS[settings.map_tile_provider] ? settings.map_tile_provider : DEFAULT_MAP_TILE_PROVIDER;
    return `
        <div class="sbplus-settings-section">
            <div class="sbplus-settings-header">Map Tiles</div>
            <div role="radiogroup" aria-label="Tile provider">
                ${Object.entries(MAP_TILE_PROVIDERS).map(([key, p]) => `
                    <div class="sbplus-settings-row" title="${escapeHtml(p.label)}">
                        <span class="sbplus-settings-row-label">${escapeHtml(p.label)}</span>
                        <button type="button" class="sbplus-settings-toggle${key === provider ? ' on' : ''}" role="radio" aria-checked="${key === provider}" aria-label="${escapeHtml(p.label)}" data-provider="${key}">${ICON_CHECK}</button>
                    </div>`).join('')}
            </div>
            <div class="sbplus-settings-field">
                <div class="sbplus-settings-field-label">CartoDB API Key</div>
                <input type="text" class="sbplus-settings-input" id="sbplus-map-apikey" placeholder="Paste your CARTO API key" value="${escapeHtml(settings.cartocdn_api_key ?? '')}">
            </div>
        </div>`;
}

function buildModal(doc: Document): HTMLElement {
    ensureModalStyles(doc);

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
                <div class="sbplus-settings-col sbplus-settings-col-left">
                    <div class="sbplus-settings-section">
                        <div class="sbplus-settings-header">Spam Filters</div>
                        <div class="sbplus-settings-list">
                            ${FILTERS.map((f) => ToggleSwitch(f.key, f.label, f.description, settings[f.key] as boolean)).join('')}
                        </div>
                    </div>
                </div>
                <div class="sbplus-settings-col sbplus-settings-col-right">
                    ${MapTilesSection(settings)}
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
            ?.addEventListener('click', () => selectProvider(toggle.dataset.provider as string));
    });
    const scheduleMapTileConfigChanged = debounce(notifyMapTileConfigChanged, 400);
    mapApiKeyInput.addEventListener('input', () => {
        update('cartocdn_api_key', mapApiKeyInput.value.trim());
        scheduleMapTileConfigChanged();
    });

    const remoteStatus = q<HTMLElement>('#sbplus-remote-status');
    const remoteUpdateBtn = q<HTMLButtonElement>('#sbplus-remote-update');
    remoteUpdateBtn.addEventListener('click', async () => {
        remoteUpdateBtn.disabled = true;
        remoteUpdateBtn.textContent = 'Updating…';
        const result = await updatePluginData();
        remoteStatus.textContent = result;
        remoteUpdateBtn.disabled = false;
        remoteUpdateBtn.textContent = 'Update';
    });

    return overlay;
}

function openSettingsModal(doc: Document): void {
    if (!modalEl || !modalEl.isConnected || modalDoc !== doc) {
        modalEl = buildModal(doc);
        modalDoc = doc;
        (doc.body ?? doc.documentElement).appendChild(modalEl);

        doc.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape' && modalEl?.classList.contains('open')) closeSettingsModal();
        });
    }
    modalEl.classList.add('open');
}

function closeSettingsModal(): void {
    modalEl?.classList.remove('open');
}

export function SettingsModal(doc: Document): void {
    ensureButtonStyles(doc);

    const tryInsert = () => {
        if (doc.getElementById('sbplus-settings-btn')) return;

        const group = doc.getElementById('sbplus-viewtoggle-group');
        if (!group) {
            if (!settingsBtnLoggedMissing) {
                settingsBtnLoggedMissing = true;
                logToConsole('Settings button: still waiting on -> #sbplus-viewtoggle-group', 'Warn');
            }
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
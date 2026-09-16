import { constSysfsExpr } from '@steambrew/client';

// HTML HELPERS ————————————————————————————————————————————————————————————
const readyCallbacks = new WeakMap<Document, Set<() => void>>();
const readyObservers = new WeakMap<Document, MutationObserver>();
const TAB_ORDER = ['internet', 'favorites', 'history', 'lan', 'friends'];
export const liveTabStates = new Set<any>();
export const browserState = {
    verifiedOnly: false,
    simpleViewActive: false,
    mapViewActive: false,
    enhancedViewActive: false,
    sortPlayersDescending: true,
    currentAppId: null as number | null,
};

const mapTileListeners = new Set<() => void>();

export function getActiveTabId(doc: Document): string | null {
    const buttons = Array.from(doc.querySelectorAll('.SwitchTabButton'));
    const index = buttons.findIndex((b) => b.classList.contains('Selected'));
    return index >= 0 ? (TAB_ORDER[index] ?? null) : null;
}

export function getNativeFilteredKeys(doc: Document): Set<string> | null {
    if (liveTabStates.size === 0) return null;
    const activeId = getActiveTabId(doc);
    const keys = new Set<string>();
    liveTabStates.forEach((tabState: any) => {
        if (activeId && tabState.id && tabState.id !== activeId) return;
        (tabState.filtered_servers ?? []).forEach((s: any) => keys.add(`${s.ip}:${s.port}`));
    });
    return keys;
}

export function getNativeServer(key: string): any | null {
    for (const tabState of liveTabStates) {
        for (const list of [tabState.filtered_servers, tabState.all_servers]) {
            const found = (list ?? []).find((s: any) => `${s.ip}:${s.port}` === key);
            if (found) return found;
        }
    }
    return null;
}

export function onDocumentReady(doc: Document, attempt: () => void): void {
    attempt();

    let callbacks = readyCallbacks.get(doc);
    if (!callbacks) {
        callbacks = new Set();
        readyCallbacks.set(doc, callbacks);
    }
    callbacks.add(attempt);

    if (!readyObservers.has(doc)) {
        const obs = new MutationObserver(() => {
            readyCallbacks.get(doc)?.forEach((cb) => cb());
        });
        obs.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true });
        readyObservers.set(doc, obs);
    }
}

export function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function onMapTileConfigChanged(cb: () => void): void {
    mapTileListeners.add(cb);
}
export function notifyMapTileConfigChanged(): void {
    mapTileListeners.forEach((cb) => cb());
}

// THROTTLE/DEBOUNCE ————————————————————————————————————————————————————————————
export function rafThrottle(win: Window, fn: () => void): () => void {
    let pending = false;
    return () => {
        if (pending) return;
        pending = true;
        win.requestAnimationFrame(() => {
            pending = false;
            fn();
        });
    };
}

export function debounce(fn: () => void, delayMs: number): () => void {
    let pending = false;
    return () => {
        if (pending) return;
        pending = true;
        setTimeout(() => {
            pending = false;
            fn();
        }, delayMs);
    };
}



// ELEMENT BUILDERS ————————————————————————————————————————————————————————————
const SVG_SECURE = `<svg width="13" height="14" viewBox="0 0 13 14" fill="none"><path d="M6.5 0.5 12 2.6v3.6c0 3.7-2.4 6.4-5.5 7-3.1-.6-5.5-3.3-5.5-7V2.6L6.5.5Z" fill="#aaaaaa"/><path d="M4 7l1.7 1.7L9 5.3" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
const SVG_LOCKED = `<svg width="11" height="13" viewBox="0 0 11 13" fill="none"><rect x="1" y="5.5" width="9" height="6.5" rx="1.3" fill="#e6a20d"/><path d="M2.8 5.5V3.6a2.7 2.7 0 0 1 5.4 0v1.9" stroke="#e6a20d" stroke-width="1.3" fill="none"/></svg>`;

const inlineIcon = (svg: string): string => svg
    .replace('<svg ', '<svg fill="currentColor" style="vertical-align:-2px" ')
    .replace('width="16" height="16"', 'width="12" height="12"');
const ICON_PERSON = inlineIcon(constSysfsExpr('person-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content);
const ICON_BOT = inlineIcon(constSysfsExpr('dependabot-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content);
const badThumbUrls = new Set<string>();

export function pingTier(ping: number): { bars: number; color: string } {
    if (ping <= 50) return { bars: 4, color: '#4cec0d' };
    if (ping <= 100) return { bars: 3, color: '#c3e60d' };
    if (ping <= 150) return { bars: 2, color: '#e6a20d' };
    return { bars: 1, color: '#fc3737' };
}

export function buildPingBars(ping: number): string {
    const { bars, color } = pingTier(ping);
    const heights = [4, 7, 10, 13];
    const rects = heights.map((h, i) => {
        const x = i * 5;
        const y = 13 - h;
        const fill = i < bars ? color : 'rgba(255,255,255,0.15)';
        return `<rect x="${x}" y="${y}" width="3" height="${h}" rx="0.5" fill="${fill}"></rect>`;
    }).join('');
    return `<svg width="17" height="13" viewBox="0 0 17 13" style="flex-shrink:0">${rects}</svg>`;
}

export function buildPlayerBar(players: number, maxPlayers: number, width = 70): string {
    const ratio = maxPlayers > 0 ? Math.min(1, players / maxPlayers) : 0;
    const color = ratio === 0 ? 'rgba(255,255,255,0.15)' : ratio >= 0.75 ? '#4cec0d' : ratio >= 0.4 ? '#c3e60d' : '#e6a20d';
    const filled = (ratio * width).toFixed(1);
    return `<svg width="${width}" height="6" viewBox="0 0 ${width} 6" style="flex-shrink:0">` +
        `<rect x="0" y="0" width="${width}" height="6" rx="3" fill="rgba(255,255,255,0.1)"></rect>` +
        `<rect x="0" y="0" width="${filled}" height="6" rx="3" fill="${color}"></rect>` +
        `</svg>`;
}

export function buildBadges(server: any): string {
    let badges = '';
    if (server.bSecure) badges += `<span class="sbplus-badge" title="VAC secured">${SVG_SECURE}</span>`;
    if (server.bPassword) badges += `<span class="sbplus-badge" title="Password protected">${SVG_LOCKED}</span>`;
    return badges;
}

export function playersLine(players: number, maxPlayers: number, botPlayers: number): string {
    const base = `${players}/${maxPlayers} ${ICON_PERSON}`;
    return botPlayers > 0 ? `${base} · ${botPlayers} ${ICON_BOT}` : base;
}

export function attachThumbFallback(img: HTMLImageElement): void {
    if (badThumbUrls.has(img.src)) {
        const empty = img.ownerDocument.createElement('div');
        empty.className = `${img.className} sbplus-thumb-empty`;
        img.replaceWith(empty);
        return;
    }
    img.onload = () => { img.classList.add('sbplus-thumb-loaded'); };
    img.onerror = () => {
        badThumbUrls.add(img.src);
        const empty = img.ownerDocument.createElement('div');
        empty.className = `${img.className} sbplus-thumb-empty`;
        img.replaceWith(empty);
    };
}

// Same fallback behavior as attachThumbFallback, but for elements that show
// the map art as a CSS background-image (e.g. list rows) instead of an <img>.
export function attachRowThumbFallback(el: HTMLElement, url: string): void {
    if (badThumbUrls.has(url)) {
        el.classList.add('sbplus-row-thumb-empty');
        return;
    }
    const probe = el.ownerDocument.createElement('img');
    probe.onload = () => {
        el.style.backgroundImage = `url('${url}')`;
        el.classList.add('sbplus-row-thumb-loaded');
    };
    probe.onerror = () => {
        badThumbUrls.add(url);
        el.classList.add('sbplus-row-thumb-empty');
    };
    probe.src = url;
}



// FLAG-ICONS ————————————————————————————————————————————————————————————
const flagFiles = constSysfsExpr({
    basePath: '../../node_modules/flag-icons/flags/4x3',
    include: '*.svg',
    encoding: 'utf8',
});

const flagsByCountry = new Map<string, string>();
for (const file of flagFiles) {
    flagsByCountry.set(file.fileName.replace(/\.svg$/i, '').toUpperCase(), file.content);
}

export function getFlagSvg(countryCode: string | null): string | null {
    if (!countryCode) return null;
    return flagsByCountry.get(countryCode.toUpperCase()) ?? null;
}
const readyCallbacks = new WeakMap<Document, Set<() => void>>();
const readyObservers = new WeakMap<Document, MutationObserver>();
const TAB_ORDER = ['internet', 'favorites', 'history', 'lan', 'friends'];
const liveTabStates = new Set<any>();
export type SortKey = 'players' | 'ping' | 'map';

export interface TabState {
    id: string;
    m_owner?: {
        GetTabState?(id: string): TabState | undefined;
        GetFixedAppID?(): number;
    };
    BRequestActive(): boolean;
    SetFilterGameAppID(appId: number): void;
    StartSearch(): void;
    DestroyRequest(): void;
}

export const browserState = {
    verifiedOnly: false,
    simpleViewActive: false,
    mapViewActive: false,
    enhancedViewActive: false,
    sortKey: 'players' as SortKey,
    sortDescending: true,
    currentAppId: null as number | null,
};

export function findDialogRoot(doc: Document): HTMLElement | null {
    return doc.querySelector('.DialogContent') ?? doc.querySelector('.ServerBrowserDialog');
}

export function isServerBrowserDocument(doc: Document): boolean {
    return (doc.title ?? '').includes('Game Servers') || !!doc.querySelector('.ServerBrowserDialog');
}

export function isSteamOverlay(doc: Document): boolean {
    return !!doc.querySelector('.OverlayServerBrowser');
}

export function getActiveTabId(doc: Document): string | null {
    const buttons = Array.from(doc.querySelectorAll('.SwitchTabButton'));
    const index = buttons.findIndex((b) => b.classList.contains('Selected'));
    return index >= 0 ? (TAB_ORDER[index] ?? null) : null;
}

export const fixedAppIdOf = (tabState: any): number => Number(tabState?.m_owner?.GetFixedAppID?.() ?? 0);

export function trackTabState(tabState: any): void {
    if (!liveTabStates.has(tabState)) {
        const kind = fixedAppIdOf(tabState);
        for (const ts of liveTabStates) {
            if (ts.m_owner !== tabState.m_owner && fixedAppIdOf(ts) === kind) liveTabStates.delete(ts);
        }
    }
    liveTabStates.delete(tabState);
    liveTabStates.add(tabState);
}

export function tabStatesFor(doc: Document): any[] {
    const wantFixed = isSteamOverlay(doc);
    const candidates = [...liveTabStates].filter((ts) => (fixedAppIdOf(ts) > 0) === wantFixed);
    const owner = candidates[candidates.length - 1]?.m_owner;
    return owner ? candidates.filter((ts) => ts.m_owner === owner) : [];
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

export function injectStyle(doc: Document, id: string, css: string): void {
    if (doc.getElementById(id)) return;
    const s = doc.createElement('style');
    s.id = id;
    s.textContent = css;
    doc.head.appendChild(s);
}

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


// #region SERVERS
const MAP_THUMB_DIR = './serverbrowserplus/images/maps';
export const UNKNOWN_THUMB_URL = `${MAP_THUMB_DIR}/unknown.jpg`;

export const steamClient = (): any => (window as any).SteamClient;

export function serverKey(server: any): string {
    return `${server.ip}:${server.port}`;
}

export const mapThumbUrl = (server: any): string =>
    `${MAP_THUMB_DIR}/${server.appid}/${encodeURIComponent(server.map ?? 'unknown')}.jpg`;

export function getNativeServer(doc: Document, key: string): any | null {
    for (const tabState of tabStatesFor(doc)) {
        for (const list of [tabState.filtered_servers, tabState.all_servers]) {
            const found = (list ?? []).find((server: any) => serverKey(server) === key);
            if (found) return found;
        }
    }
    return null;
}

async function openGameInfoDialog(server: any): Promise<number> {
    return steamClient().ServerBrowser.CreateServerGameInfoDialog(0, server.ip, server.port, server.queryPort, server.appid);
}

export async function viewServerInfo(server: any): Promise<void> {
    const dialogId = await openGameInfoDialog(server);
    steamClient().ServerBrowser.PingServer(dialogId);
}

export async function connectToServer(server: any): Promise<void> {
    const SB = steamClient().ServerBrowser;
    const dialogId = await openGameInfoDialog(server);

    await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            reg?.unregister?.();
            resolve();
        };
        const reg = SB.RegisterForServerInfo(dialogId, (info: any) => {
            if (info?.bHadSuccessfulResponse) finish();
        });
        SB.PingServer(dialogId);
        setTimeout(finish, 5000);
    });

    try {
        await SB.ConnectToServer(dialogId, '');
    } finally {
        SB.DestroyGameInfoDialog(dialogId);
    }
}
// #endregion

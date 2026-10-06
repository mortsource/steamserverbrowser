import { constSysfsExpr } from '@steambrew/client';
import { logToConsole, serversMap } from '../../shared';
import { browserState, findDialogRoot, onDocumentReady, injectStyle, tabStatesFor, getActiveTabId, serverKey, connectToServer, SortKey } from '../ui_shared';
import { updateVisibleRows, updateSortButton, setListServers, createListColumn, scrollListToKey, markSelectedRow, resetList, LIST_WIDTH } from './list';
import { createMap, teardownMap, resizeMap, syncMapData, syncMapSelection, updateAdVisibility } from './map';
import { closeServerMenu, runMenuAction } from './enh_shared';

// #region STATE
const viewState = {
    doc: null as Document | null,
    rootEl: null as HTMLElement | null,
    tableEl: null as HTMLElement | null,
    resizeObserver: null as ResizeObserver | null,
    selectedKey: null as string | null,
    connectBtnEl: null as HTMLElement | null,
    connectBtnEnabledByUs: false,
};

const insertByDoc = new WeakMap<Document, () => void>();
const connectHookedDocs = new WeakSet<Document>();
// const loggedMissing = new Set<string>();

function isDocAlive(doc: Document): boolean {
    const win = doc.defaultView;
    return !!win && !win.closed && doc.documentElement?.isConnected === true;
}

export function getEnhancedViewDoc(): Document | null {
    return viewState.doc && isDocAlive(viewState.doc) ? viewState.doc : null;
}
// #endregion



// #region SELECTION
function applySelection(server: any, panMap: boolean, scrollList: boolean): void {
    const key = serverKey(server);
    viewState.selectedKey = key;

    markSelectedRow(key);
    if (scrollList) scrollListToKey(key);
    syncMapSelection(key, panMap, true);

    if (viewState.doc) syncConnectButton(viewState.doc);
}
// #endregion



// #region CONNECT BUTTON
function hookConnectClick(doc: Document): void {
    if (connectHookedDocs.has(doc)) return;
    connectHookedDocs.add(doc);
    doc.addEventListener('click', (e) => {
        if (!browserState.enhancedViewActive || !viewState.selectedKey) return;
        const target = (e.target as HTMLElement)?.closest('.DialogButton.Primary');
        if (!target || target !== viewState.connectBtnEl) return;

        e.preventDefault();
        e.stopPropagation();
        const server = serversMap.get(viewState.selectedKey);
        if (server) runMenuAction('Connect', () => connectToServer(server));
    }, true);
}

function syncConnectButton(doc: Document): void {
    if (!viewState.connectBtnEl?.isConnected) {
        viewState.connectBtnEl = doc.querySelector('.DialogTwoColLayout > .DialogButton.Primary') as HTMLElement | null;
    }
    const btn = viewState.connectBtnEl;
    if (!btn) return;

    const shouldEnable = browserState.enhancedViewActive && !!viewState.selectedKey;
    if (shouldEnable) {
        if (btn.classList.contains('Disabled')) {
            btn.classList.remove('Disabled');
            viewState.connectBtnEnabledByUs = true;
        }
    } else if (viewState.connectBtnEnabledByUs) {
        btn.classList.add('Disabled');
        viewState.connectBtnEnabledByUs = false;
    }

    hookConnectClick(doc);
}
// #endregion



// #region LAYOUT
function syncBounds(): void {
    const { rootEl, tableEl } = viewState;
    if (!rootEl || !tableEl) return;
    const container = rootEl.parentElement;
    if (!container) return;

    const tableRect = tableEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    Object.assign(rootEl.style, {
        top: `${tableRect.top - containerRect.top}px`,
        left: `${tableRect.left - containerRect.left}px`,
        right: `${containerRect.right - tableRect.right}px`,
        bottom: `${containerRect.bottom - tableRect.bottom}px`,
    });

    resizeMap();
    updateVisibleRows();
}

function observeResize(doc: Document, table: HTMLElement): void {
    const win = doc.defaultView as any;
    if (!win?.ResizeObserver) return;

    if (!viewState.resizeObserver) {
        viewState.resizeObserver = new win.ResizeObserver(() => syncBounds());
    } else {
        viewState.resizeObserver.disconnect();
    }
    viewState.resizeObserver.observe(table);
}
// #endregion



// #region SERVER LIST
function getNativeFilteredKeys(doc: Document): Set<string> | null {
    const tabStates = tabStatesFor(doc);
    if (tabStates.length === 0) return null;
    const activeId = getActiveTabId(doc);
    const keys = new Set<string>();
    for (const tabState of tabStates) {
        if (activeId && tabState.id && tabState.id !== activeId) continue;
        for (const server of tabState.filtered_servers ?? []) keys.add(serverKey(server));
    }
    return keys;
}

export function compareServers(a: any, b: any, key: SortKey, descending: boolean): number {
    const dir = descending ? -1 : 1;
    const players = (s: any) => Number(s.players ?? 0);
    const ping = (s: any) => Number(s.ping) || 9999;
    let primary = 0;
    if (key === 'players') primary = (players(a) - players(b)) * dir;
    else if (key === 'ping') primary = (ping(a) - ping(b)) * dir;
    else primary = String(a.map ?? '').localeCompare(String(b.map ?? ''), undefined, { numeric: true }) * dir;
    if (primary) return primary;
    if (key !== 'players' && players(a) !== players(b)) return players(b) - players(a);
    return ping(a) - ping(b);
}

export function refreshEnhancedView(doc: Document): void {
    if (doc !== viewState.doc || !viewState.rootEl) return;

    syncBounds();

    const nativeKeys = getNativeFilteredKeys(doc);
    const servers: any[] = [];
    for (const server of serversMap.values()) {
        if (browserState.verifiedOnly && !server.verified) continue;
        if (nativeKeys && !nativeKeys.has(serverKey(server))) continue;
        servers.push(server);
    }
    servers.sort((a, b) => compareServers(a, b, browserState.sortKey, browserState.sortDescending));
    setListServers(servers);

    syncMapData(servers);
    updateVisibleRows();
    updateSortButton();
    updateAdVisibility(doc);

    doc.defaultView?.requestAnimationFrame(() => resizeMap());
}
// #endregion



// #region LIFECYCLE
function createEnhancedViewDom(doc: Document, container: HTMLElement): void {
    const root = doc.createElement('div');
    root.className = 'sbplus-ev-container';

    const mapDiv = doc.createElement('div');
    mapDiv.className = 'sbplus-ev-map';

    root.appendChild(createListColumn(doc, {
        onSelect: (server, panMap) => applySelection(server, panMap, false),
        onSortChanged: () => refreshEnhancedView(doc),
    }));
    root.appendChild(mapDiv);
    container.appendChild(root);

    viewState.rootEl = root;
    createMap(doc, mapDiv, (server) => applySelection(server, false, true));
}

function teardownEnhancedView(): void {
    teardownMap();
    resetList();
    closeServerMenu();

    try { viewState.resizeObserver?.disconnect(); } catch { }
    viewState.resizeObserver = null;

    try { viewState.rootEl?.remove(); } catch { }
    viewState.rootEl = null;
    viewState.tableEl = null;

    viewState.connectBtnEl = null;
    viewState.connectBtnEnabledByUs = false;

    // loggedMissing.clear();
}

export function claimEnhancedView(doc: Document): void {
    if (viewState.doc === doc) return;
    const previousDoc = getEnhancedViewDoc();
    if (previousDoc) findDialogRoot(previousDoc)?.classList.remove('sbplus-ev-active');
    if (viewState.rootEl) {
        logToConsole('VIEW', 'Moving to another server browser window, rebuilding view');
        teardownEnhancedView();
    }
    viewState.doc = doc;
    insertByDoc.get(doc)?.();
}
// #endregion



// #region INJECTION
const MAPLIBRE_CSS = constSysfsExpr('maplibre-gl.css', { basePath: '../../../node_modules/maplibre-gl/dist', encoding: 'utf8' }).content;
const ENHANCED_VIEW_CSS = constSysfsExpr('enh_style.css', { encoding: 'utf8' }).content;

const enhancedViewStyles = (): string => `
    ${MAPLIBRE_CSS}
    ${ENHANCED_VIEW_CSS}
    .sbplus-ev-listcol {
        width: ${LIST_WIDTH}px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        min-height: 0;
        border-right: 1px solid rgba(255, 255, 255, 0.08);
        -webkit-app-region: no-drag;
    }
`;

export function EnhancedView(doc: Document): void {
    injectStyle(doc, 'sbplus-ev-style', enhancedViewStyles());

    const tryInsert = () => {
        if (doc !== viewState.doc) {
            if (getEnhancedViewDoc()) {
                findDialogRoot(doc)?.classList.remove('sbplus-ev-active');
                return;
            }
            claimEnhancedView(doc);
            return;
        }

        const table = doc.querySelector('[role="table"]') as HTMLElement | null;
        const container = table?.parentElement as HTMLElement | null;
        const dialogRoot = findDialogRoot(doc);

        if (!table || !container || !dialogRoot) {
            // const missing = [
            //     !table && 'table[role="table"]',
            //     !container && 'table.parentElement',
            //     !dialogRoot && 'dialog root',
            // ].filter(Boolean).join(', ');
            // if (!loggedMissing.has(missing)) {
            //     loggedMissing.add(missing);
            //     logToConsole('VIEW', `Still waiting on -> ${missing}`, 'Warn');
            // }
            return;
        }

        viewState.tableEl = table;
        observeResize(doc, table);

        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        let justBuilt = false;
        if (!viewState.rootEl) {
            createEnhancedViewDom(doc, container);
            justBuilt = true;
        } else if (!viewState.rootEl.isConnected || viewState.rootEl.parentElement !== container) {
            container.appendChild(viewState.rootEl);
            justBuilt = true;
        }
        if (justBuilt && browserState.enhancedViewActive) refreshEnhancedView(doc);

        syncBounds();
        dialogRoot.classList.toggle('sbplus-ev-active', browserState.enhancedViewActive);
        syncConnectButton(doc);
    };

    insertByDoc.set(doc, tryInsert);
    claimEnhancedView(doc);
    onDocumentReady(doc, tryInsert);
}
// #endregion

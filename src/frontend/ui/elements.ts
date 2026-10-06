import { findModuleExport, constSysfsExpr } from '@steambrew/client';
import { logToConsole, isRemoteVerified, VERIFIED_NAME_MARKER, newVersionAvailable, blockLocally, splitToSubnet24 } from '../shared';
import { browserState, findDialogRoot, onDocumentReady, trackTabState, tabStatesFor, fixedAppIdOf, debounce, rafThrottle, injectStyle, getNativeServer } from './ui_shared';
import { openAlertModal, getAlert } from './alert';
import { refreshEnhancedView, claimEnhancedView, getEnhancedViewDoc } from './enhanced/core';

const scheduleEnhancedRefresh = debounce(() => {
    const viewDoc = getEnhancedViewDoc();
    if (viewDoc && browserState.enhancedViewActive) refreshEnhancedView(viewDoc);
}, 100);

// #region SERVER PLAYER COUNTER
const STAT_CATEGORIES = [
    { label: 'Servers', prefix: 'count_servers' },
    { label: 'Players', prefix: 'count_players' },
] as const;

const COUNTER_CSS = `
    #sbplus-counter { display:inline-flex; align-items:center; gap:10px; margin-left:16px; vertical-align:middle; font-size:11px; color:rgba(255,255,255,0.6); }
    #sbplus-counter:hover { color:rgba(255,255,255,0.9); }
    #sbplus-update-badge { color:#ffb454; font-weight:600; }
`;

const counter = {
    statsEl: null as HTMLElement | null,
    badgeEl: null as HTMLElement | null,
    pendingStats: null as any,
};

function formatCounterText(stats: any): string {
    const num = (n: number) => n == null ? '-' : n.toLocaleString();
    return STAT_CATEGORIES.map(({ label, prefix }) =>
        `${num(stats[`${prefix}_good`])} ${label.toLowerCase()} (${num(stats[`${prefix}_verified`])} verified)`
    ).join(' · ');
}

const flushCounterUpdate = debounce(() => {
    const { statsEl, badgeEl, pendingStats } = counter;
    if (!statsEl?.isConnected || !badgeEl?.isConnected) return;

    statsEl.textContent = formatCounterText(pendingStats);
    badgeEl.style.display = newVersionAvailable ? '' : 'none';
    scheduleEnhancedRefresh();
}, 250);

export function setupCounter(doc: Document): void {
    if (doc.getElementById('sbplus-counter')) return;

    const tryInsert = () => {
        const header = doc.querySelector('.DialogHeader');
        if (!header || doc.getElementById('sbplus-counter')) return;

        injectStyle(doc, 'sbplus-counter-style', COUNTER_CSS);
        const banner = doc.createElement('span');
        banner.id = 'sbplus-counter';
        banner.innerHTML = `
            <span id="sbplus-stats">ServerBrowserPlus loaded</span>
            <span id="sbplus-update-badge" style="display: ${newVersionAvailable ? '' : 'none'}">NEW UPDATE AVAILABLE</span>`;
        header.appendChild(banner);
        counter.statsEl = banner.querySelector<HTMLElement>('#sbplus-stats');
        counter.badgeEl = banner.querySelector<HTMLElement>('#sbplus-update-badge');
    };

    onDocumentReady(doc, tryInsert);
}

export function updateCounter(stats: any): void {
    counter.pendingStats = stats;
    flushCounterUpdate();
}
// #endregion



// #region VERIFIED SERVERS
const ROW_SELECTOR = 'div[role="row"].ServerRow';
const VERIFIED_COLOR = '#a78bfa';
const ICON_CIRCLE_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="${VERIFIED_COLOR}"><path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z"></path></svg>`;
const ICON_DIALOG_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" class="SVGIcon_Button SVGIcon_DialogCheck" x="0px" y="0px" width="256px" height="256px" viewBox="0 0 256 256" fill="${VERIFIED_COLOR}"><defs><linearGradient id="svgid_sbplus_1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${VERIFIED_COLOR}"></stop><stop offset="100%" stop-color="${VERIFIED_COLOR}"></stop></linearGradient><filter id="svgid_sbplus_2" x="0" y="0" width="200%" height="200%"><feOffset result="offOut" in="SourceAlpha" dx="20" dy="20"></feOffset><feGaussianBlur result="blurOut" in="offOut" stdDeviation="10"></feGaussianBlur><feBlend in="SourceGraphic" in2="blurOut" mode="normal"></feBlend></filter></defs><path fill="none" stroke="url(#svgid_sbplus_1)" stroke-width="24" stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="10" d="M206.5,45.25L95,210.75l-45.5-63" stroke-dasharray="365.19 365.19" stroke-dashoffset="0.00"></path><path fill="none" opacity=".2" filter="url(#svgid_sbplus_2)" stroke="url(#svgid_sbplus_1)" stroke-width="24" stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="10" d="M206.5,45.25L95,210.75l-45.5-63" stroke-dasharray="365.19 365.19" stroke-dashoffset="0.00"></path></svg>`;

function flushWithFixedAppId(tabState: any, flush: () => void): void {
    const fixed = fixedAppIdOf(tabState);
    const prefs = fixed ? tabState.Prefs?.() : null;
    if (!prefs || !prefs.appid || prefs.appid === fixed) {
        flush.call(tabState);
        return;
    }

    const saved = prefs.appid;
    prefs.appid = fixed;
    try {
        flush.call(tabState);
    } finally {
        prefs.appid = saved;
    }
}

function filterLogic(): void {
    const TabState = findModuleExport((e: any) => e?.prototype?.FlushPendingServers && e?.prototype?.Modified);
    if (!TabState) {
        logToConsole('FILTERS', 'Server browser tab state not found in webpack registry — verified filter unavailable', 'Warn');
        return;
    }
    if (TabState.prototype.__sbplusFilterHooked) return;
    TabState.prototype.__sbplusFilterHooked = true;

    const flush = TabState.prototype.FlushPendingServers;
    TabState.prototype.FlushPendingServers = function (this: any) {
        trackTabState(this);
        flushWithFixedAppId(this, flush);
        if (!browserState.verifiedOnly) return;
        this.filtered_servers = this.filtered_servers.filter((s: any) => isRemoteVerified(s.ip, s.port));
        this.Modified();
    };

    const modified = TabState.prototype.Modified;
    TabState.prototype.Modified = function (this: any) {
        trackTabState(this);
        modified.call(this);
        scheduleEnhancedRefresh();
    };

    logToConsole('FILTERS', 'Verified filter installed on server browser tab state');
}

function refreshVerifiedState(doc: Document): void {
    updateFilterSummary(doc);
    tabStatesFor(doc).forEach((tabState) => tabState.FlushPendingServers());
    if (browserState.enhancedViewActive) refreshEnhancedView(doc);
}

function filterButton(doc: Document): void {
    const tryInsert = () => {
        if (doc.getElementById('sbplus-verified-toggle')) return;
        const checkboxColumn = doc.querySelector('.FilterOptionsCheckboxesCtr') as HTMLElement | null;
        if (!checkboxColumn) return;

        injectStyle(doc, 'sbplus-filter-height-style', `.FilterOptionsCtr:not(.Collapsed) { height: 170px !important; }`);

        const container = doc.createElement('div');
        container.id = 'sbplus-verified-toggle';
        container.setAttribute('role', 'checkbox');
        container.setAttribute('aria-checked', String(browserState.verifiedOnly));
        container.className = 'DialogCheckbox_Container _DialogLayout Panel';
        container.setAttribute('tabindex', '0');

        const checkDiv = doc.createElement('div');
        checkDiv.className = 'DialogCheckbox';
        checkDiv.innerHTML = ICON_DIALOG_CHECK;
        checkDiv.classList.toggle('Active', browserState.verifiedOnly);

        const labelDiv = doc.createElement('div');
        labelDiv.className = 'DialogToggle_Label';
        labelDiv.innerHTML = '<span>Verified servers</span>';

        const clearDiv = doc.createElement('div');
        clearDiv.style.cssText = 'clear: left;';

        container.appendChild(checkDiv);
        container.appendChild(labelDiv);
        container.appendChild(clearDiv);
        checkboxColumn.appendChild(container);

        const activate = () => {
            browserState.verifiedOnly = !browserState.verifiedOnly;
            container.setAttribute('aria-checked', String(browserState.verifiedOnly));
            checkDiv.classList.toggle('Active', browserState.verifiedOnly);
            refreshVerifiedState(doc);
        };

        container.addEventListener('click', activate);
        container.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); activate(); }
        });
    };

    onDocumentReady(doc, tryInsert);
}

function updateFilterSummary(doc: Document): void {
    const el = doc.querySelector('.CurrentFiltersSummaryText') as HTMLElement | null;
    if (!el) return;
    const base = (el.textContent ?? '').replace(/(; )?is verified$/, '');
    el.textContent = browserState.verifiedOnly ? `${base}${base ? '; ' : ''}is verified` : base;
}

const highlightedDocs = new WeakSet<Document>();

function rowHighlight(doc: Document): void {
    if (highlightedDocs.has(doc)) return;
    highlightedDocs.add(doc);

    injectStyle(doc, 'sbplus-row-style', `
        ${ROW_SELECTOR}.sbplus-verified-row { border-left:3px solid ${VERIFIED_COLOR} !important; }
        ${ROW_SELECTOR}.sbplus-verified-row:not([data-is-selected="true"]) { background: ${VERIFIED_COLOR}14 !important; }
        .sbplus-star { color:${VERIFIED_COLOR} !important; margin-right:5px !important; flex-shrink:0 !important; vertical-align:middle !important; display:inline-flex !important; align-items:center !important; }
    `);

    const popupWin = doc.defaultView as (Window & typeof globalThis);
    let selectedRow: Element | null = null;

    const updateRowHighlight = (row: Element) => {
        const cell = row.querySelector('.ServerNameColumn') as HTMLElement | null;
        if (!cell) return;

        const isVerified = (cell.textContent ?? '').includes(VERIFIED_NAME_MARKER);
        const existingStar = cell.querySelector<HTMLElement>('.sbplus-star');

        if (isVerified) {
            row.classList.add('sbplus-verified-row');
            if (!existingStar) {
                const star = doc.createElement('span');
                star.className = 'sbplus-star';
                star.innerHTML = ICON_CIRCLE_CHECK;
                cell.insertAdjacentElement('afterbegin', star);
            }
        } else {
            row.classList.remove('sbplus-verified-row');
            existingStar?.remove();
        }
    };

    const scheduleTag = rafThrottle(popupWin, () => {
        doc.querySelectorAll(ROW_SELECTOR).forEach(updateRowHighlight);
    });

    const handleClick = (e: MouseEvent) => {
        const clickedRow = (e.target as HTMLElement)?.closest(ROW_SELECTOR) as HTMLElement | null;
        const wasSelected = selectedRow;
        selectedRow = clickedRow;

        if (wasSelected && wasSelected !== clickedRow) {
            wasSelected.setAttribute('data-is-selected', 'false');
        }
        if (selectedRow) {
            selectedRow.setAttribute('data-is-selected', 'true');
        }
    };

    scheduleTag();
    const tableRoot = doc.querySelector('[role="table"]') ?? doc.body ?? doc.documentElement;
    doc.addEventListener('click', handleClick);

    const obs = new MutationObserver(scheduleTag);
    obs.observe(tableRoot, { childList: true, subtree: true, characterData: true });
}

export function VerifiedFilter(doc: Document): void {
    filterLogic();
    filterButton(doc);
    onDocumentReady(doc, () => updateFilterSummary(doc));
    rowHighlight(doc);
}
// #endregion



// #region VIEW MODE
type ViewMode = 'basic' | 'enhanced';

const ICON_ROWS = constSysfsExpr('rows-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content;
const ICON_LOCATION = constSysfsExpr('location-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content;

const VIEW_MODES: { mode: ViewMode; icon: string; label: string }[] = [
    { mode: 'basic', icon: ICON_ROWS, label: 'Basic' },
    { mode: 'enhanced', icon: ICON_LOCATION, label: 'Enhanced' },
];

const VIEW_MODE_KEY = 'sbplus_viewmode';
const initializedDocs = new WeakSet<Document>();

// const toggleLoggedMissing = new Set<string>();

function loadViewMode(): ViewMode {
    try {
        const v = localStorage.getItem(VIEW_MODE_KEY);
        return v === 'enhanced' ? v : 'basic';
    } catch {
        return 'basic';
    }
}

function applyViewMode(doc: Document, dialogRoot: HTMLElement, mode: ViewMode, persist: boolean): void {
    if (persist && mode === 'enhanced') claimEnhancedView(doc);
    const effective: ViewMode = mode === 'enhanced' && getEnhancedViewDoc() !== doc ? 'basic' : mode;

    dialogRoot.classList.toggle('sbplus-ev-active', effective === 'enhanced');
    for (const { mode: m } of VIEW_MODES) {
        doc.getElementById(`sbplus-viewbtn-${m}`)?.classList.toggle('active', m === effective);
    }
    if (!persist) return;

    browserState.enhancedViewActive = mode === 'enhanced';
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { }
    if (mode === 'enhanced') refreshEnhancedView(doc);
}

function locateNativeButton(doc: Document): HTMLElement | null {
    const byText = Array.from(doc.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Change Filters'
    ) as HTMLElement | undefined;
    return byText ?? (doc.querySelector('.ToggleShowFilterDetailsButton') as HTMLElement | null);
}

const VIEW_TOGGLE_CSS = `
    .sbplus-viewtoggle-group { display: inline-flex; gap: 4px; margin-left: 8px; vertical-align: middle; }
    .sbplus-viewtoggle-btn.active { color: #fff !important; background: #67707b !important; }
    .sbplus-viewtoggle-btn svg { width: 16px; height: 16px; display: block; transform: none !important; }
    .sbplus-viewtoggle-btn svg path { fill: currentColor; }
`;

export function ViewModeToggle(doc: Document): void {
    injectStyle(doc, 'sbplus-viewtoggle-style', VIEW_TOGGLE_CSS);

    const tryInsert = () => {
        const changeFiltersBtn = locateNativeButton(doc);
        const dialogRoot = findDialogRoot(doc);
        if (!changeFiltersBtn || !dialogRoot) {
            // const missing = [!changeFiltersBtn && 'changeFiltersBtn', !dialogRoot && 'dialog root'].filter(Boolean).join(', ');
            // if (!toggleLoggedMissing.has(missing)) {
            //     toggleLoggedMissing.add(missing);
            //     logToConsole('VIEW', `View toggle: still waiting on -> ${missing}`, 'Warn');
            // }
            return;
        }

        let group = doc.getElementById('sbplus-viewtoggle-group') as HTMLElement | null;
        if (!group || !group.isConnected) {
            group = doc.createElement('div');
            group.id = 'sbplus-viewtoggle-group';
            group.className = 'sbplus-viewtoggle-group';

            const idleClassName = changeFiltersBtn.className
                .split(/\s+/)
                .filter((c) => c && c !== 'Selected' && !(/\d/.test(c) && !c.startsWith('_')))
                .join(' ');

            for (const { mode, icon, label } of VIEW_MODES) {
                const btn = doc.createElement('button');
                btn.id = `sbplus-viewbtn-${mode}`;
                btn.type = 'button';
                btn.className = `${idleClassName} sbplus-viewtoggle-btn`;
                btn.title = label;
                btn.setAttribute('aria-label', label);
                btn.innerHTML = icon;
                btn.addEventListener('click', () => applyViewMode(doc, dialogRoot, mode, true));
                group.appendChild(btn);
            }
            changeFiltersBtn.insertAdjacentElement('afterend', group);
        }

        const firstVisit = !initializedDocs.has(doc);
        if (firstVisit) initializedDocs.add(doc);
        const mode = firstVisit
            ? loadViewMode()
            : browserState.enhancedViewActive ? 'enhanced' : 'basic';
        applyViewMode(doc, dialogRoot, mode, firstVisit);
    };

    onDocumentReady(doc, tryInsert);
}
// #endregion



// #region NATIVE CONTEXT MENU INJECTION
const ADDR_RE = /(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})/;

function extractAddress(menu: HTMLElement): { ip: string; port: number } | null {
    for (const item of Array.from(menu.querySelectorAll<HTMLElement>('.contextMenuItem'))) {
        const match = item.textContent?.match(ADDR_RE);
        if (match) return { ip: match[1], port: Number(match[2]) };
    }
    return null;
}

function dismissNativeMenu(doc: Document, menu: HTMLElement): void {
    const win = doc.defaultView;
    if (!win) return;

    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
        doc.body.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win }));
    }
    for (const type of ['keydown', 'keyup']) {
        doc.dispatchEvent(new win.KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    }
    menu.dispatchEvent(new win.FocusEvent('focusout', { bubbles: true }));
    menu.blur?.();
}

function injectMenuItems(doc: Document, menu: HTMLElement, address: { ip: string; port: number }): void {
    const { ip, port } = address;
    const contents = menu.querySelector<HTMLElement>('.contextMenuContents');
    const items = contents?.querySelectorAll<HTMLElement>('.contextMenuItem');
    if (!contents || !items?.length) return;

    const reference = items[items.length - 1];
    const subnet = splitToSubnet24(ip);

    const addItem = (label: string, action: () => void) => {
        const el = reference.cloneNode(true) as HTMLElement;
        el.textContent = label;
        el.addEventListener('click', () => {
            dismissNativeMenu(doc, menu);
            action();
        });
        contents.appendChild(el);
    };

    const key = `${ip}:${port}`;
    addItem(getAlert(key) ? 'Edit server alert...' : 'Set server alert...', () => {
        const server = getNativeServer(doc, key) ?? { ip, port, queryPort: port, appid: browserState.currentAppId ?? 0, name: key };
        openAlertModal(doc, server);
    });
    addItem(`Block IP (${ip})`, () => blockLocally(ip));
    addItem(`Block subnet (${subnet})`, () => blockLocally(subnet));
}

export function NativeContextMenu(doc: Document): void {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType !== 1) return;
                const el = node as HTMLElement;
                if (!el.classList?.contains('contextMenu') || !el.classList.contains('ContextMenuPosition')) return;

                const address = extractAddress(el);
                if (address && !el.textContent?.includes('Block IP (')) injectMenuItems(doc, el, address);
            });
        });
    });
    observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true });
}
// #endregion
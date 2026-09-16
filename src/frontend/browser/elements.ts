import { findModuleExport, constSysfsExpr } from '@steambrew/client';
import { logToConsole, isRemoteVerified, VERIFIED_NAME_MARKER, NEW_VERSION_AVAILABLE } from '../shared';
import { browserState, onDocumentReady, liveTabStates, debounce, rafThrottle } from './ui_shared';
import { refreshEnhancedView } from './view';

// COUNTER ————————————————————————————————————————————————————————————
const STAT_CATEGORIES = [
    { label: 'Servers', prefix: 'count_servers' },
    { label: 'Players', prefix: 'count_players' },
] as const;

const counterEl = {
    doc: null as Document | null,
    statsEl: null as HTMLElement | null,
    badgeEl: null as HTMLElement | null,
    pendingStats: null as any,
};

const flushCounterUpdate = debounce(() => {
    const { statsEl, badgeEl, doc, pendingStats } = counterEl;
    if (!statsEl?.isConnected || !badgeEl?.isConnected) return;

    statsEl.textContent = buildCounterElement(pendingStats);
    badgeEl.style.display = NEW_VERSION_AVAILABLE ? '' : 'none';

    if (doc && browserState.enhancedViewActive) refreshEnhancedView(doc);
}, 250);

function ensureCounterStyles(doc: Document): void {
    if (doc.getElementById('sbplus-counter-style')) return;
    const s = doc.createElement('style');
    s.id = 'sbplus-counter-style';
    s.textContent = `
        #sbplus-counter { display:inline-flex; align-items:center; gap:10px; margin-left:16px; vertical-align:middle; font-size:11px; color:rgba(255,255,255,0.6); }
        #sbplus-counter:hover { color:rgba(255,255,255,0.9); }
        #sbplus-update-badge { color:#ffb454; font-weight:600; }
    `;
    doc.head.appendChild(s);
}

function buildCounterElement(stats: any): string {
    const num = (n: number) => n == null ? '-' : n.toLocaleString();
    return STAT_CATEGORIES.map(({ label, prefix }) =>
        `${num(stats[`${prefix}_good`])} ${label.toLowerCase()} (${num(stats[`${prefix}_verified`])} verified)`
    ).join(' · ');
}

export class ServerPlayerCounter {
    setup(doc: Document): void {
        counterEl.doc = doc;
        if (doc.getElementById('sbplus-counter')) return;

        const tryInsert = () => {
            const header = doc.querySelector('.DialogHeader');
            if (!header || doc.getElementById('sbplus-counter')) return;

            ensureCounterStyles(doc);
            const banner = doc.createElement('span');
            banner.id = 'sbplus-counter';

            let counterStatsHTML = `<span id="sbplus-stats">ServerBrowserPlus loaded</span>`
            let newUpdateHTML = `
            <span id="sbplus-update-badge" style="display: ${NEW_VERSION_AVAILABLE ? '' : 'none'}">
                NEW UPDATE AVAILABLE
            </span>`;

            banner.innerHTML = counterStatsHTML + newUpdateHTML;
            header.appendChild(banner);
            counterEl.statsEl = banner.querySelector<HTMLElement>('#sbplus-stats');
            counterEl.badgeEl = banner.querySelector<HTMLElement>('#sbplus-update-badge');
        };

        onDocumentReady(doc, tryInsert);
    }

    update(stats: any): void {
        counterEl.pendingStats = stats;
        flushCounterUpdate();
    }
}



// VERIFIED ————————————————————————————————————————————————————————————
const ROW_SELECTOR = 'div[role="row"].ServerRow';
const verifiedColor = '#a78bfa';
const SVG_CircleCheck = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="${verifiedColor}"><path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z"></path></svg>`;
const SVG_DialogCheck = `<svg xmlns="http://www.w3.org/2000/svg" class="SVGIcon_Button SVGIcon_DialogCheck" x="0px" y="0px" width="256px" height="256px" viewBox="0 0 256 256" fill="${verifiedColor}"><defs><linearGradient id="svgid_sbplus_1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${verifiedColor}"></stop><stop offset="100%" stop-color="${verifiedColor}"></stop></linearGradient><filter id="svgid_sbplus_2" x="0" y="0" width="200%" height="200%"><feOffset result="offOut" in="SourceAlpha" dx="20" dy="20"></feOffset><feGaussianBlur result="blurOut" in="offOut" stdDeviation="10"></feGaussianBlur><feBlend in="SourceGraphic" in2="blurOut" mode="normal"></feBlend></filter></defs><path fill="none" stroke="url(#svgid_sbplus_1)" stroke-width="24" stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="10" d="M206.5,45.25L95,210.75l-45.5-63" stroke-dasharray="365.19 365.19" stroke-dashoffset="0.00"></path><path fill="none" opacity=".2" filter="url(#svgid_sbplus_2)" stroke="url(#svgid_sbplus_1)" stroke-width="24" stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="10" d="M206.5,45.25L95,210.75l-45.5-63" stroke-dasharray="365.19 365.19" stroke-dashoffset="0.00"></path></svg>`;

function filterLogic(): void {
    const TabState = findModuleExport((e: any) => e?.prototype?.FlushPendingServers && e?.prototype?.Modified);
    if (!TabState) {
        logToConsole('Server browser tab state not found in webpack registry — verified filter unavailable', 'Warn');
        return;
    }
    if (TabState.prototype.__sbplusFilterHooked) return;
    TabState.prototype.__sbplusFilterHooked = true;

    const flush = TabState.prototype.FlushPendingServers;
    TabState.prototype.FlushPendingServers = function (this: any) {
        liveTabStates.add(this);
        flush.call(this);
        if (!browserState.verifiedOnly) return;
        this.filtered_servers = this.filtered_servers.filter((s: any) => isRemoteVerified(s.ip, s.port));
        this.Modified();
    };

    const modified = TabState.prototype.Modified;
    TabState.prototype.Modified = function (this: any) {
        liveTabStates.add(this);
        modified.call(this);
        scheduleEnhancedRefresh();
    };

    logToConsole('Verified filter installed on server browser tab state', 'Info');
}

function filterButton(doc: Document): void {
    const tryInsert = () => {
        if (doc.getElementById('sbplus-verified-toggle')) return;
        const checkboxColumn = doc.querySelector('.FilterOptionsCheckboxesCtr') as HTMLElement | null;
        if (!checkboxColumn) return;

        if (!doc.getElementById('sbplus-filter-height')) {
            const s = doc.createElement('style');
            s.id = 'sbplus-filter-height';
            s.textContent = `.FilterOptionsCtr:not(.Collapsed) { height: 170px !important; }`;
            doc.head.appendChild(s);
        }

        const container = doc.createElement('div');
        container.id = 'sbplus-verified-toggle';
        container.setAttribute('role', 'checkbox');
        container.setAttribute('aria-checked', String(browserState.verifiedOnly));
        container.className = 'DialogCheckbox_Container _DialogLayout Panel';
        container.setAttribute('tabindex', '0');

        const checkDiv = doc.createElement('div');
        checkDiv.className = 'DialogCheckbox';
        checkDiv.innerHTML = SVG_DialogCheck;
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

function filterSummary(doc: Document): void {
    onDocumentReady(doc, () => updateFilterSummary(doc));
}

function rowHighlight(doc: Document): void {
    if (!doc.getElementById('sbplus-row-style')) {
        const s = doc.createElement('style');
        s.id = 'sbplus-row-style';
        s.textContent = `
            ${ROW_SELECTOR}.sbplus-verified-row { border-left:3px solid ${verifiedColor} !important; }
            ${ROW_SELECTOR}.sbplus-verified-row:not([data-is-selected="true"]) { background: rgba(167,139,250,0.08) !important; }
            .sbplus-star { color:${verifiedColor} !important; margin-right:5px !important; flex-shrink:0 !important; vertical-align:middle !important; display:inline-flex !important; align-items:center !important; }
        `;
        doc.head.appendChild(s);
    }

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
                star.innerHTML = SVG_CircleCheck;
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
    filterSummary(doc);
    rowHighlight(doc);
}



// VIEW MODE ————————————————————————————————————————————————————————————
type ViewMode = 'basic' | 'enhanced';

const MODES: { mode: ViewMode; icon: string; label: string }[] = [
    { mode: 'basic', icon: constSysfsExpr('rows-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content, label: 'Basic' },
    { mode: 'enhanced', icon: constSysfsExpr('split-view-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content, label: 'Enhanced' },
];

const VIEW_MODE_KEY = 'sbplus_viewmode';
const initializedDocs = new WeakSet<Document>();

let toggleLoggedMissing = new Set<string>();

function loadViewMode(): ViewMode {
    try {
        const v = localStorage.getItem(VIEW_MODE_KEY);
        return v === 'enhanced' ? v : 'basic';
    } catch {
        return 'basic';
    }
}

function applyViewMode(doc: Document, dialogRoot: HTMLElement, mode: ViewMode, persist: boolean): void {
    dialogRoot.classList.toggle('sbplus-ev-active', mode === 'enhanced');
    for (const { mode: m } of MODES) {
        doc.getElementById(`sbplus-viewbtn-${m}`)?.classList.toggle('active', m === mode);
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
    return byText ?? (doc.querySelector('.ToggleShowFilterDetailsButton ') as HTMLElement | null);
}

function ensureViewModeStyles(doc: Document): void {
    if (doc.getElementById('sbplus-viewtoggle-style')) return;
    const s = doc.createElement('style');
    s.id = 'sbplus-viewtoggle-style';
    s.textContent = `
        .sbplus-viewtoggle-group { display: inline-flex; gap: 4px; margin-left: 8px; vertical-align: middle; }
        .sbplus-viewtoggle-btn.active { color: #fff !important; background: #67707b !important; }
        .sbplus-viewtoggle-btn svg { width: 16px; height: 16px; display: block; transform: none !important; }
        .sbplus-viewtoggle-btn svg path { fill: currentColor; }
    `;
    doc.head.appendChild(s);
}

export function ViewMode(doc: Document): void {
    ensureViewModeStyles(doc);

    const tryInsert = () => {
        const changeFiltersBtn = locateNativeButton(doc);
        const dialogRoot = doc.querySelector('.DialogContent') as HTMLElement | null;
        if (!changeFiltersBtn || !dialogRoot) {
            const missing = [!changeFiltersBtn && 'changeFiltersBtn', !dialogRoot && '.DialogContent'].filter(Boolean).join(', ');
            if (!toggleLoggedMissing.has(missing)) {
                toggleLoggedMissing.add(missing);
                logToConsole(`View toggle: still waiting on -> ${missing}`, 'Warn');
            }
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

            for (const { mode, icon, label } of MODES) {
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



// HELPERS ————————————————————————————————————————————————————————————
export function refreshVerifiedState(doc: Document): void {
    updateFilterSummary(doc);
    liveTabStates.forEach((tabState) => tabState.FlushPendingServers());
    if (browserState.enhancedViewActive) refreshEnhancedView(doc);
}

const scheduleEnhancedRefresh = debounce(() => {
    if (counterEl.doc && browserState.enhancedViewActive) refreshEnhancedView(counterEl.doc);
}, 100);
import { constSysfsExpr } from '@steambrew/client';
import { logToConsole } from '../shared';
import { browserState, onDocumentReady, liveTabStates, getActiveTabId, rafThrottle } from './ui_shared';

// CONFIGURATION ————————————————————————————————————————————————————————————
const toDataUri = (base64: string): string => `data:image/png;base64,${base64}`;

export const CSGO_APP_ID = 4465480;
const ICON_CS2 = toDataUri(constSysfsExpr('730.png', { basePath: '../assets/icons', encoding: 'base64' }).content);
const ICON_CSGO = toDataUri(constSysfsExpr('4465480.png', { basePath: '../assets/icons', encoding: 'base64' }).content);
const ICON_CSS = toDataUri(constSysfsExpr('240.png', { basePath: '../assets/icons', encoding: 'base64' }).content);
const ICON_TF2 = toDataUri(constSysfsExpr('440.png', { basePath: '../assets/icons', encoding: 'base64' }).content);
const ICON_GMOD = toDataUri(constSysfsExpr('4000.png', { basePath: '../assets/icons', encoding: 'base64' }).content);
const ICON_QUAKE = toDataUri(constSysfsExpr('282440.png', { basePath: '../assets/icons', encoding: 'base64' }).content);
const ICON_SEARCH = constSysfsExpr('search-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content;
const ICON_STOP = constSysfsExpr('x-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content;

interface GameEntry {
    appid: number;
    label: string;
}

const POPULAR_GAMES: (GameEntry & { icon: string })[] = [
    { appid: 730, label: 'CS2', icon: ICON_CS2 },
    { appid: CSGO_APP_ID, label: 'CS:GO', icon: ICON_CSGO },
    { appid: 240, label: 'CS:Source', icon: ICON_CSS },
    { appid: 440, label: 'Team Fortress 2', icon: ICON_TF2 },
    { appid: 282440, label: 'Quake Live', icon: ICON_QUAKE },
    { appid: 4000, label: 'Garry\'s Mod', icon: ICON_GMOD }
];

const ANY_GAME: GameEntry = { appid: 0, label: '(Any)' };
const MORE_LABEL_DEFAULT = 'More';
const DROPDOWN_GAMES: GameEntry[] = [
    { appid: 10, label: 'Counter-Strike' },
    { appid: 80, label: 'Counter-Strike: Condition Zero' },
    { appid: 30, label: 'Day of Defeat' },
    { appid: 300, label: 'Day of Defeat: Source' },
    { appid: 70, label: 'Half-Life' },
    { appid: 50, label: 'Half-Life: Opposing Force' },
    { appid: 40, label: 'Half-Life: Deathmatch' },
    { appid: 360, label: 'Half-Life: Deathmatch Source' },
    { appid: 320, label: 'Half-Life 2: Deathmatch' },
    { appid: 500, label: 'Left 4 Dead' },
    { appid: 550, label: 'Left 4 Dead 2' },
    { appid: 20, label: 'Team Fortress Classic' }
];



// STATE ————————————————————————————————————————————————————————————————————
let selectedAppId: number | null = null;
let compactLayout = false;
let overflowCount = 0;



// TAB STATE ———————————————————————————————————————————————————————————————
function findTabState(doc: Document): any | null {
    const activeId = getActiveTabId(doc);
    let anyState: any = null;

    for (const state of liveTabStates) {
        if (activeId && state.id === activeId) return state;
        anyState ??= state;
    }

    if (anyState && activeId && typeof anyState.m_owner?.GetTabState === 'function') {
        return anyState.m_owner.GetTabState(activeId) ?? anyState;
    }
    return anyState;
}

export function switchGame(appId: number, doc: Document): void {
    const tabState = findTabState(doc);
    if (!tabState) {
        logToConsole('Game select: no server browser tab state available yet', 'Warn');
        return;
    }
    if (typeof tabState.SetFilterGameAppID !== 'function' || typeof tabState.StartSearch !== 'function') {
        logToConsole('Game select: tab state is missing SetFilterGameAppID/StartSearch', 'Error');
        return;
    }

    logToConsole(`Game select: searching appid ${appId} on tab ${tabState.id}`, 'Info');
    tabState.SetFilterGameAppID(appId);
    tabState.StartSearch();
}



// STYLES ——————————————————————————————————————————————————————————————————
function ensureGameSelectStyles(doc: Document): void {
    if (doc.getElementById('sbplus-gameselect-style')) return;
    const s = doc.createElement('style');
    s.id = 'sbplus-gameselect-style';
    s.textContent = `
        .sbplus-gameselect {
            display: inline-flex; vertical-align: bottom; align-items: center;
            gap: 4px; margin-left: 8px; margin-right: 12px; flex-shrink: 0;
        }
        .sbplus-gameselect-btn {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 8px 12px; border-radius: 3px; border: none; cursor: pointer;
            background: transparent; color: rgba(255,255,255,0.6); font-size: 12px; white-space: nowrap;
        }
        .sbplus-gameselect-btn:hover { background: rgba(255,255,255,0.06); color: #fff; }
        .sbplus-gameselect-btn.active { background: #67707b; color: #fff; }
        .sbplus-gameselect-btn img { width: 18px; height: 18px; border-radius: 2px; display: block; }
        .sbplus-gameselect.compact .sbplus-gameselect-label { display: none; }
        .sbplus-gameselect.compact .sbplus-gameselect-btn { padding: 8px; }
        .sbplus-gameselect-more { position: relative; }
        .sbplus-gameselect-more-btn svg { flex-shrink: 0; }
        .sbplus-gameselect-menu {
            display: none; position: absolute; top: 100%; right: 0; margin-top: 4px;
            background: #16181c; border: 1px solid rgba(255,255,255,0.08); border-radius: 4px;
            min-width: 190px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 2000; padding: 4px 0;
            max-height: 70vh; overflow-y: auto;
        }
        .sbplus-gameselect-menu.open { display: block; }
        .sbplus-gameselect-menu-item { padding: 6px 12px; font-size: 12px; color: rgba(255,255,255,0.75); cursor: pointer; }
        .sbplus-gameselect-menu-item:hover { background: rgba(255,255,255,0.06); color: #fff; }
        .sbplus-gameselect-menu-item.active { color: #cccccc; }
        .sbplus-gameselect-search-btn {
            position: relative; width: 34px; height: 34px;
            padding: 0; justify-content: center; flex-shrink: 0;
        }
        .sbplus-gameselect-search-btn svg { width: 14px; height: 14px; display: block; }
        .sbplus-gameselect-search-btn svg path { fill: currentColor; }
        .sbplus-gameselect-search-btn.searching { color: #fff; }
        .sbplus-gameselect-search-btn.searching::after {
            content: ''; position: absolute; box-sizing: border-box; pointer-events: none;
            top: 50%; left: 50%; width: 24px; height: 24px; margin: -12px 0 0 -12px;
            border-radius: 50%; border: 2px solid rgba(255,255,255,0.15); border-top-color: #cccccc;
            animation: sbplus-gameselect-spin 700ms linear infinite;
        }
        @keyframes sbplus-gameselect-spin { to { transform: rotate(360deg); } }
    `;
    doc.head.appendChild(s);
}



// UI SYNC —————————————————————————————————————————————————————————————————
function updateSelectionUI(doc: Document): void {
    const wrap = doc.getElementById('sbplus-gameselect');
    if (!wrap) return;

    wrap.querySelectorAll<HTMLElement>('[data-appid]').forEach((el) => {
        el.classList.toggle('active', Number(el.dataset.appid) === selectedAppId);
    });

    const moreLabel = wrap.querySelector<HTMLElement>('#sbplus-gameselect-more-label');
    if (!moreLabel) return;
    const dropdownMatch = [ANY_GAME, ...DROPDOWN_GAMES].find((g) => g.appid === selectedAppId);
    moreLabel.textContent = dropdownMatch ? dropdownMatch.label : MORE_LABEL_DEFAULT;
}

function selectAppId(appid: number, doc: Document): void {
    selectedAppId = appid;
    updateSelectionUI(doc);
}

function updateSearchButton(doc: Document): void {
    const btn = doc.getElementById('sbplus-gameselect-search-btn');
    if (!btn) return;

    const searching = !!findTabState(doc)?.BRequestActive?.();
    if (btn.dataset.searching === String(searching)) return;

    btn.dataset.searching = String(searching);
    btn.classList.toggle('searching', searching);
    btn.innerHTML = searching ? ICON_STOP : ICON_SEARCH;
    btn.title = searching ? 'Stop' : 'Search';
}

function hideNativeControls(nativeDropdown: HTMLElement): void {
    nativeDropdown.style.display = 'none';

    const row = nativeDropdown.parentElement;
    if (!row) return;

    const isOurs = (el: Element) => !!el.closest('#sbplus-gameselect');
    const native = Array.from(row.querySelectorAll<HTMLElement>('.SearchButton')).filter((b) => !isOurs(b));

    const targets = native.length ? native : Array.from(row.children)
        .filter((c): c is HTMLElement => c.tagName === 'BUTTON')
        .filter((c) => c !== nativeDropdown && !isOurs(c) && !c.classList.contains('SwitchTabButton'))
        .slice(-1);

    targets.forEach((btn) => { btn.style.display = 'none'; });
}



// RENDER ——————————————————————————————————————————————————————————————————
function buildMenuHTML(doc: Document, spilled: GameEntry[]): string {
    const items = getActiveTabId(doc) === 'favorites' ? [ANY_GAME, ...spilled, ...DROPDOWN_GAMES] : [...spilled, ...DROPDOWN_GAMES];
    return items.map((g) =>
        `<div class="sbplus-gameselect-menu-item" data-appid="${g.appid}">${g.label}</div>`
    ).join('');
}

function refreshMenu(doc: Document, wrap: HTMLElement): void {
    const menu = wrap.querySelector<HTMLElement>('#sbplus-gameselect-menu');
    if (!menu) return;
    const spilled = POPULAR_GAMES.slice(POPULAR_GAMES.length - overflowCount);
    menu.innerHTML = buildMenuHTML(doc, spilled);
}

function renderControls(wrap: HTMLElement, doc: Document): void {
    const shown = POPULAR_GAMES.slice(0, POPULAR_GAMES.length - overflowCount);
    const spilled = POPULAR_GAMES.slice(POPULAR_GAMES.length - overflowCount);

    const buttonsHTML = shown.map((g) =>
        `<button type="button" class="sbplus-gameselect-btn" data-appid="${g.appid}" title="${g.label}">` +
        `<img src="${g.icon}" alt="">` +
        `<span class="sbplus-gameselect-label">${g.label}</span>` +
        `</button>`
    ).join('');

    const menuHTML = buildMenuHTML(doc, spilled);

    wrap.classList.toggle('compact', compactLayout);
    wrap.innerHTML = `${buttonsHTML}
        <div class="sbplus-gameselect-more">
            <button type="button" class="sbplus-gameselect-btn sbplus-gameselect-more-btn" id="sbplus-gameselect-more-btn">
                <span id="sbplus-gameselect-more-label">${MORE_LABEL_DEFAULT}</span>
                <svg viewBox="0 0 128 128" width="10" height="10"><polygon points="50 59.49 13.21 22.89 4.74 31.39 50 76.41 95.26 31.39 86.79 22.89 50 59.49" fill="currentColor"></polygon></svg>
            </button>
            <div class="sbplus-gameselect-menu" id="sbplus-gameselect-menu">${menuHTML}</div>
        </div>
        <button type="button" class="sbplus-gameselect-btn sbplus-gameselect-search-btn" id="sbplus-gameselect-search-btn" title="Search">
            ${ICON_SEARCH}
        </button>`;
}

function reflow(doc: Document): void {
    const wrap = doc.getElementById('sbplus-gameselect');
    const row = wrap?.parentElement;
    if (!wrap || !row) return;

    const overflows = () => row.scrollWidth > row.clientWidth + 1;
    const apply = (compact: boolean, count: number) => {
        if (compact === compactLayout && count === overflowCount) return;
        compactLayout = compact;
        overflowCount = count;
        renderControls(wrap, doc);
        updateSelectionUI(doc);
        updateSearchButton(doc);
    };

    apply(false, 0);
    if (!overflows()) return;

    apply(true, 0);
    while (overflows() && overflowCount < POPULAR_GAMES.length) {
        apply(true, overflowCount + 1);
    }
}



// CORE ——————————————————————————————————————————————————————————————
export function injectGameSelect(doc: Document): void {
    ensureGameSelectStyles(doc);

    const tryInsert = () => {
        const nativeDropdown = doc.querySelector('.DialogDropDown[role="combobox"]') as HTMLElement | null;
        if (!nativeDropdown) return;

        hideNativeControls(nativeDropdown);

        if (doc.getElementById('sbplus-gameselect')) {
            updateSelectionUI(doc);
            return;
        }

        if (selectedAppId === null) selectedAppId = browserState.currentAppId;

        const wrap = doc.createElement('div');
        wrap.id = 'sbplus-gameselect';
        wrap.className = 'sbplus-gameselect';
        renderControls(wrap, doc);
        nativeDropdown.insertAdjacentElement('afterend', wrap);

        wrap.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const menu = wrap.querySelector<HTMLElement>('#sbplus-gameselect-menu');

            if (target.closest('#sbplus-gameselect-more-btn')) {
                e.stopPropagation();
                refreshMenu(doc, wrap);
                menu?.classList.toggle('open');
                return;
            }

            if (target.closest('#sbplus-gameselect-search-btn')) {
                const tabState = findTabState(doc);
                if (tabState?.BRequestActive?.()) {
                    logToConsole(`Game select: stopping search on tab ${tabState.id}`, 'Info');
                    tabState.DestroyRequest();
                } else if (selectedAppId !== null) {
                    switchGame(selectedAppId, doc);
                }
                updateSearchButton(doc);
                return;
            }

            const pick = target.closest<HTMLElement>('[data-appid]');
            if (!pick) return;
            e.stopPropagation();
            menu?.classList.remove('open');
            selectAppId(Number(pick.dataset.appid), doc);
        });

        const view = doc.defaultView ?? window;
        doc.addEventListener('click', () => {
            wrap.querySelector('#sbplus-gameselect-menu')?.classList.remove('open');
        });

        view.setInterval(() => updateSearchButton(doc), 250);

        const scheduleReflow = rafThrottle(view, () => reflow(doc));

        const RO = (view as any).ResizeObserver;
        if (RO) new RO(scheduleReflow).observe(wrap.parentElement ?? wrap);
        view.addEventListener('resize', scheduleReflow);

        updateSelectionUI(doc);
        updateSearchButton(doc);
        scheduleReflow();
    };

    onDocumentReady(doc, tryInsert);
}
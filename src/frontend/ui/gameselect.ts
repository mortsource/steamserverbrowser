import { constSysfsExpr } from '@steambrew/client';
import { logToConsole } from '../shared';
import { browserState, onDocumentReady, tabStatesFor, fixedAppIdOf, getActiveTabId, escapeHtml, injectStyle, TabState } from './ui_shared';

// #region RENDERING
const toDataUri = (base64: string): string => `data:image/png;base64,${base64}`;
const ICON_CS2 = toDataUri(constSysfsExpr('730.png', { basePath: '../assets/icons', encoding: 'base64' }).content);
const ICON_CSGO = toDataUri(constSysfsExpr('4465480.png', { basePath: '../assets/icons', encoding: 'base64' }).content);
const ICON_CSSOURCE = toDataUri(constSysfsExpr('240.png', { basePath: '../assets/icons', encoding: 'base64' }).content);
const ICON_TF2 = toDataUri(constSysfsExpr('440.png', { basePath: '../assets/icons', encoding: 'base64' }).content);
const ICON_GMOD = toDataUri(constSysfsExpr('4000.png', { basePath: '../assets/icons', encoding: 'base64' }).content);
const ICON_QUAKE = toDataUri(constSysfsExpr('282440.png', { basePath: '../assets/icons', encoding: 'base64' }).content);
const ICON_SEARCH = constSysfsExpr('search-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content;
const ICON_STOP = constSysfsExpr('x-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content;
const ICON_CHEVRON = `<svg viewBox="0 0 128 128" width="10" height="10"><polygon points="50 59.49 13.21 22.89 4.74 31.39 50 76.41 95.26 31.39 86.79 22.89 50 59.49" fill="currentColor"></polygon></svg>`;

interface GameEntry {
    appId: number;
    label: string;
}

const POPULAR_GAMES: (GameEntry & { icon: string })[] = [
    { appId: 730, label: 'CS2', icon: ICON_CS2 },
    { appId: 4465480, label: 'CS:GO', icon: ICON_CSGO },
    { appId: 240, label: 'CS:Source', icon: ICON_CSSOURCE },
    { appId: 440, label: 'Team Fortress 2', icon: ICON_TF2 },
    { appId: 282440, label: 'Quake Live', icon: ICON_QUAKE },
    { appId: 4000, label: 'Garry\'s Mod', icon: ICON_GMOD }
];

const ANY_GAME: GameEntry = { appId: 0, label: '(Any)' };
const DROPDOWN_GAMES: GameEntry[] = [
    { appId: 10, label: 'Counter-Strike' },
    { appId: 80, label: 'Counter-Strike: Condition Zero' },
    { appId: 30, label: 'Day of Defeat' },
    { appId: 300, label: 'Day of Defeat: Source' },
    { appId: 70, label: 'Half-Life' },
    { appId: 50, label: 'Half-Life: Opposing Force' },
    { appId: 40, label: 'Half-Life: Deathmatch' },
    { appId: 360, label: 'Half-Life: Deathmatch Source' },
    { appId: 320, label: 'Half-Life 2: Deathmatch' },
    { appId: 500, label: 'Left 4 Dead' },
    { appId: 550, label: 'Left 4 Dead 2' },
    { appId: 20, label: 'Team Fortress Classic' }
];

const GAMESELECT_CSS = constSysfsExpr('gameselect.css', { encoding: 'utf8' }).content;

function buildMenuHTML(doc: Document): string {
    const items = getActiveTabId(doc) === 'favorites' ? [ANY_GAME, ...DROPDOWN_GAMES] : DROPDOWN_GAMES;
    return items.map((g) =>
        `<div class="sbplus-gameselect-menu-item" data-appid="${g.appId}">${escapeHtml(g.label)}</div>`
    ).join('');
}

function createControls(doc: Document): HTMLElement {
    const buttonsHTML = POPULAR_GAMES.map((g) =>
        `<button type="button" class="sbplus-gameselect-btn" data-appid="${g.appId}" title="${escapeHtml(g.label)}">` +
        `<img src="${g.icon}" alt="">` +
        `<span class="sbplus-gameselect-label">${escapeHtml(g.label)}</span>` +
        `</button>`
    ).join('');

    const wrap = doc.createElement('div');
    wrap.id = 'sbplus-gameselect';
    wrap.className = 'sbplus-gameselect';
    wrap.innerHTML = `${buttonsHTML}
        <div class="sbplus-gameselect-more">
            <button type="button" class="sbplus-gameselect-btn sbplus-gameselect-more-btn" id="sbplus-gameselect-more-btn">
                <span id="sbplus-gameselect-more-label">More</span>
                ${ICON_CHEVRON}
            </button>
            <div class="sbplus-gameselect-menu" id="sbplus-gameselect-menu">${buildMenuHTML(doc)}</div>
        </div>
        <button type="button" class="sbplus-gameselect-btn sbplus-gameselect-search-btn" id="sbplus-gameselect-search-btn" title="Search">
            ${ICON_SEARCH}
        </button>`;
    return wrap;
}

function updateSelectionUI(wrap: HTMLElement, selectedAppId: number | null): void {
    wrap.querySelectorAll<HTMLElement>('[data-appid]').forEach((el) => {
        el.classList.toggle('active', Number(el.dataset.appid) === selectedAppId);
    });

    const moreLabel = wrap.querySelector<HTMLElement>('#sbplus-gameselect-more-label');
    const dropdownMatch = [ANY_GAME, ...DROPDOWN_GAMES].find((g) => g.appId === selectedAppId);
    if (moreLabel) moreLabel.textContent = dropdownMatch ? dropdownMatch.label : 'More';
}

function updateSearchButton(doc: Document): void {
    const btn = doc.getElementById('sbplus-gameselect-search-btn');
    if (!btn) return;

    const searching = !!findTabState(doc)?.BRequestActive();
    if (btn.dataset.searching === String(searching)) return;

    btn.dataset.searching = String(searching);
    btn.classList.toggle('searching', searching);
    btn.innerHTML = searching ? ICON_STOP : ICON_SEARCH;
    btn.title = searching ? 'Stop' : 'Search';
}
// #endregion



// #region CORE
function findTabState(doc: Document): TabState | null {
    const states: TabState[] = tabStatesFor(doc);
    const activeId = getActiveTabId(doc);
    const fallback = states[0] ?? null;
    if (!activeId || !fallback) return fallback;
    return states.find((s) => s.id === activeId) ?? fallback.m_owner?.GetTabState?.(activeId) ?? fallback;
}

function toggleSearch(doc: Document, selectedAppId: number | null): void {
    const tabState = findTabState(doc);
    if (!tabState) {
        logToConsole('VIEW', 'No server browser tab state available yet', 'Warn');
        return;
    }

    if (tabState.BRequestActive()) {
        // logToConsole('VIEW', `Stopping search on tab ${tabState.id}`);
        tabState.DestroyRequest();
    } else if (selectedAppId !== null) {
        const fixed = fixedAppIdOf(tabState);
        if (fixed && fixed !== selectedAppId) {
            logToConsole('VIEW', `Tab ${tabState.id} is fixed to appid ${fixed}, cannot switch to ${selectedAppId}`, 'Warn');
            return;
        }
        // logToConsole('VIEW', `Searching appid ${selectedAppId} on tab ${tabState.id}`);
        tabState.SetFilterGameAppID(selectedAppId);
        tabState.StartSearch();
    }
    updateSearchButton(doc);
}

const NATIVE_DROPDOWN_SELECTOR = '.DialogDropDown[role="combobox"]';

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

export function GameSelect(doc: Document): void {
    injectStyle(doc, 'sbplus-gameselect-style', GAMESELECT_CSS);
    let selectedAppId: number | null = null;

    doc.addEventListener('click', () => {
        doc.getElementById('sbplus-gameselect-menu')?.classList.remove('open');
    });
    (doc.defaultView ?? window).setInterval(() => updateSearchButton(doc), 250);

    onDocumentReady(doc, () => {
        const nativeDropdown = doc.querySelector<HTMLElement>(NATIVE_DROPDOWN_SELECTOR);
        if (!nativeDropdown) return;

        if (nativeDropdown.style.display !== 'none') hideNativeControls(nativeDropdown);
        if (doc.getElementById('sbplus-gameselect')) return;

        selectedAppId ??= browserState.currentAppId;
        const wrap = createControls(doc);
        nativeDropdown.insertAdjacentElement('afterend', wrap);

        wrap.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const menu = wrap.querySelector<HTMLElement>('#sbplus-gameselect-menu');

            if (target.closest('#sbplus-gameselect-more-btn')) {
                e.stopPropagation();
                if (menu) menu.innerHTML = buildMenuHTML(doc);
                updateSelectionUI(wrap, selectedAppId);
                menu?.classList.toggle('open');
                return;
            }

            if (target.closest('#sbplus-gameselect-search-btn')) {
                toggleSearch(doc, selectedAppId);
                return;
            }

            const pick = target.closest<HTMLElement>('[data-appid]');
            if (!pick) return;
            e.stopPropagation();
            menu?.classList.remove('open');
            selectedAppId = Number(pick.dataset.appid);
            updateSelectionUI(wrap, selectedAppId);
        });

        updateSelectionUI(wrap, selectedAppId);
        updateSearchButton(doc);
    });
}
// #endregion
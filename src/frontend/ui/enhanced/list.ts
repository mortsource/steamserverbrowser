import type { ContextMenuInstance } from '@steambrew/client';
import { serversMap, startFavoritesTracking, onFavoritesChanged } from '../../shared';
import { browserState, escapeHtml, rafThrottle, getActiveTabId, serverKey, SortKey } from '../ui_shared';
import { onAlertsChanged } from '../alert';
import { buildServerMeta, attachRowThumbFallback, openServerMenu, openNativeMenu, hideNativeMenu, MenuEntry } from './enh_shared';

// #region CONSTANTS
export const LIST_WIDTH = 325;
const LIST_ROW_HEIGHT = 85;
const LIST_OVERSCAN_PX = LIST_ROW_HEIGHT * 12;

const ICON_SORT_DESC = `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 3l4 4 4-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_SORT_ASC = `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 7l4-4 4 4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const SORT_OPTIONS: Array<{ key: SortKey; label: string; defaultDescending: boolean }> = [
    { key: 'players', label: 'Players', defaultDescending: true },
    { key: 'ping', label: 'Ping', defaultDescending: false },
    { key: 'map', label: 'Map', defaultDescending: false },
];
// #endregion



// #region STATE
interface ListHandlers {
    onSelect(server: any, panMap: boolean): void;
    onSortChanged(): void;
}

let listEl: HTMLElement | null = null;
let spacerEl: HTMLElement | null = null;
let sortBtnEl: HTMLButtonElement | null = null;
let sortMenu: ContextMenuInstance | null = null;

let servers: any[] = [];
let selectedKey: string | null = null;
let invalidationHooked = false;

const renderedRows = new Map<number, { el: HTMLElement; key: string; sig: string }>();
// #endregion



// #region ROWS
const rowSignature = (server: any): string => [
    server.players, server.maxPlayers, server.botPlayers, server.ping,
    server.map, server.name, server.bSecure, server.bPassword, server.geo?.countryCode,
].join('|');

function buildRowHTML(doc: Document, server: any, key: string, index: number): string {
    const empty = Number(server.players ?? 0) === 0;
    const showFavorite = getActiveTabId(doc) !== 'favorites';
    return `
        <div class="sbplus-ev-row${key === selectedKey ? ' selected' : ''}${empty ? ' sbplus-row-empty' : ''}" data-server-key="${escapeHtml(key)}" style="top:${index * LIST_ROW_HEIGHT}px;height:${LIST_ROW_HEIGHT}px">
            ${buildServerMeta(server, { rowFlags: { showFavorite } })}
        </div>`;
}

export function updateVisibleRows(): void {
    if (!listEl || !spacerEl) return;
    const doc = listEl.ownerDocument;
    const scrollTop = listEl.scrollTop;
    const viewportHeight = listEl.clientHeight || 0;

    const start = Math.max(0, Math.floor((scrollTop - LIST_OVERSCAN_PX) / LIST_ROW_HEIGHT));
    const end = Math.min(servers.length, Math.ceil((scrollTop + viewportHeight + LIST_OVERSCAN_PX) / LIST_ROW_HEIGHT));

    for (const [index, entry] of renderedRows) {
        if (index < start || index >= end) {
            entry.el.remove();
            renderedRows.delete(index);
        }
    }

    for (let index = start; index < end; index++) {
        const server = servers[index];
        const key = serverKey(server);
        const sig = rowSignature(server);
        const existing = renderedRows.get(index);
        if (existing) {
            if (existing.key === key && existing.sig === sig) continue;
            existing.el.remove();
        }

        const tmp = doc.createElement('div');
        tmp.innerHTML = buildRowHTML(doc, server, key, index);
        const el = tmp.firstElementChild as HTMLElement;
        spacerEl.appendChild(el);
        renderedRows.set(index, { el, key, sig });

        attachRowThumbFallback(el, server);
    }
}

function invalidateRows(): void {
    for (const { el } of renderedRows.values()) el.remove();
    renderedRows.clear();
    updateVisibleRows();
}

function hookRowInvalidation(): void {
    if (invalidationHooked) return;
    invalidationHooked = true;
    startFavoritesTracking();
    onFavoritesChanged(invalidateRows);
    onAlertsChanged(invalidateRows);
}

export function setListServers(nextServers: any[]): void {
    servers = nextServers;
    if (spacerEl) spacerEl.style.height = `${servers.length * LIST_ROW_HEIGHT}px`;
}

export function markSelectedRow(key: string | null): void {
    selectedKey = key;
    spacerEl?.querySelectorAll<HTMLElement>('.sbplus-ev-row').forEach((row) => {
        row.classList.toggle('selected', row.dataset.serverKey === key);
    });
}

export function scrollListToKey(key: string): void {
    if (!listEl) return;
    const index = servers.findIndex((server) => serverKey(server) === key);
    if (index < 0) return;

    const rowTop = index * LIST_ROW_HEIGHT;
    const viewTop = listEl.scrollTop;
    const viewHeight = listEl.clientHeight;

    if (rowTop >= viewTop && rowTop + LIST_ROW_HEIGHT <= viewTop + viewHeight) return;
    listEl.scrollTop = rowTop - (viewHeight / 2) + (LIST_ROW_HEIGHT / 2);
}
// #endregion



// #region SORT
export function updateSortButton(): void {
    if (!sortBtnEl) return;
    const { sortKey, sortDescending } = browserState;
    const label = SORT_OPTIONS.find((o) => o.key === sortKey)?.label ?? 'Players';
    sortBtnEl.innerHTML = `${label} ${sortDescending ? ICON_SORT_DESC : ICON_SORT_ASC}`;
    sortBtnEl.setAttribute('aria-label', `Sort by ${label.toLowerCase()}, ${sortDescending ? 'descending' : 'ascending'}`);
}

function closeSortMenu(): void {
    hideNativeMenu(sortMenu);
    sortMenu = null;
}

function openSortMenu(anchor: HTMLElement, onSortChanged: () => void): void {
    closeSortMenu();
    const entries: MenuEntry[] = SORT_OPTIONS.map((option) => {
        const active = option.key === browserState.sortKey;
        return {
            label: active ? `${option.label} ${browserState.sortDescending ? '↓' : '↑'}` : option.label,
            action: () => {
                if (active) {
                    browserState.sortDescending = !browserState.sortDescending;
                } else {
                    browserState.sortKey = option.key;
                    browserState.sortDescending = option.defaultDescending;
                }
                onSortChanged();
            },
        };
    });
    sortMenu = openNativeMenu(entries, anchor);
}
// #endregion



// #region LIFECYCLE
const rowFromEvent = (e: Event): HTMLElement | null =>
    (e.target as HTMLElement).closest<HTMLElement>('.sbplus-ev-row');

function serverFromRow(row: HTMLElement): any | null {
    const key = row.dataset.serverKey;
    return key ? serversMap.get(key) ?? null : null;
}

export function createListColumn(doc: Document, handlers: ListHandlers): HTMLElement {
    hookRowInvalidation();

    const sortBtn = doc.createElement('button');
    sortBtn.type = 'button';
    sortBtn.className = 'sbplus-ev-sortbtn';
    sortBtn.addEventListener('click', () => openSortMenu(sortBtn, handlers.onSortChanged));

    const sortBar = doc.createElement('div');
    sortBar.className = 'sbplus-ev-sortbar';
    sortBar.appendChild(sortBtn);

    const spacer = doc.createElement('div');
    spacer.className = 'sbplus-ev-spacer';

    const list = doc.createElement('div');
    list.className = 'sbplus-ev-list';
    list.appendChild(spacer);
    list.addEventListener('scroll', rafThrottle(doc.defaultView as Window, updateVisibleRows));
    list.addEventListener('click', (e) => {
        const row = rowFromEvent(e);
        const server = row && serverFromRow(row);
        if (server) handlers.onSelect(server, true);
    });
    list.addEventListener('contextmenu', (e) => {
        const row = rowFromEvent(e);
        if (!row) return;
        e.preventDefault();
        const server = serverFromRow(row);
        if (!server) return;
        handlers.onSelect(server, false);
        openServerMenu(doc, server, e);
    });

    const listCol = doc.createElement('div');
    listCol.className = 'sbplus-ev-listcol';
    listCol.appendChild(sortBar);
    listCol.appendChild(list);

    listEl = list;
    spacerEl = spacer;
    sortBtnEl = sortBtn;
    renderedRows.clear();
    updateSortButton();
    return listCol;
}

export function resetList(): void {
    closeSortMenu();
    renderedRows.clear();
    listEl = null;
    spacerEl = null;
    sortBtnEl = null;
}
// #endregion

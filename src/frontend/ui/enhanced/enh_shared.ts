import React from 'react';
import { constSysfsExpr, showContextMenu, Menu, MenuItem, ContextMenuInstance } from '@steambrew/client';
import { logToConsole, blockLocally, splitToSubnet24, isFavorite, startFavoritesTracking } from '../../shared';
import { escapeHtml, steamClient, serverKey, mapThumbUrl, UNKNOWN_THUMB_URL, getNativeServer, viewServerInfo, connectToServer } from '../ui_shared';
import { openAlertModal, getAlert, hasAlert } from '../alert';

// #region FLAG ICONS
const FLAG_FILES = constSysfsExpr({
    basePath: '../../../node_modules/flag-icons/flags/4x3',
    include: '*.svg',
    encoding: 'utf8',
});

const flagsByCountry = new Map<string, string>();
for (const file of FLAG_FILES) {
    flagsByCountry.set(file.fileName.replace(/\.svg$/i, '').toUpperCase(), file.content);
}

function getFlagSvg(countryCode: string | null): string | null {
    if (!countryCode) return null;
    return flagsByCountry.get(countryCode.toUpperCase()) ?? null;
}
// #endregion



// #region THUMBNAILS
const badThumbUrls = new Set<string>();

function applyFirstThumb(el: HTMLElement, urls: string[]): void {
    const url = urls.find((u) => !badThumbUrls.has(u));
    if (!url) return;
    const probe = el.ownerDocument.createElement('img');
    probe.onload = () => {
        el.style.backgroundImage = `url('${url}')`;
    };
    probe.onerror = () => {
        badThumbUrls.add(url);
        applyFirstThumb(el, urls);
    };
    probe.src = url;
}

export function attachRowThumbFallback(el: HTMLElement, server: any): void {
    applyFirstThumb(el, [mapThumbUrl(server), UNKNOWN_THUMB_URL]);
}
// #endregion



// #region SERVER CARD
const inlineIcon = (svg: string): string => svg
    .replace('<svg ', '<svg fill="currentColor" style="vertical-align:-2px" ')
    .replace('width="16" height="16"', 'width="12" height="12"');

const ICON_BOT = inlineIcon(constSysfsExpr('dependabot-16.svg', { basePath: '../../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content);
const ICON_SECURE = `<svg width="13" height="14" viewBox="0 0 13 14" fill="none"><path d="M6.5 0.5 12 2.6v3.6c0 3.7-2.4 6.4-5.5 7-3.1-.6-5.5-3.3-5.5-7V2.6L6.5.5Z" fill="#aaaaaa"/><path d="M4 7l1.7 1.7L9 5.3" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
const ICON_LOCKED = `<svg width="11" height="13" viewBox="0 0 11 13" fill="none"><rect x="1" y="5.5" width="9" height="6.5" rx="1.3" fill="#e6a20d"/><path d="M2.8 5.5V3.6a2.7 2.7 0 0 1 5.4 0v1.9" stroke="#e6a20d" stroke-width="1.3" fill="none"/></svg>`;
const ICON_STAR = `<svg width="11" height="11" viewBox="0 0 16 16"><title>Favorite</title><path d="M8 1.2l2.1 4.4 4.8.6-3.5 3.3.9 4.8L8 12l-4.3 2.3.9-4.8L1.1 6.2l4.8-.6z" fill="#e6c34a"/></svg>`;
const ICON_BELL = `<svg width="11" height="11" viewBox="0 0 16 16"><title>Alert set</title><path d="M8 1.5a4 4 0 0 0-4 4v2.6L2.6 10.5V12h10.8v-1.5L12 8.1V5.5a4 4 0 0 0-4-4zM6.5 13a1.5 1.5 0 0 0 3 0z" fill="#8ec5ff"/></svg>`;

const TIER_COLORS = { good: '#4cec0d', fair: '#c3e60d', poor: '#e6a20d', bad: '#fc3737' };
const PING_BAR_HEIGHTS = [4, 7, 10, 13];
const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function serverStats(server: any) {
    return {
        map: server.map ?? 'unknown',
        ping: Number(server.ping ?? 0),
        players: Number(server.players ?? 0),
        maxPlayers: Number(server.maxPlayers ?? 0),
        botPlayers: Number(server.botPlayers ?? 0),
        flagSvg: getFlagSvg(server.geo?.countryCode ?? null),
    };
}

function formatMapName(map: string): string {
    const m = map.match(/^([a-z0-9]{1,4}_)(.+)$/i);
    return m ? `<span class="sbplus-map-prefix">${escapeHtml(m[1])}</span>${escapeHtml(m[2])}` : escapeHtml(map);
}

function buildRowFlags(server: any, showFavorite: boolean): string {
    const key = serverKey(server);
    const flags = (hasAlert(key) ? ICON_BELL : '') + (showFavorite && isFavorite(key) ? ICON_STAR : '');
    return flags ? `<span class="sbplus-ev-flags">${flags}</span>` : '';
}

function buildBadges(server: any): string {
    let badges = '';
    if (server.bSecure) badges += `<span class="sbplus-badge" title="VAC secured">${ICON_SECURE}</span>`;
    if (server.bPassword) badges += `<span class="sbplus-badge" title="Password protected">${ICON_LOCKED}</span>`;
    return badges;
}

function pingTier(ping: number): { bars: number; color: string } {
    if (ping <= 50) return { bars: 4, color: TIER_COLORS.good };
    if (ping <= 100) return { bars: 3, color: TIER_COLORS.fair };
    if (ping <= 150) return { bars: 2, color: TIER_COLORS.poor };
    return { bars: 1, color: TIER_COLORS.bad };
}

function buildPingBars(ping: number): string {
    const { bars, color } = pingTier(ping);
    const rects = PING_BAR_HEIGHTS.map((h, i) => {
        const fill = i < bars ? color : 'rgba(255,255,255,0.15)';
        return `<rect x="${i * 5}" y="${13 - h}" width="3" height="${h}" rx="0.5" fill="${fill}"></rect>`;
    }).join('');
    return `<svg width="17" height="13" viewBox="0 0 17 13" style="flex-shrink:0">${rects}</svg>`;
}

function buildPlayerRing(players: number, maxPlayers: number): string {
    const ratio = maxPlayers > 0 ? Math.min(1, players / maxPlayers) : 0;
    const color = ratio >= 1 ? TIER_COLORS.bad : ratio >= 0.75 ? TIER_COLORS.good : ratio >= 0.4 ? TIER_COLORS.fair : TIER_COLORS.poor;
    const arc = ratio > 0
        ? `<circle cx="8" cy="8" r="${RING_RADIUS}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="${(ratio * RING_CIRCUMFERENCE).toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}" transform="rotate(-90 8 8)"></circle>`
        : '';
    return `<svg width="16" height="16" viewBox="0 0 16 16" style="flex-shrink:0"><title>${players}/${maxPlayers} players</title>` +
        `<circle cx="8" cy="8" r="${RING_RADIUS}" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="2.6"></circle>${arc}</svg>`;
}

function buildPlayers(players: number, maxPlayers: number, botPlayers: number): string {
    const base = `${buildPlayerRing(players, maxPlayers)}${players}/${maxPlayers}`;
    return botPlayers > 0 ? `${base} · ${botPlayers} ${ICON_BOT}` : base;
}

export function buildServerMeta(server: any, opts: { location?: boolean; rowFlags?: { showFavorite: boolean } } = {}): string {
    const { map, ping, players, maxPlayers, botPlayers, flagSvg } = serverStats(server);
    const name = escapeHtml(String(server.name ?? ''));
    const geo = server.geo;
    const locationText = opts.location && geo
        ? [geo.cityName, geo.subdivisionName, geo.countryName].filter(Boolean).join(', ')
        : '';

    return `
        <div class="sbplus-ev-meta">
            <div class="sbplus-ev-titlerow">
                <span class="sbplus-ev-title" title="${escapeHtml(map)}">${formatMapName(map)}</span>
                ${opts.rowFlags ? buildRowFlags(server, opts.rowFlags.showFavorite) : ''}
            </div>
            <span class="sbplus-ev-sub" title="${name}">${buildBadges(server)}${name}</span>
            ${locationText ? `<span class="sbplus-ev-sub">${escapeHtml(locationText)}</span>` : ''}
            <div class="sbplus-ev-stats">
                <span class="sbplus-ev-ping-stat">${flagSvg ? `<span class="sbplus-ev-flag">${flagSvg}</span>` : ''}${buildPingBars(ping)}${server.ping ?? '?'} ms</span>
                <span>${buildPlayers(players, maxPlayers, botPlayers)}</span>
            </div>
        </div>`;
}
// #endregion



// #region SERVER ACTIONS
function copyToClipboard(doc: Document, text: string): void {
    doc.defaultView?.navigator.clipboard?.writeText(text)
        ?.catch((err) => logToConsole('VIEW', `Clipboard write failed -> ${err}`, 'Error'));
}

function toggleFavorite(doc: Document, server: any, favorited: boolean): void {
    const target = getNativeServer(doc, serverKey(server)) ?? server;
    if (favorited) steamClient().ServerBrowser.RemoveFavoriteServer(target);
    else steamClient().ServerBrowser.AddFavoriteServer(target);
}

export function runMenuAction(label: string, action: () => void | Promise<void>): void {
    try {
        const result = action();
        if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch((err) => logToConsole('VIEW', `'${label}' failed -> ${err}`, 'Error'));
        }
    } catch (err) {
        logToConsole('VIEW', `'${label}' failed -> ${err}`, 'Error');
    }
}
// #endregion



// #region CONTEXT MENU
export type MenuEntry = { label: string; action: () => void | Promise<void> };

let activeMenu: ContextMenuInstance | null = null;

export function openNativeMenu(entries: MenuEntry[], target: MouseEvent | HTMLElement): ContextMenuInstance | null {
    const children = entries.map((entry, i) =>
        React.createElement(MenuItem, { key: i, onSelected: () => runMenuAction(entry.label, entry.action) }, entry.label));
    return showContextMenu(React.createElement(Menu, { label: 'Menu' }, children), target as unknown as EventTarget) ?? null;
}

export function hideNativeMenu(menu: ContextMenuInstance | null): void {
    try { menu?.Hide(); } catch { }
}

export function closeServerMenu(): void {
    hideNativeMenu(activeMenu);
    activeMenu = null;
}

export function openServerMenu(doc: Document, server: any, event: MouseEvent): void {
    closeServerMenu();
    startFavoritesTracking();
    if (!steamClient()?.ServerBrowser) {
        logToConsole('VIEW', 'SteamClient.ServerBrowser unavailable, context menu actions will not work', 'Error');
    }
    const addr = serverKey(server);
    const subnet = splitToSubnet24(server.ip);
    const favorited = isFavorite(addr);

    activeMenu = openNativeMenu([
        { label: 'View server info', action: () => viewServerInfo(server) },
        { label: 'Connect to server', action: () => connectToServer(server) },
        { label: `Copy '${addr}' to clipboard`, action: () => copyToClipboard(doc, addr) },
        { label: 'Copy link to clipboard', action: () => copyToClipboard(doc, `steam://connect/${addr}`) },
        { label: favorited ? 'Remove server from favorites' : 'Add server to favorites', action: () => toggleFavorite(doc, server, favorited) },
        { label: getAlert(addr) ? 'Edit server alert...' : 'Set server alert...', action: () => openAlertModal(doc, server) },
        { label: `Block IP (${server.ip})`, action: () => blockLocally(server.ip) },
        { label: `Block subnet (${subnet})`, action: () => blockLocally(subnet) },
    ], event);
}
// #endregion

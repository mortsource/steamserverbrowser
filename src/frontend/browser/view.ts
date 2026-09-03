import { constSysfsExpr } from '@steambrew/client';
import * as L from 'leaflet';
import 'leaflet.markercluster';
import { logToConsole, serversMap } from '../shared';
import { browserState, onDocumentReady, onMapTileConfigChanged, buildBadges, buildPingBars, buildPlayerBar, playersLine, escapeHtml, attachThumbFallback, getFlagSvg, getNativeFilteredKeys, getNativeServer, getActiveTabId, rafThrottle } from './ui_shared';
import { getMapTileConfig } from './settings';
import { CSGO_APP_ID } from './gameselect';

// CONFIGURATION ————————————————————————————————————————————————————————————
const leafletCss = constSysfsExpr('leaflet.css', { basePath: '../../node_modules/leaflet/dist', encoding: 'utf8' });
const clusterCssFiles = constSysfsExpr({ basePath: '../../node_modules/leaflet.markercluster/dist', include: 'MarkerCluster*.css', encoding: 'utf8' });
const ICON_GLOBE = constSysfsExpr('globe-16.svg', { basePath: '../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content;
const SORT_ICON_DESC = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 3l4 4 4-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SORT_ICON_ASC = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 7l4-4 4 4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const LIST_ROW_HEIGHT = 78, LIST_OVERSCAN_PX = LIST_ROW_HEIGHT * 12, LIST_WIDTH = 300, SELECT_ZOOM = 13;
const AD_IMAGE_URL = 'https://purecsgo.com/assets/dynamic/images/elements/plugin-ad.png';

const WORLD_BOUNDS = L.latLngBounds([-85, -180], [85, 180]);
const DEFAULT_CENTER: L.LatLngExpression = [20, 0];
const DEFAULT_ZOOM = 2;



// STATE ————————————————————————————————————————————————————————————————————
let rootEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let spacerEl: HTMLElement | null = null;
let tableEl: HTMLElement | null = null;
let mapInstance: L.Map | null = null;
let tileLayerInstance: L.TileLayer | null = null;
let markerLayer: L.MarkerClusterGroup | null = null;
let markersByKey = new Map<string, L.Marker>();
let resizeObserver: ResizeObserver | null = null;
let mapIsDragging = false;

let servers: any[] = [];
let selectedKey: string | null = null;
let renderedRows = new Map<number, { el: HTMLElement; key: string }>();
let loggedMissing = new Set<string>();
let ctxMenuEl: HTMLElement | null = null;
let ctxMenuCleanup: (() => void) | null = null;
let favoriteKeys = new Set<string>();
let favoritesTrackingStarted = false;
let connectBtnEl: HTMLElement | null = null;
let connectBtnEnabledByUs = false;
let connectClickHooked = false;
let sortBtnEl: HTMLButtonElement | null = null;
let adImgEl: HTMLImageElement | null = null;



// HELPERS ————————————————————————————————————————————————————————————————————
function serverKey(server: any): string {
    return `${server.ip}:${server.port}`;
}

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



// STYLES ————————————————————————————————————————————————————————————————————
function ensureStyles(doc: Document): void {
    if (doc.getElementById('sbplus-ev-style')) return;
    const s = doc.createElement('style');
    s.id = 'sbplus-ev-style';
    s.textContent = `
        ${leafletCss.content}
        ${clusterCssFiles.map((f) => f.content).join('\n')}

        /* Layout ———————————————————————————————————————————— */
        .sbplus-ev-active [role="table"] { visibility: hidden !important; pointer-events: none !important; }
        .sbplus-ev-container { display: none; position: absolute; z-index: 1; background: #1b1b1b; -webkit-app-region: no-drag; }
        .sbplus-ev-active .sbplus-ev-container { display: flex; }
        .sbplus-ev-listcol {
            width: ${LIST_WIDTH}px; flex-shrink: 0; display: flex; flex-direction: column;
            min-height: 0; border-right: 1px solid rgba(255,255,255,0.08); -webkit-app-region: no-drag;
        }
        .sbplus-ev-sortbar {
            display: flex; align-items: center; gap: 6px; flex-shrink: 0;
            padding: 6px 10px; background: #1b1b1b;
            border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .sbplus-ev-sortbtn {
            display: inline-flex; align-items: center; gap: 5px;
            background: transparent; border: 1px solid rgba(255,255,255,0.15);
            border-radius: 4px; padding: 3px 8px; font-size: 11px;
            color: rgba(255,255,255,0.75); cursor: pointer;
        }
        .sbplus-ev-sortbtn:hover { color: #fff; border-color: rgba(255,255,255,0.3); }
        .sbplus-ev-sortbtn svg { display: block; flex-shrink: 0; }
        .sbplus-ev-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; background: #1a1a1a; position: relative; }
        .sbplus-ev-spacer { position: relative; width: 100%; }
        .sbplus-ev-map { flex: 1 1 auto; min-width: 0; position: relative; -webkit-app-region: no-drag; }
        .sbplus-ev-resetview a { display: flex !important; align-items: center; justify-content: center; width: 30px; height: 30px; color: #333; }
        .sbplus-ev-resetview a svg { width: 16px; height: 16px; display: block; }
        .sbplus-ev-resetview a svg path { fill: currentColor; }
        .sbplus-ev-map .leaflet-container { background: #0e0e0e; }

        /* Server card — shared by list rows and map tooltips ——— */
        .sbplus-ev-row {
            display: flex; align-items: center; gap: 10px; padding: 8px 12px;
            cursor: pointer; box-shadow: inset 0 -1px 0 rgba(255,255,255,0.07);
            position: absolute; left: 0; right: 0; box-sizing: border-box;
            overflow: hidden; background: #000 center / cover no-repeat;
        }
        .sbplus-ev-row::before {
            content: ''; position: absolute; inset: 0; pointer-events: none;
            background: linear-gradient(90deg, rgba(10,12,15,0.94) 0%, rgba(10,12,15,0.84) 50%, rgba(10,12,15,0.66) 100%);
            transition: background 120ms ease;
        }
        .sbplus-ev-row:hover::before { background: linear-gradient(90deg, rgba(12,15,19,0.72) 0%, rgba(12,15,19,0.48) 50%, rgba(12,15,19,0.20) 100%); }
        .sbplus-ev-row.selected { box-shadow: inset 4px 0 0 #cccccc, inset 0 -1px 0 rgba(255,255,255,0.07); }
        .sbplus-ev-row.selected::before { background: linear-gradient(90deg, rgba(14,18,24,0.50) 0%, rgba(14,18,24,0.24) 45%, rgba(14,18,24,0.04) 100%); }
        .sbplus-ev-row > * { position: relative; z-index: 1; }
        .sbplus-ev-row .sbplus-ev-title,
        .sbplus-ev-row .sbplus-ev-sub,
        .sbplus-ev-row .sbplus-ev-stats {
            text-shadow: 0 1px 2px rgba(0,0,0,0.95), 0 0 7px rgba(0,0,0,0.75);
        }
        .sbplus-ev-row:hover .sbplus-ev-title,
        .sbplus-ev-row:hover .sbplus-ev-sub,
        .sbplus-ev-row:hover .sbplus-ev-stats,
        .sbplus-ev-row.selected .sbplus-ev-title,
        .sbplus-ev-row.selected .sbplus-ev-sub,
        .sbplus-ev-row.selected .sbplus-ev-stats {
            color: #fff; opacity: 1;
            text-shadow: 0 1px 2px rgba(0,0,0,1), 0 0 8px rgba(0,0,0,0.9), 0 0 16px rgba(0,0,0,0.55);
        }
        .sbplus-ev-meta, .sbplus-ev-tooltip-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
        .sbplus-ev-tooltip-thumb {
            flex-shrink: 0; border-radius: 3px; object-fit: cover; display: block;
            background: #222; opacity: 0; transition: opacity 120ms ease;
            width: 90px; height: 68px;
        }
        .sbplus-ev-tooltip-thumb.sbplus-thumb-loaded { opacity: 1; }
        .sbplus-ev-tooltip-thumb.sbplus-thumb-empty {
            object-fit: initial; opacity: 1;
            background: repeating-linear-gradient(45deg, #222, #222 8px, #262626 8px, #262626 16px);
        }
        .sbplus-badge { display: inline-flex; align-items: center; margin-right: 5px; vertical-align: middle; flex-shrink: 0; }
        .sbplus-ev-title, .sbplus-ev-tooltip-title {
            font-weight: 600; font-size: 13px; text-transform: uppercase;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .sbplus-ev-sub, .sbplus-ev-tooltip-sub {
            font-size: 12px; opacity: 0.72;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .sbplus-ev-stats, .sbplus-ev-tooltip-stats { display: flex; align-items: center; gap: 10px; margin-top: 2px; }
        .sbplus-ev-stats { opacity: 0.85; }
        .sbplus-ev-stats > span, .sbplus-ev-tooltip-stats > span { display: flex; align-items: center; gap: 5px; font-size: 12px; }
        .sbplus-ev-ping-stat { min-width: 84px; }
        .sbplus-ev-flag { display: inline-block; width: 16px; height: 12px; border-radius: 2px; overflow: hidden; flex-shrink: 0; }
        .sbplus-ev-flag svg { width: 100%; height: 100%; display: block; }

        /* Map markers + tooltip chrome ————————————————————————— */
        .sbplus-ev-marker { display: flex; align-items: center; justify-content: center; }
        .sbplus-ev-dot {
            width: 10px; height: 10px; border-radius: 50%;
            background: #8f8f8f; border: 1px solid rgba(255,255,255,0.7);
            box-sizing: border-box; transition: transform 120ms ease, background 120ms ease;
        }
        .sbplus-ev-marker.selected .sbplus-ev-dot { background: #f0f0f0; transform: scale(1.6); }
        .sbplus-ev-tooltip.leaflet-tooltip {
            background: #1e1e1e; border: 1px solid rgba(255,255,255,0.12);
            border-radius: 6px; color: #dddddd; padding: 0; opacity: 1;
        }
        .sbplus-ev-tooltip.leaflet-tooltip::before { display: none; }
        .sbplus-ev-tooltip-content { display: flex; gap: 10px; padding: 8px; width: 320px; }

        /* Cluster bubbles: blue concentration scale, distinct from the ping-tier
           green/yellow/orange/red language used elsewhere in the UI. */
        .marker-cluster-small { background-color: rgba(147,197,253,0.45); }
        .marker-cluster-small div { background-color: rgba(96,165,250,0.85); }
        .marker-cluster-medium { background-color: rgba(59,130,246,0.45); }
        .marker-cluster-medium div { background-color: rgba(37,99,235,0.9); }
        .marker-cluster-large { background-color: rgba(30,58,138,0.5); }
        .marker-cluster-large div { background-color: rgba(15,35,90,0.95); }
        .marker-cluster span { color: #fff; }

        /* Cluster legend ——————————————————————————————————————— */
        .sbplus-ev-clusterlegend {
            background: #1a1a1a; border: 1px solid rgba(255,255,255,0.12); border-radius: 6px;
            padding: 6px 10px; font-size: 11px; color: #dddddd; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        }
        .sbplus-ev-clusterlegend-title { font-weight: 600; margin-bottom: 4px; color: #fff; }
        .sbplus-ev-clusterlegend-row { display: flex; align-items: center; gap: 6px; padding: 1px 0; white-space: nowrap; }
        .sbplus-ev-clusterlegend-swatch { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .sbplus-ev-clusterlegend-small { background: rgba(96,165,250,0.85); }
        .sbplus-ev-clusterlegend-medium { background: rgba(37,99,235,0.9); }
        .sbplus-ev-clusterlegend-large { background: rgba(15,35,90,0.95); }

        /* Ad overlay ———————————————————————————————————————————— */
        .sbplus-ev-ad-link { display: contents; }
        .sbplus-ev-ad {
            position: absolute; top: 10px; right: 10px; z-index: 500;
            width: auto; height: auto;
            max-width: min(240px, 22%); max-height: min(96px, 24%);
            display: none; object-fit: contain; cursor: pointer;
            border-radius: 3px; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        }

        /* Context menu ————————————————————————————————————————— */
        .sbplus-ev-ctxmenu {
            position: fixed; z-index: 2000; background: #1a1a1a;
            border: 1px solid rgba(255,255,255,0.12); border-radius: 4px; padding: 4px 0;
            min-width: 200px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
            font-size: 13px; color: #dddddd;
        }
        .sbplus-ev-ctxmenu-item { padding: 7px 14px; cursor: pointer; white-space: nowrap; }
        .sbplus-ev-ctxmenu-item:hover { background: rgba(255,255,255,0.08); }
        .sbplus-ev-ctxmenu-sep { height: 1px; background: rgba(255,255,255,0.08); margin: 4px 0; }
    `;
    doc.head.appendChild(s);
}



// MAP ————————————————————————————————————————————————————————————————————————
function applyWorldCoverZoom(map: L.Map): void {
    let min: number;
    try {
        const zoom = map.getBoundsZoom(WORLD_BOUNDS, true);
        min = Number.isFinite(zoom) ? zoom : DEFAULT_ZOOM;
    } catch {
        min = DEFAULT_ZOOM;
    }
    if (map.getMinZoom() !== min) map.setMinZoom(min);
    if (map.getZoom() < min) map.setZoom(min);
}

function resetMapView(): void {
    if (!mapInstance) return;
    applyWorldCoverZoom(mapInstance);
    mapInstance.setView(DEFAULT_CENTER, mapInstance.getMinZoom());
}

function applyMapTileLayer(map: L.Map): void {
    const { url, attribution, maxZoom } = getMapTileConfig();
    if (tileLayerInstance) map.removeLayer(tileLayerInstance);

    tileLayerInstance = L.tileLayer(url, {
        attribution,
        maxZoom,
        noWrap: true,
        bounds: WORLD_BOUNDS,
    }).addTo(map);
}

onMapTileConfigChanged(() => { if (mapInstance) applyMapTileLayer(mapInstance); });

function ensureMap(container: HTMLElement): L.Map {
    if (mapInstance) return mapInstance;

    const doc = container.ownerDocument;

    mapInstance = L.map(container, {
        worldCopyJump: false,
        dragging: true,
        maxBounds: WORLD_BOUNDS,
        maxBoundsViscosity: 1.0,
        minZoom: DEFAULT_ZOOM,
        zoomControl: true,
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    mapInstance.dragging.enable();

    mapInstance.on('dragstart', () => { mapIsDragging = true; });
    mapInstance.on('dragend', () => { mapIsDragging = false; });

    const draggable = (mapInstance.dragging as any)._draggable;
    if (draggable) {
        draggable.on('down', () => {
            const onMove = (e: MouseEvent) => draggable._onMove(e);
            const onUp = (e: MouseEvent) => {
                draggable._onUp(e);
                doc.removeEventListener('mousemove', onMove);
                doc.removeEventListener('mouseup', onUp);
            };
            doc.addEventListener('mousemove', onMove);
            doc.addEventListener('mouseup', onUp);
        });
    } else {
        logToConsole('Enhanced View: dragging._draggable not found, panning fix not applied', 'Warn');
    }

    applyMapTileLayer(mapInstance);

    const ResetViewControl = L.Control.extend({
        options: { position: 'topleft' as L.ControlPosition },
        onAdd() {
            const bar = L.DomUtil.create('div', 'leaflet-bar sbplus-ev-resetview');
            const btn = L.DomUtil.create('a', '', bar) as HTMLAnchorElement;
            btn.href = '#';
            btn.title = 'Zoom out to world';
            btn.setAttribute('role', 'button');
            btn.innerHTML = ICON_GLOBE;
            L.DomEvent.on(btn, 'click', (e: Event) => {
                L.DomEvent.stop(e);
                resetMapView();
            });
            L.DomEvent.disableClickPropagation(bar);
            return bar;
        },
    });
    mapInstance.addControl(new ResetViewControl());

    const ClusterLegendControl = L.Control.extend({
        options: { position: 'bottomleft' as L.ControlPosition },
        onAdd() {
            const box = L.DomUtil.create('div', 'sbplus-ev-clusterlegend');
            box.innerHTML = `
                <div class="sbplus-ev-clusterlegend-title">Servers</div>
                <div class="sbplus-ev-clusterlegend-row"><span class="sbplus-ev-clusterlegend-swatch sbplus-ev-clusterlegend-small"></span>&lt; 10</div>
                <div class="sbplus-ev-clusterlegend-row"><span class="sbplus-ev-clusterlegend-swatch sbplus-ev-clusterlegend-medium"></span>10–99</div>
                <div class="sbplus-ev-clusterlegend-row"><span class="sbplus-ev-clusterlegend-swatch sbplus-ev-clusterlegend-large"></span>100+</div>
            `;
            L.DomEvent.disableClickPropagation(box);
            return box;
        },
    });
    mapInstance.addControl(new ClusterLegendControl());

    mapInstance.whenReady(() => { if (mapInstance) applyWorldCoverZoom(mapInstance); });
    mapInstance.on('resize', () => { if (mapInstance) applyWorldCoverZoom(mapInstance); });

    markerLayer = L.markerClusterGroup({
        maxClusterRadius: 60,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        disableClusteringAtZoom: 15,
        chunkedLoading: true,
    }).addTo(mapInstance);

    return mapInstance;
}



// LAYOUT ————————————————————————————————————————————————————————————————————
function syncBounds(): void {
    if (!rootEl || !tableEl || mapIsDragging) return;
    const container = rootEl.parentElement;
    if (!container) return;

    const tableRect = tableEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const top = `${tableRect.top - containerRect.top}px`;
    const left = `${tableRect.left - containerRect.left}px`;
    const width = `${tableRect.width}px`;
    const height = `${tableRect.height}px`;

    const changed = rootEl.style.top !== top || rootEl.style.left !== left || rootEl.style.width !== width || rootEl.style.height !== height;
    if (!changed) return;

    rootEl.style.top = top;
    rootEl.style.left = left;
    rootEl.style.width = width;
    rootEl.style.height = height;
    mapInstance?.invalidateSize();
    updateVisibleRows(rootEl.ownerDocument);
}

function observeResize(doc: Document, table: HTMLElement): void {
    const win = doc.defaultView as any;
    if (!win?.ResizeObserver) return;

    if (!resizeObserver) {
        resizeObserver = new win.ResizeObserver(() => syncBounds());
    } else {
        resizeObserver.disconnect();
    }
    resizeObserver.observe(table);
}



// MARKERS & TOOLTIPS ——————————————————————————————————————————————————————————
function buildTooltipContent(doc: Document, server: any): HTMLElement {
    const { map, ping, players, maxPlayers, botPlayers, flagSvg } = serverStats(server);
    const thumbUrl = `./serverbrowserplus/images/maps/${server.appid}/${encodeURIComponent(map)}.jpg`;
    const geo = server.geo;
    const locationText = geo
        ? [geo.cityName, geo.subdivisionName, geo.countryName].filter(Boolean).join(', ')
        : null;

    const wrap = doc.createElement('div');
    wrap.className = 'sbplus-ev-tooltip-content';
    wrap.innerHTML = `
        <img class="sbplus-ev-tooltip-thumb" src="${escapeHtml(thumbUrl)}">
        <div class="sbplus-ev-tooltip-body">
            <span class="sbplus-ev-tooltip-title">${escapeHtml(map)}</span>
            <span class="sbplus-ev-tooltip-sub">${buildBadges(server)}${escapeHtml(String(server.name ?? ''))}</span>
            ${locationText ? `<span class="sbplus-ev-tooltip-sub">${escapeHtml(locationText)}</span>` : ''}
            <div class="sbplus-ev-tooltip-stats">
                <span class="sbplus-ev-ping-stat">${flagSvg ? `<span class="sbplus-ev-flag">${flagSvg}</span>` : ''}${buildPingBars(ping)}${server.ping ?? '?'} ms</span>
                <span>${buildPlayerBar(players, maxPlayers, 50)}${playersLine(players, maxPlayers, botPlayers)}</span>
            </div>
        </div>`;

    attachThumbFallback(wrap.querySelector('.sbplus-ev-tooltip-thumb') as HTMLImageElement);

    return wrap;
}

function syncMarkers(doc: Document): void {
    if (!markerLayer) return;
    const nextKeys = new Set(servers.map(serverKey));

    const toRemove: L.Marker[] = [];
    for (const [key, marker] of markersByKey) {
        if (!nextKeys.has(key)) {
            toRemove.push(marker);
            markersByKey.delete(key);
        }
    }
    if (toRemove.length) markerLayer.removeLayers(toRemove);

    const toAdd: L.Marker[] = [];
    for (const server of servers) {
        const key = serverKey(server);
        if (markersByKey.has(key)) continue;

        const geo = server.geo;
        if (!geo || geo.latitude == null || geo.longitude == null) continue;

        const marker = L.marker([geo.latitude, geo.longitude], {
            icon: L.divIcon({ className: 'sbplus-ev-marker', html: '<span class="sbplus-ev-dot"></span>', iconSize: [22, 22] }),
        });

        marker.bindTooltip(() => buildTooltipContent(doc, serversMap.get(key) ?? server), {
            className: 'sbplus-ev-tooltip',
            direction: 'top',
            offset: [0, -6],
        });

        marker.on('click', () => {
            const current = serversMap.get(key);
            if (current) selectFromMap(current);
        });
        marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
            L.DomEvent.stop(e);
            const current = serversMap.get(key);
            if (!current) return;
            selectFromMap(current);
            showContextMenu(doc, current, e.originalEvent.clientX, e.originalEvent.clientY);
        });

        markersByKey.set(key, marker);
        toAdd.push(marker);
    }
    if (toAdd.length) markerLayer.addLayers(toAdd);

    if (selectedKey) {
        const marker = markersByKey.get(selectedKey);
        if (marker) marker.getElement()?.classList.add('selected');
        else selectedKey = null;
    }
}



// VIRTUAL LIST ——————————————————————————————————————————————————————————————
function buildRowHTML(server: any, key: string, index: number): string {
    const { map, ping, players, maxPlayers, botPlayers, flagSvg } = serverStats(server);
    const mapArt = `./serverbrowserplus/images/maps/${server.appid}/${encodeURIComponent(map)}.jpg`;

    return `
        <div class="sbplus-ev-row${key === selectedKey ? ' selected' : ''}" data-server-key="${escapeHtml(key)}" style="top:${index * LIST_ROW_HEIGHT}px;height:${LIST_ROW_HEIGHT}px;background-image:url('${mapArt}')">
            <div class="sbplus-ev-meta">
                <span class="sbplus-ev-title">${escapeHtml(map)}</span>
                <span class="sbplus-ev-sub">${buildBadges(server)}${escapeHtml(String(server.name ?? ''))}</span>
                <div class="sbplus-ev-stats">
                    <span class="sbplus-ev-ping-stat">${flagSvg ? `<span class="sbplus-ev-flag">${flagSvg}</span>` : ''}${buildPingBars(ping)}${server.ping ?? '?'} ms</span>
                    <span>${buildPlayerBar(players, maxPlayers, 40)}${playersLine(players, maxPlayers, botPlayers)}</span>
                </div>
            </div>
        </div>`;
}

function updateVisibleRows(doc: Document): void {
    if (!listEl || !spacerEl) return;
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
        const existing = renderedRows.get(index);
        if (existing) {
            if (existing.key === key) continue;
            existing.el.remove();
        }

        const tmp = doc.createElement('div');
        tmp.innerHTML = buildRowHTML(server, key, index);
        const el = tmp.firstElementChild as HTMLElement;
        spacerEl.appendChild(el);
        renderedRows.set(index, { el, key });
    }
}

function scrollListToKey(key: string): void {
    if (!listEl) return;
    const index = servers.findIndex((s) => serverKey(s) === key);
    if (index < 0) return;

    const rowTop = index * LIST_ROW_HEIGHT;
    const viewTop = listEl.scrollTop;
    const viewHeight = listEl.clientHeight;

    if (rowTop >= viewTop && rowTop + LIST_ROW_HEIGHT <= viewTop + viewHeight) return;
    listEl.scrollTop = rowTop - (viewHeight / 2) + (LIST_ROW_HEIGHT / 2);
}



// SELECTION ————————————————————————————————————————————————————————————————
function applySelection(server: any, panMap: boolean, scrollList: boolean): void {
    const key = serverKey(server);
    const prevKey = selectedKey;
    selectedKey = key;

    if (prevKey && prevKey !== key) {
        const prevMarker = markersByKey.get(prevKey);
        prevMarker?.closeTooltip();
        prevMarker?.getElement()?.classList.remove('selected');
    }

    const marker = markersByKey.get(key);
    if (marker) {
        const reveal = () => {
            marker.getElement()?.classList.add('selected');
            marker.openTooltip();
            if (panMap && mapInstance) {
                mapInstance.flyTo(marker.getLatLng(), Math.max(mapInstance.getZoom(), SELECT_ZOOM), { duration: 0.6 });
            }
        };

        if (panMap && markerLayer && markerLayer.getVisibleParent(marker) !== marker) {
            markerLayer.zoomToShowLayer(marker, reveal);
        } else {
            reveal();
        }
    }

    spacerEl?.querySelectorAll<HTMLElement>('.sbplus-ev-row').forEach((row) => {
        row.classList.toggle('selected', row.dataset.serverKey === selectedKey);
    });
    if (scrollList) scrollListToKey(key);

    const doc = spacerEl?.ownerDocument;
    if (doc) syncConnectButton(doc);
}

function selectFromList(server: any): void {
    applySelection(server, true, false);
}

function selectFromMap(server: any): void {
    applySelection(server, false, true);
}



// CONTEXT MENU ——————————————————————————————————————————————————————————————
function startFavoritesTracking(): void {
    if (favoritesTrackingStarted) return;
    const SC = (window as any).SteamClient;
    if (!SC?.ServerBrowser?.RegisterForFavorites) return;
    favoritesTrackingStarted = true;
    SC.ServerBrowser.RegisterForFavorites((list: any) => {
        favoriteKeys = new Set((list?.favorites ?? []).map(serverKey));
    });
}

function closeContextMenu(): void {
    if (!ctxMenuEl) return;
    ctxMenuEl.remove();
    ctxMenuEl = null;
    ctxMenuCleanup?.();
    ctxMenuCleanup = null;
}

function copyToClipboard(doc: Document, text: string): void {
    doc.defaultView?.navigator.clipboard?.writeText(text)
        ?.catch((err) => logToConsole(`Enhanced View: clipboard write failed -> ${err}`, 'Error'));
}

async function openGameInfoDialog(SC: any, server: any): Promise<number> {
    return SC.ServerBrowser.CreateServerGameInfoDialog(0, server.ip, server.port, server.queryPort, server.appid);
}

async function connectToServer(server: any): Promise<void> {
    const SC = (window as any).SteamClient;
    const dialogId = await openGameInfoDialog(SC, server);

    await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            reg?.unregister?.();
            resolve();
        };
        const reg = SC.ServerBrowser.RegisterForServerInfo(dialogId, (info: any) => {
            if (info?.bHadSuccessfulResponse) finish();
        });
        SC.ServerBrowser.PingServer(dialogId);
        setTimeout(finish, 5000);
    });

    try {
        await SC.ServerBrowser.ConnectToServer(dialogId, '');
    } finally {
        SC.ServerBrowser.DestroyGameInfoDialog(dialogId);
    }
}

function runMenuAction(label: string, action: () => void | Promise<void>): void {
    try {
        const result = action();
        if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch((err) => logToConsole(`Enhanced View: '${label}' failed -> ${err}`, 'Error'));
        }
    } catch (err) {
        logToConsole(`Enhanced View: '${label}' failed -> ${err}`, 'Error');
    }
}

function showContextMenu(doc: Document, server: any, clientX: number, clientY: number): void {
    closeContextMenu();
    startFavoritesTracking();
    const SC = (window as any).SteamClient;
    if (!SC?.ServerBrowser) {
        logToConsole('Enhanced View: SteamClient.ServerBrowser unavailable, context menu actions will not work', 'Error');
    }
    const addr = serverKey(server);
    const isFavorite = favoriteKeys.has(addr);

    const items: Array<{ label: string; action: () => void | Promise<void> } | null> = [
        {
            label: 'View server info', action: async () => {
                const dialogId = await openGameInfoDialog(SC, server);
                SC.ServerBrowser.PingServer(dialogId);
            },
        },
        { label: 'Connect to server', action: () => connectToServer(server) },
        null,
        { label: `Copy '${addr}' to clipboard`, action: () => copyToClipboard(doc, addr) },
        { label: 'Copy link to clipboard', action: () => copyToClipboard(doc, `steam://connect/${addr}`) },
        null,
        {
            label: isFavorite ? 'Remove server from favorites' : 'Add server to favorites',
            action: () => {
                const target = getNativeServer(addr) ?? server;
                if (isFavorite) SC.ServerBrowser.RemoveFavoriteServer(target);
                else SC.ServerBrowser.AddFavoriteServer(target);
            },
        },
    ];

    const menu = doc.createElement('div');
    menu.className = 'sbplus-ev-ctxmenu';

    for (const item of items) {
        if (!item) {
            const sep = doc.createElement('div');
            sep.className = 'sbplus-ev-ctxmenu-sep';
            menu.appendChild(sep);
            continue;
        }
        const el = doc.createElement('div');
        el.className = 'sbplus-ev-ctxmenu-item';
        el.textContent = item.label;
        el.addEventListener('click', () => {
            closeContextMenu();
            runMenuAction(item.label, item.action);
        });
        menu.appendChild(el);
    }

    doc.body.appendChild(menu);
    ctxMenuEl = menu;

    const win = doc.defaultView as any;
    const rect = menu.getBoundingClientRect();
    const maxLeft = (win?.innerWidth ?? clientX) - rect.width - 4;
    const maxTop = (win?.innerHeight ?? clientY) - rect.height - 4;
    menu.style.left = `${Math.max(4, Math.min(clientX, maxLeft))}px`;
    menu.style.top = `${Math.max(4, Math.min(clientY, maxTop))}px`;

    const onDocMouseDown = (e: MouseEvent) => {
        if (ctxMenuEl && ctxMenuEl.contains(e.target as Node)) return;
        closeContextMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closeContextMenu();
    };
    doc.addEventListener('mousedown', onDocMouseDown, true);
    doc.addEventListener('keydown', onKeyDown, true);
    ctxMenuCleanup = () => {
        doc.removeEventListener('mousedown', onDocMouseDown, true);
        doc.removeEventListener('keydown', onKeyDown, true);
    };
}



// CONNECT BUTTON ————————————————————————————————————————————————————————————
function syncConnectButton(doc: Document): void {
    if (!connectBtnEl?.isConnected) {
        connectBtnEl = doc.querySelector('.DialogTwoColLayout > .DialogButton.Primary') as HTMLElement | null;
    }
    const btn = connectBtnEl;
    if (!btn) return;

    const shouldEnable = browserState.enhancedViewActive && !!selectedKey;
    if (shouldEnable) {
        if (btn.classList.contains('Disabled')) {
            btn.classList.remove('Disabled');
            connectBtnEnabledByUs = true;
        }
    } else if (connectBtnEnabledByUs) {
        btn.classList.add('Disabled');
        connectBtnEnabledByUs = false;
    }

    if (connectClickHooked) return;
    connectClickHooked = true;
    doc.addEventListener('click', (e) => {
        if (!browserState.enhancedViewActive || !selectedKey) return;
        const target = (e.target as HTMLElement)?.closest('.DialogButton.Primary');
        if (!target || target !== connectBtnEl) return;

        e.preventDefault();
        e.stopPropagation();
        const server = serversMap.get(selectedKey);
        if (server) runMenuAction('Connect', () => connectToServer(server));
    }, true);
}



// SORT & AD OVERLAY ———————————————————————————————————————————————————————————
function updateSortButton(): void {
    if (!sortBtnEl) return;
    const descending = browserState.sortPlayersDescending;
    sortBtnEl.innerHTML = `Players ${descending ? SORT_ICON_DESC : SORT_ICON_ASC}`;
    sortBtnEl.setAttribute('aria-label', `Sort by player count, ${descending ? 'descending' : 'ascending'}`);
}

function updateAdVisibility(doc: Document): void {
    if (!adImgEl) return;
    const shouldShow = browserState.currentAppId === CSGO_APP_ID && getActiveTabId(doc) === 'internet';
    if (!shouldShow) {
        adImgEl.style.display = 'none';
        return;
    }
    if (!adImgEl.src) {
        adImgEl.src = `${AD_IMAGE_URL}?cb=${Date.now()}`;
    }
    if (adImgEl.complete && adImgEl.naturalWidth === 0) return;
    adImgEl.style.display = 'block';
}



// CORE ————————————————————————————————————————————————————————————————
function teardownEnhancedView(): void {
    try { mapInstance?.remove(); } catch { }
    mapInstance = null;
    tileLayerInstance = null;
    markerLayer = null;
    markersByKey.clear();

    try { resizeObserver?.disconnect(); } catch { }
    resizeObserver = null;

    try { ctxMenuCleanup?.(); } catch { }
    ctxMenuCleanup = null;
    ctxMenuEl = null;

    try { rootEl?.remove(); } catch { }
    rootEl = null;
    listEl = null;
    spacerEl = null;
    tableEl = null;
    sortBtnEl = null;
    adImgEl = null;

    renderedRows.clear();
    mapIsDragging = false;

    connectBtnEl = null;
    connectBtnEnabledByUs = false;
    connectClickHooked = false;

    loggedMissing.clear();
}

export function refreshEnhancedView(doc: Document): void {
    if (!markerLayer || !spacerEl || !listEl) return;

    syncBounds();

    const nativeKeys = getNativeFilteredKeys(doc);
    servers = [];
    for (const s of serversMap.values()) {
        if (browserState.verifiedOnly && !s.verified) continue;
        if (nativeKeys && !nativeKeys.has(serverKey(s))) continue;
        servers.push(s);
    }
    servers.sort((a, b) => {
        const diff = Number(a.players ?? 0) - Number(b.players ?? 0);
        return browserState.sortPlayersDescending ? -diff : diff;
    });
    spacerEl.style.height = `${servers.length * LIST_ROW_HEIGHT}px`;

    syncMarkers(doc);
    updateVisibleRows(doc);
    updateSortButton();
    updateAdVisibility(doc);

    requestAnimationFrame(() => mapInstance?.invalidateSize());
}

function createEnhancedViewDom(doc: Document, container: HTMLElement): void {
    const root = doc.createElement('div');
    root.className = 'sbplus-ev-container';

    const listCol = doc.createElement('div');
    listCol.className = 'sbplus-ev-listcol';

    const sortBar = doc.createElement('div');
    sortBar.className = 'sbplus-ev-sortbar';
    const sortBtn = doc.createElement('button');
    sortBtn.type = 'button';
    sortBtn.className = 'sbplus-ev-sortbtn';
    sortBtn.addEventListener('click', () => {
        browserState.sortPlayersDescending = !browserState.sortPlayersDescending;
        refreshEnhancedView(doc);
    });
    sortBar.appendChild(sortBtn);
    sortBtnEl = sortBtn;
    updateSortButton();

    const list = doc.createElement('div');
    list.className = 'sbplus-ev-list';
    const spacer = doc.createElement('div');
    spacer.className = 'sbplus-ev-spacer';
    list.appendChild(spacer);
    list.addEventListener('scroll', rafThrottle(doc.defaultView as Window, () => updateVisibleRows(doc)));
    list.addEventListener('click', (e) => {
        const row = (e.target as HTMLElement).closest('.sbplus-ev-row') as HTMLElement | null;
        if (!row) return;
        const key = row.dataset.serverKey;
        const server = key ? serversMap.get(key) : null;
        if (server) selectFromList(server);
    });
    list.addEventListener('contextmenu', (e) => {
        const row = (e.target as HTMLElement).closest('.sbplus-ev-row') as HTMLElement | null;
        if (!row) return;
        e.preventDefault();
        const key = row.dataset.serverKey;
        const server = key ? serversMap.get(key) : null;
        if (!server) return;
        applySelection(server, false, false);
        showContextMenu(doc, server, e.clientX, e.clientY);
    });

    listCol.appendChild(sortBar);
    listCol.appendChild(list);

    const mapDiv = doc.createElement('div');
    mapDiv.className = 'sbplus-ev-map';

    const adLink = doc.createElement('a');
    adLink.className = 'sbplus-ev-ad-link';
    adLink.href = 'https://purecsgo.com';
    adLink.target = '_blank';
    adLink.rel = 'noopener noreferrer';
    adLink.title = 'purecsgo.com';

    const ad = doc.createElement('img');
    ad.className = 'sbplus-ev-ad';
    ad.alt = '';
    ad.addEventListener('error', () => { ad.style.display = 'none'; });
    adLink.appendChild(ad);
    mapDiv.appendChild(adLink);
    adImgEl = ad;

    root.appendChild(listCol);
    root.appendChild(mapDiv);
    container.appendChild(root);

    rootEl = root;
    listEl = list;
    spacerEl = spacer;
    ensureMap(mapDiv);
    renderedRows.clear();
}

export function injectEnhancedView(doc: Document): void {
    if (rootEl && rootEl.ownerDocument !== doc) {
        logToConsole('Enhanced View: new document detected, rebuilding view', 'Info');
        teardownEnhancedView();
    }

    ensureStyles(doc);

    const tryInsert = () => {
        const table = doc.querySelector('[role="table"]') as HTMLElement | null;
        const container = table?.parentElement as HTMLElement | null;
        const dialogRoot = doc.querySelector('.DialogContent') as HTMLElement | null;

        if (!table || !container || !dialogRoot) {
            const missing = [
                !table && 'table[role="table"]',
                !container && 'table.parentElement',
                !dialogRoot && '.DialogContent',
            ].filter(Boolean).join(', ');
            if (!loggedMissing.has(missing)) {
                loggedMissing.add(missing);
                logToConsole(`Enhanced View: still waiting on -> ${missing}`, 'Warn');
            }
            return;
        }

        tableEl = table;
        observeResize(doc, table);

        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        let justBuilt = false;
        if (!rootEl) {
            createEnhancedViewDom(doc, container);
            justBuilt = true;
        } else if (!rootEl.isConnected || rootEl.parentElement !== container) {
            container.appendChild(rootEl);
            justBuilt = true;
        }
        if (justBuilt && browserState.enhancedViewActive) refreshEnhancedView(doc);

        syncBounds();
        dialogRoot.classList.toggle('sbplus-ev-active', browserState.enhancedViewActive);
        syncConnectButton(doc);
    };

    onDocumentReady(doc, tryInsert);
}
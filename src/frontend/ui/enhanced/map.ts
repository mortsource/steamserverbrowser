import * as maplibregl from 'maplibre-gl';
import { constSysfsExpr } from '@steambrew/client';
import { logToConsole, serversMap } from '../../shared';
import { browserState, getActiveTabId, serverKey } from '../ui_shared';
import { getMapTileConfig, onMapTileConfigChanged } from '../settings';
import { buildServerMeta, attachRowThumbFallback, openServerMenu } from './enh_shared';

// #region CONSTANTS
const SPACE_BG_URL = `data:image/jpeg;base64,${constSysfsExpr('space-bg.jpg', { basePath: '../../assets/backgrounds', encoding: 'base64' }).content}`;
const ICON_GLOBE = constSysfsExpr('globe-16.svg', { basePath: '../../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content;
const ICON_RESET = constSysfsExpr('screen-normal-16.svg', { basePath: '../../../node_modules/@primer/octicons/build/svg', encoding: 'utf8' }).content;
const ICON_ROTATE = `<svg viewBox="0 0 122.88 45.59" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M105.14,8.16c15.07,5.35,14.31,14.26-6.59,19.42c-4.28,1.06-8.52,2.04-13.64,2.64v6.07 c5.9-0.73,10.92-2.08,15.85-3.28c30.37-7.36,26.92-20.93,5.06-27.4C92.61,1.71,76.16,0.04,62.46,0 C49.59-0.04,35.04,1.16,22.43,4.38c-58.73,15,13.09,35.33,42.34,34.21v7l10.17-10.18v-2.16L64.77,23.09v7.47 c-14.93,0.13-86.53-8.93-41.68-23.5C33.44,3.7,51.73,2.71,62.72,2.73C74.93,2.75,93.62,4.07,105.14,8.16L105.14,8.16z"/></svg>`;
const WORKER_SRC = constSysfsExpr('maplibre-gl-worker.mjs', { basePath: '../../../node_modules/maplibre-gl/dist', encoding: 'utf8' }).content;
const WORKER_SHARED_SRC = constSysfsExpr('maplibre-gl-shared.mjs', { basePath: '../../../node_modules/maplibre-gl/dist', encoding: 'utf8' }).content;

const GLOBE_ROTATE_KEY = 'sbplus_globe_autorotate';
const AD_IMAGE_URL = 'https://purecsgo.com/assets/dynamic/images/elements/plugin-ad.png';
const AD_LINK_URL = 'https://purecsgo.com';
const AD_APP_ID = 4465480;

const CLUSTER_RADIUS_PX = 50;
const CLUSTER_MAX_ZOOM = 13;
const HIT_RADIUS_PX = 18;
const SELECT_ZOOM = 14;
const ROTATE_DEG_PER_SEC = 4;
const ROTATE_MAX_ZOOM = 5;
const DRAG_THRESHOLD_PX = 4;
const HOME_CENTER: [number, number] = [0, 20];
const WORLD_LAT = 85;
const WORLD_TILE_PX = 512;
const MAP_BG_COLOR = '#0e0e0e';
const RASTER_PAINT: any = { 'raster-brightness-min': 0.12, 'raster-brightness-max': 1, 'raster-contrast': 0.15 };
const GLYPHS = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
const CLUSTER_FILL = ['step', ['get', 'point_count'], 'rgba(96,165,250,0.85)', 10, 'rgba(37,99,235,0.9)', 100, 'rgba(15,35,90,0.95)'];
const CLUSTER_HALO = ['step', ['get', 'point_count'], 'rgba(147,197,253,0.45)', 10, 'rgba(59,130,246,0.45)', 100, 'rgba(30,58,138,0.5)'];

const mapStyle = (): any => ({
    version: 8,
    projection: { type: 'mercator' },
    glyphs: GLYPHS,
    sky: {
        'sky-color': MAP_BG_COLOR, 'horizon-color': '#2b4a8f', 'fog-color': MAP_BG_COLOR,
        'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.1,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    },
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': MAP_BG_COLOR } }],
});
// #endregion



// #region STATE
let map: maplibregl.Map | null = null;
let containerEl: HTMLElement | null = null;
let mapReady = false;
let viewInitialized = false;
let isGlobe = false;
let size = { w: 0, h: 0 };

let servers: any[] = [];
let selectedKey: string | null = null;
let coordsByKey = new Map<string, [number, number]>();
let dataPending = false;
let pointerDown = false;
let cleanupListeners: (() => void) | null = null;
let workerUrl: string | null = null;

let popup: maplibregl.Popup | null = null;
let popupKey: string | null = null;
let popupPinned = false;

let autoRotate = loadAutoRotate();
let rotateRaf = 0;

let buttons: { zoomIn?: HTMLElement; zoomOut?: HTMLElement; globe?: HTMLElement; rotate?: HTMLElement } = {};
let adImgEl: HTMLImageElement | null = null;
// #endregion



// #region MAP SPREAD
const SPREAD_SPACING_DEG = 0.0012;
const SPREAD_MAX_COLS = 8;
const SPREAD_BLOCK_GAP = 1.5;

interface SpreadMember { key: string; ip: string; port: number; lat: number; lng: number }
interface SpreadBlock { rows: SpreadMember[][]; cols: number }
interface SpreadLayout { cells: { member: SpreadMember; x: number; y: number }[]; maxX: number; maxY: number }

function parseIpv4(ip: string): { subnet: string; last: number } {
    const m = /^(\d+\.\d+\.\d+)\.(\d+)$/.exec(ip ?? '');
    return m ? { subnet: m[1], last: Number(m[2]) } : { subnet: String(ip), last: 0 };
}

function subnetSortKey(subnet: string): string {
    return subnet.split('.').map((n) => n.padStart(3, '0')).join('.');
}

function groupByLocation(servers: any[]): SpreadMember[][] {
    const groups = new Map<string, SpreadMember[]>();
    for (const server of servers) {
        const geo = server.geo;
        if (!geo || geo.latitude == null || geo.longitude == null) continue;
        const id = `${geo.latitude.toFixed(4)},${geo.longitude.toFixed(4)}`;
        const member: SpreadMember = { key: serverKey(server), ip: String(server.ip), port: Number(server.port), lat: geo.latitude, lng: geo.longitude };
        const group = groups.get(id);
        if (group) group.push(member); else groups.set(id, [member]);
    }
    return [...groups.values()];
}

function buildSubnetBlocks(group: SpreadMember[]): SpreadBlock[] {
    const subnets = new Map<string, Map<string, SpreadMember[]>>();
    for (const member of group) {
        const { subnet } = parseIpv4(member.ip);
        let ips = subnets.get(subnet);
        if (!ips) subnets.set(subnet, ips = new Map());
        const list = ips.get(member.ip);
        if (list) list.push(member); else ips.set(member.ip, [member]);
    }

    return [...subnets.entries()]
        .sort(([a], [b]) => (subnetSortKey(a) < subnetSortKey(b) ? -1 : 1))
        .map(([, ips]) => {
            const rows: SpreadMember[][] = [];
            const orderedIps = [...ips.entries()].sort(([a], [b]) => parseIpv4(a).last - parseIpv4(b).last);
            for (const [, members] of orderedIps) {
                members.sort((a, b) => a.port - b.port);
                for (let i = 0; i < members.length; i += SPREAD_MAX_COLS) rows.push(members.slice(i, i + SPREAD_MAX_COLS));
            }
            return { rows, cols: Math.max(...rows.map((r) => r.length)) };
        });
}

function layoutBlocks(blocks: SpreadBlock[]): SpreadLayout {
    const totalCells = blocks.reduce((n, b) => n + b.rows.length * b.cols, 0);
    const targetWidth = Math.max(Math.max(...blocks.map((b) => b.cols)), Math.ceil(Math.sqrt(totalCells * 1.5)));
    const cells: SpreadLayout['cells'] = [];
    let x = 0, y = 0, lineHeight = 0, maxX = 0;
    for (const block of blocks) {
        if (x > 0 && x + block.cols > targetWidth) {
            y += lineHeight + SPREAD_BLOCK_GAP;
            x = 0;
            lineHeight = 0;
        }
        block.rows.forEach((row, r) => row.forEach((member, c) => cells.push({ member, x: x + c, y: y + r })));
        maxX = Math.max(maxX, x + block.cols - 1);
        lineHeight = Math.max(lineHeight, block.rows.length);
        x += block.cols + SPREAD_BLOCK_GAP;
    }
    return { cells, maxX, maxY: y + lineHeight - 1 };
}

export function spreadServerCoords(servers: any[]): Map<string, [number, number]> {
    const out = new Map<string, [number, number]>();
    for (const group of groupByLocation(servers)) {
        if (group.length === 1) {
            out.set(group[0].key, [group[0].lat, group[0].lng]);
            continue;
        }

        const { cells, maxX, maxY } = layoutBlocks(buildSubnetBlocks(group));
        const lngScale = Math.max(0.2, Math.cos((group[0].lat * Math.PI) / 180));
        for (const { member, x, y } of cells) {
            const dx = (x - maxX / 2) * SPREAD_SPACING_DEG;
            const dy = (maxY / 2 - y) * SPREAD_SPACING_DEG;
            out.set(member.key, [member.lat + dy, member.lng + dx / lngScale]);
        }
    }
    return out;
}
// #endregion



// #region VIEW
function flatMinZoom(): number {
    return Math.max(0, Math.log2(Math.max(size.w, size.h, 1) / WORLD_TILE_PX));
}

function homeView(): { center: [number, number]; zoom: number } {
    const zoom = isGlobe ? Math.max(0.5, Math.log2((Math.PI * 0.85 * (size.h || 600)) / WORLD_TILE_PX)) : flatMinZoom();
    return { center: HOME_CENTER, zoom };
}

function setFlatMinZoom(): void {
    try { map?.setMinZoom(flatMinZoom()); } catch (err) { logToConsole('VIEW', `MinZoom update failed -> ${err}`, 'Warn'); }
}

function initView(): void {
    if (!map || !mapReady || viewInitialized || !size.w) return;
    viewInitialized = true;
    map.jumpTo(homeView());
    setFlatMinZoom();
}

function resetView(): void {
    map?.easeTo({ ...homeView(), duration: 800 });
}

function clampFlatView(): void {
    if (!map || isGlobe) return;
    const center = map.getCenter();
    const lat = Math.max(-WORLD_LAT, Math.min(WORLD_LAT, center.lat));
    const lng = Math.max(-180, Math.min(180, center.lng));
    if (lat !== center.lat || lng !== center.lng) map.easeTo({ center: [lng, lat], duration: 200 });
}

export function resizeMap(): void {
    if (!map || !containerEl) return;
    const w = containerEl.clientWidth, h = containerEl.clientHeight;
    if (!w || !h || (w === size.w && h === size.h)) return;
    size = { w, h };
    map.resize();
    map.redraw();
    if (!viewInitialized) initView();
    else setFlatMinZoom();
}
// #endregion



// #region DATA & SELECTION
function tileSource(): any {
    const { url, attribution, maxZoom } = getMapTileConfig();
    return { type: 'raster', tiles: [url.replace('{s}', 'a')], tileSize: 256, maxzoom: maxZoom, attribution };
}

function applyTiles(): void {
    if (!map || !mapReady) return;
    if (map.getLayer('basemap')) map.removeLayer('basemap');
    if (map.getSource('basemap')) map.removeSource('basemap');
    map.addSource('basemap', tileSource());
    map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap', paint: RASTER_PAINT }, 'clusters');
}

function buildServerFeatures(): any {
    const features: any[] = [];
    coordsByKey = new Map();
    for (const [key, [lat, lng]] of spreadServerCoords(servers)) {
        coordsByKey.set(key, [lng, lat]);
        features.push({ type: 'Feature', properties: { key }, geometry: { type: 'Point', coordinates: [lng, lat] } });
    }
    return { type: 'FeatureCollection', features };
}

function applyMapSelection(fly: boolean, pinPopup: boolean): void {
    if (!map || !mapReady) return;
    map.setFilter('server-selected', ['==', ['get', 'key'], selectedKey ?? '']);
    const at = selectedKey ? coordsByKey.get(selectedKey) : null;
    if (!selectedKey || !at) return;
    if (fly) map.flyTo({ center: at, zoom: Math.max(map.getZoom(), SELECT_ZOOM), duration: 1200 });
    if (pinPopup) showPopup(selectedKey, true);
}

function flushMapData(): void {
    if (dataPending && !pointerDown && map && !map.isMoving()) syncMapData(servers);
}

export function syncMapData(nextServers: any[]): void {
    servers = nextServers;
    if (!map || !mapReady) return;
    if (pointerDown || map.isMoving()) {
        dataPending = true;
        return;
    }
    dataPending = false;
    (map.getSource('servers') as maplibregl.GeoJSONSource | undefined)?.setData(buildServerFeatures());
    applyMapSelection(false, false);
}

export function syncMapSelection(key: string | null, fly: boolean, pinPopup: boolean): void {
    selectedKey = key;
    applyMapSelection(fly, pinPopup);
}
// #endregion



// #region POPUP
function buildTooltipContent(doc: Document, server: any): HTMLElement {
    const wrap = doc.createElement('div');
    wrap.className = 'sbplus-ev-row sbplus-ev-tooltip-card';
    wrap.innerHTML = buildServerMeta(server, { location: true });
    attachRowThumbFallback(wrap, server);
    return wrap;
}

function hidePopup(): void {
    popup?.remove();
    popup = null;
    popupKey = null;
    popupPinned = false;
}

function showPopup(key: string, pinned = false): void {
    const at = coordsByKey.get(key), server = serversMap.get(key);
    if (!map || !containerEl || !at || !server) return;
    if (popupKey === key && popup) {
        popupPinned ||= pinned;
        return;
    }
    hidePopup();
    popupKey = key;
    popupPinned = pinned;
    popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'sbplus-ev-gl-popup', offset: 14, maxWidth: 'none' })
        .setLngLat(at)
        .setDOMContent(buildTooltipContent(containerEl.ownerDocument, server))
        .addTo(map);
}
// #endregion



// #region ROTATION
function loadAutoRotate(): boolean {
    try { return localStorage.getItem(GLOBE_ROTATE_KEY) !== '0'; } catch { return true; }
}

function stopRotation(): void {
    if (rotateRaf) containerEl?.ownerDocument.defaultView?.cancelAnimationFrame(rotateRaf);
    rotateRaf = 0;
}

function syncRotation(): void {
    const win = containerEl?.ownerDocument.defaultView;
    if (!map || !win || !isGlobe || !autoRotate) {
        stopRotation();
        return;
    }
    if (rotateRaf) return;

    let last = win.performance.now();
    const frame = (now: number) => {
        if (!map) {
            rotateRaf = 0;
            return;
        }
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (mapReady && !pointerDown && !popup && !map.isMoving() && map.getZoom() < ROTATE_MAX_ZOOM) {
            const center = map.getCenter();
            map.jumpTo({ center: [center.lng + dt * ROTATE_DEG_PER_SEC, center.lat] });
        }
        rotateRaf = win.requestAnimationFrame(frame);
    };
    rotateRaf = win.requestAnimationFrame(frame);
}

function setAutoRotate(on: boolean): void {
    autoRotate = on;
    try { localStorage.setItem(GLOBE_ROTATE_KEY, on ? '1' : '0'); } catch { }
    syncRotation();
    updateButtons();
}
// #endregion



// #region CONTROLS
function updateButtons(): void {
    if (!map) return;
    const { zoomIn, zoomOut, globe, rotate } = buttons;
    globe?.classList.toggle('active', isGlobe);
    if (rotate) {
        rotate.style.display = isGlobe ? '' : 'none';
        rotate.classList.toggle('active', autoRotate);
        rotate.title = autoRotate ? 'Auto-rotate: on' : 'Auto-rotate: off';
    }
    zoomIn?.classList.toggle('disabled', map.getZoom() >= map.getMaxZoom());
    zoomOut?.classList.toggle('disabled', map.getZoom() <= map.getMinZoom());
}

function setGlobeMode(on: boolean): void {
    if (!map || !mapReady || isGlobe === on) return;
    isGlobe = on;
    hidePopup();
    map.setProjection({ type: on ? 'globe' : 'mercator' });
    map.jumpTo(homeView());
    if (map.getLayer('background')) map.setPaintProperty('background', 'background-color', on ? 'rgba(0,0,0,0)' : MAP_BG_COLOR);
    if (containerEl) {
        Object.assign(containerEl.style, {
            backgroundImage: on ? `url("${SPACE_BG_URL}")` : '',
            backgroundSize: on ? 'cover' : '',
            backgroundPosition: on ? 'center' : '',
            backgroundRepeat: on ? 'no-repeat' : '',
        });
    }
    syncRotation();
    updateButtons();
}

function createButton(doc: Document, parent: HTMLElement, title: string, html: string, onClick: () => void): HTMLElement {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'sbplus-ev-btn';
    btn.title = title;
    btn.innerHTML = html;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!btn.classList.contains('disabled')) onClick();
    });
    parent.appendChild(btn);
    return btn;
}

function createControls(doc: Document, mapDiv: HTMLElement): void {
    const controls = doc.createElement('div');
    controls.className = 'sbplus-ev-controls';
    const createGroup = () => {
        const group = doc.createElement('div');
        group.className = 'sbplus-ev-btns';
        controls.appendChild(group);
        return group;
    };

    const zoomGroup = createGroup();
    buttons.zoomIn = createButton(doc, zoomGroup, 'Zoom in', '+', () => map?.zoomIn());
    buttons.zoomOut = createButton(doc, zoomGroup, 'Zoom out', '&minus;', () => map?.zoomOut());
    createButton(doc, createGroup(), 'Reset view', ICON_RESET, resetView);

    const viewGroup = createGroup();
    buttons.globe = createButton(doc, viewGroup, '3D globe (experimental)', ICON_GLOBE, () => setGlobeMode(!isGlobe));
    buttons.rotate = createButton(doc, viewGroup, '', ICON_ROTATE, () => setAutoRotate(!autoRotate));
    buttons.rotate.classList.add('sbplus-ev-rotate');

    const legend = doc.createElement('div');
    legend.className = 'sbplus-ev-clusterlegend';
    legend.innerHTML = `
        <div class="sbplus-ev-clusterlegend-title">Servers</div>
        <div class="sbplus-ev-clusterlegend-row"><span class="sbplus-ev-clusterlegend-swatch sbplus-ev-clusterlegend-small"></span>&lt; 10</div>
        <div class="sbplus-ev-clusterlegend-row"><span class="sbplus-ev-clusterlegend-swatch sbplus-ev-clusterlegend-medium"></span>10–99</div>
        <div class="sbplus-ev-clusterlegend-row"><span class="sbplus-ev-clusterlegend-swatch sbplus-ev-clusterlegend-large"></span>100+</div>`;

    mapDiv.append(controls, legend);
}
// #endregion



// #region AD OVERLAY
function createAdOverlay(doc: Document, mapDiv: HTMLElement): void {
    const adLink = doc.createElement('a');
    adLink.className = 'sbplus-ev-ad-link';
    adLink.href = AD_LINK_URL;
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
}

export function updateAdVisibility(doc: Document): void {
    if (!adImgEl) return;
    const shouldShow = browserState.currentAppId === AD_APP_ID && getActiveTabId(doc) === 'internet';
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
// #endregion



// #region EVENTS
function bindPointerTracking(doc: Document, target: HTMLElement): void {
    let downX = 0, downY = 0;
    const forwardToMainDocument = (e: MouseEvent) => {
        if (doc !== document) document.dispatchEvent(new MouseEvent(e.type, e));
    };
    const onDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        pointerDown = true;
        downX = e.clientX;
        downY = e.clientY;
    };
    const onMove = (e: MouseEvent) => {
        if (pointerDown && e.buttons === 0) {
            pointerDown = false;
            flushMapData();
        } else if (pointerDown && isGlobe && autoRotate && Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_THRESHOLD_PX) {
            setAutoRotate(false);
        }
        forwardToMainDocument(e);
    };
    const onUp = (e: MouseEvent) => {
        pointerDown = false;
        forwardToMainDocument(e);
        flushMapData();
    };

    target.addEventListener('mousedown', onDown, true);
    doc.addEventListener('mousemove', onMove, true);
    doc.addEventListener('mouseup', onUp, true);
    cleanupListeners = () => {
        target.removeEventListener('mousedown', onDown, true);
        doc.removeEventListener('mousemove', onMove, true);
        doc.removeEventListener('mouseup', onUp, true);
    };
}

function addMapLayers(m: maplibregl.Map): void {
    m.addSource('basemap', tileSource());
    m.addSource('servers', { type: 'geojson', data: buildServerFeatures(), cluster: true, clusterRadius: CLUSTER_RADIUS_PX, clusterMaxZoom: CLUSTER_MAX_ZOOM });
    m.addLayer({ id: 'basemap', type: 'raster', source: 'basemap', paint: RASTER_PAINT });
    m.addLayer({
        id: 'clusters', type: 'circle', source: 'servers', filter: ['has', 'point_count'],
        paint: {
            'circle-color': CLUSTER_FILL as any,
            'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 100, 24],
            'circle-stroke-width': 5,
            'circle-stroke-color': CLUSTER_HALO as any,
        },
    });
    m.addLayer({
        id: 'cluster-count', type: 'symbol', source: 'servers', filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Open Sans Semibold'], 'text-size': 12, 'text-allow-overlap': true },
        paint: { 'text-color': '#ffffff' },
    });
    m.addLayer({
        id: 'server-dots', type: 'circle', source: 'servers', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-radius': 5, 'circle-color': '#8f8f8f', 'circle-stroke-width': 1, 'circle-stroke-color': 'rgba(255,255,255,0.7)' },
    });
    m.addLayer({
        id: 'server-selected', type: 'circle', source: 'servers', filter: ['==', ['get', 'key'], ''],
        paint: { 'circle-radius': 8, 'circle-color': '#f0f0f0', 'circle-stroke-width': 1, 'circle-stroke-color': 'rgba(255,255,255,0.9)' },
    });
    m.addLayer({
        id: 'server-hit', type: 'circle', source: 'servers', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-radius': HIT_RADIUS_PX, 'circle-color': '#000000', 'circle-opacity': 0 },
    });
}

function bindMapEvents(m: maplibregl.Map, doc: Document, onSelect: (server: any) => void): void {
    const serverOf = (e: any): any | null => {
        const key = e.features?.[0]?.properties?.key;
        return key ? serversMap.get(key) ?? null : null;
    };
    const setPointer = (on: boolean) => () => { m.getCanvas().style.cursor = on ? 'pointer' : ''; };

    m.on('zoom', updateButtons);
    m.on('moveend', flushMapData);
    m.on('moveend', clampFlatView);
    m.on('error', (e: any) => logToConsole('VIEW', `Map error -> ${e?.error?.message ?? e}`, 'Warn'));
    m.on('load', () => {
        addMapLayers(m);
        mapReady = true;
        initView();
        applyMapSelection(false, false);
        updateButtons();
    });

    for (const layer of ['server-hit', 'clusters']) {
        m.on('mouseenter', layer, setPointer(true));
        m.on('mouseleave', layer, setPointer(false));
    }
    m.on('mousemove', 'server-hit', (e) => {
        const key = e.features?.[0]?.properties?.key;
        if (key) showPopup(key);
    });
    m.on('mouseleave', 'server-hit', () => {
        if (!popupPinned) hidePopup();
    });
    m.on('click', (e) => {
        if (!m.getLayer('server-hit')) return;
        if (!m.queryRenderedFeatures(e.point, { layers: ['server-hit', 'clusters'] }).length) hidePopup();
    });
    m.on('click', 'server-hit', (e) => {
        const server = serverOf(e);
        if (server) onSelect(server);
    });
    m.on('contextmenu', 'server-hit', (e) => {
        const server = serverOf(e);
        if (!server) return;
        onSelect(server);
        openServerMenu(doc, server, e.originalEvent);
    });
    m.on('click', 'clusters', async (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const source = m.getSource('servers') as maplibregl.GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(feature.properties.cluster_id);
        m.easeTo({ center: (feature.geometry as any).coordinates, zoom: zoom + 0.3 });
    });
}
// #endregion



// #region LIFECYCLE
function ensureWorkerUrl(): void {
    if (workerUrl) return;
    const toBlobUrl = (code: string) => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const sharedUrl = toBlobUrl(WORKER_SHARED_SRC);
    workerUrl = toBlobUrl(WORKER_SRC.replace(/(["'`])\.\/maplibre-gl-shared\.mjs\1/g, () => JSON.stringify(sharedUrl)));
    maplibregl.setWorkerUrl(workerUrl);
}

export function createMap(doc: Document, mapDiv: HTMLElement, onSelect: (server: any) => void): void {
    if (containerEl) return;

    containerEl = doc.createElement('div');
    containerEl.className = 'sbplus-ev-mapcanvas';
    mapDiv.appendChild(containerEl);
    createAdOverlay(doc, mapDiv);
    createControls(doc, mapDiv);

    try {
        ensureWorkerUrl();
        map = new maplibregl.Map({
            container: containerEl,
            style: mapStyle(),
            center: HOME_CENTER,
            zoom: 1,
            renderWorldCopies: false,
            attributionControl: { compact: false },
            trackResize: false,
            dragRotate: false,
            pitchWithRotate: false,
            maxPitch: 0,
        });
    } catch (err) {
        logToConsole('VIEW', `Map init failed -> ${err}`, 'Error');
        map = null;
        return;
    }

    bindPointerTracking(doc, containerEl);
    bindMapEvents(map, doc, onSelect);
}

export function teardownMap(): void {
    hidePopup();
    cleanupListeners?.();
    cleanupListeners = null;
    stopRotation();
    try { map?.remove(); } catch { }
    map = null;
    containerEl = null;
    mapReady = false;
    viewInitialized = false;
    isGlobe = false;
    size = { w: 0, h: 0 };
    dataPending = false;
    pointerDown = false;
    adImgEl = null;
    buttons = {};
}

onMapTileConfigChanged(applyTiles);
// #endregion

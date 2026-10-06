import { constSysfsExpr } from '@steambrew/client';
import { logToConsole, startFavoritesTracking, isFavorite } from '../shared';
import { escapeHtml, injectStyle, steamClient, connectToServer, mapThumbUrl, serverKey } from './ui_shared';

interface ServerAlert {
    key: string;
    name: string;
    appid: number;
    queryPort: number;
    playersAtLeast: number | null;
    playersAtMost: number | null;
    mapChange: boolean;
    mapIs: string;
    firedAt?: number;
    firedReason?: string;
    disabled?: boolean;
}

// #region STORAGE
const ALERTS_KEY = 'sbplus_alerts';
let alertsCache: ServerAlert[] | null = null;

function loadAlerts(): ServerAlert[] {
    if (alertsCache) return alertsCache;
    try {
        const parsed = JSON.parse(localStorage.getItem(ALERTS_KEY) ?? '[]');
        alertsCache = Array.isArray(parsed) ? parsed : [];
    } catch {
        alertsCache = [];
    }
    return alertsCache;
}

function saveAlerts(alerts: ServerAlert[]): void {
    try {
        localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
        alertsCache = alerts;
    } catch (e) {
        alertsCache = null;
        logToConsole('ALERTS', `Failed to save -> ${e}`, 'Error');
    }
}

const changeListeners = new Set<() => void>();
const emitChanged = () => changeListeners.forEach((cb) => { try { cb(); } catch { } });

export function onAlertsChanged(cb: () => void): void {
    changeListeners.add(cb);
}

const hasTrigger = (a: ServerAlert): boolean =>
    a.playersAtLeast !== null || a.playersAtMost !== null || a.mapChange || a.mapIs !== '';
const isActive = (a: ServerAlert): boolean => !a.disabled && hasTrigger(a);
export const listAlerts = (): readonly ServerAlert[] => loadAlerts();
export const getAlert = (key: string): ServerAlert | undefined => loadAlerts().find((a) => a.key === key);
export const hasAlert = (key: string): boolean => loadAlerts().some((a) => a.key === key && isActive(a));

function upsertAlert(alert: ServerAlert): void {
    const alerts = loadAlerts();
    const replaced = alerts.some((a) => a.key === alert.key);
    saveAlerts(replaced ? alerts.map((a) => (a.key === alert.key ? alert : a)) : [...alerts, alert]);
    emitChanged();
}

function disableAlert(key: string): void {
    const stored = getAlert(key);
    if (!stored || stored.disabled) return;
    lastSeen.delete(key);
    upsertAlert({ ...stored, disabled: true });
    logToConsole('ALERTS', `Alert for ${stored.name} disabled after its toast was clicked`);
}

export function removeAlert(key: string): void {
    saveAlerts(loadAlerts().filter((a) => a.key !== key));
    lastSeen.delete(key);
    emitChanged();
}

export function describeTriggers(a: ServerAlert): string {
    const parts: string[] = [];
    if (a.playersAtLeast !== null) parts.push(`${a.playersAtLeast}+ players`);
    if (a.playersAtMost !== null) parts.push(`${a.playersAtMost} or fewer players`);
    if (a.mapChange) parts.push('map change');
    if (a.mapIs) parts.push(`map -> ${a.mapIs}`);
    return parts.join(', ');
}
// #endregion



// #region NOTIFICATION
const TOAST_MATCH_TTL_MS = 60_000;

interface ToastTarget {
    name: string;
    ip: string;
    port: number;
    queryPort: number;
    appid: number;
    map: string;
    alertKey?: string;
}

interface PendingToast {
    target: ToastTarget;
    body: string;
    at: number;
    claimed?: boolean;
}

const pendingToasts: PendingToast[] = [];
const toastEntries = new WeakMap<HTMLElement, PendingToast>();

function toTarget(s: any, alertKey?: string): ToastTarget {
    return {
        name: String(s.name ?? serverKey(s)),
        ip: String(s.ip),
        port: Number(s.port),
        queryPort: Number(s.queryPort ?? s.port),
        appid: Number(s.appid ?? 0),
        map: String(s.map ?? ''),
        alertKey,
    };
}

function targetFromAlert(a: ServerAlert, map = ''): ToastTarget {
    const [ip, port] = a.key.split(':');
    return toTarget({ ...a, ip, port, map }, a.key);
}

const liveSummary = (s: any): string =>
    `${Number(s.players)}/${Number(s.maxPlayers ?? 0)} on ${String(s.map ?? 'unknown')}`;

async function connectFromToast(t: ToastTarget): Promise<void> {
    const urlApi = steamClient()?.URL;
    if (typeof urlApi?.ExecuteSteamURL === 'function') {
        urlApi.ExecuteSteamURL(`steam://connect/${t.ip}:${t.port}`);
        return;
    }
    logToConsole('ALERTS', 'ExecuteSteamURL unavailable, falling back to the game info dialog', 'Warn');
    await connectToServer(t);
}

function sendToastNotification(target: ToastTarget, body: string): void {
    const CN = steamClient()?.ClientNotifications;
    const steamid = (window as any).App?.m_CurrentUser?.strSteamID;
    if (!CN?.DisplayClientNotification || !steamid) {
        logToConsole('ALERTS', 'Cannot display notification (ClientNotifications or SteamID unavailable)', 'Warn');
        return;
    }
    const now = Date.now();
    while (pendingToasts.length && now - pendingToasts[0].at > TOAST_MATCH_TTL_MS) pendingToasts.shift();
    pendingToasts.push({ target, body, at: now });
    try {
        CN.DisplayClientNotification(2, JSON.stringify({ title: 'ServerBrowserPlus', body, state: 'online', steamid, tag: 'sbplus-alert' }), () => { });
    } catch (e) {
        logToConsole('ALERTS', `Notification failed -> ${e}`, 'Error');
    }
}

function applyToastBackground(toast: HTMLElement, target: ToastTarget): void {
    const popup = toast.closest<HTMLElement>('.DesktopToastPopup');
    if (!popup || !target.map) return;
    const url = new URL(mapThumbUrl(target), window.location.href).href;
    if (popup.dataset.sbplusBg === url) return;
    popup.dataset.sbplusBg = url;

    const probe = new Image();
    probe.onload = () => {
        if (popup.dataset.sbplusBg !== url) return;
        popup.querySelector<HTMLElement>('.DesktopToastBackground')?.style.setProperty('display', 'none');
        popup.style.backgroundImage = `linear-gradient(90deg, rgba(20,22,28,0.92) 0%, rgba(20,22,28,0.55) 100%), url('${url}')`;
        popup.style.backgroundSize = 'cover';
        popup.style.backgroundPosition = 'center';
    };
    probe.src = url;
}

export function hookToastWindow(doc: Document): void {
    const apply = () => {
        doc.querySelectorAll<HTMLElement>('.DesktopToastTemplate').forEach((toast) => {
            const bodyEl = toast.querySelector<HTMLElement>('.GroupMessageBody');
            const nameEl = toast.querySelector<HTMLElement>('.GroupMessageUserName');
            if (!bodyEl || !nameEl) return;
            let match = toastEntries.get(toast);
            if (!match) {
                const text = bodyEl.textContent?.trim();
                match = [...pendingToasts].reverse().find((p) => !p.claimed && p.body === text);
                if (!match) return;
                match.claimed = true;
                toastEntries.set(toast, match);

                const { target } = match;
                toast.title = 'Click to connect';
                toast.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (target.alertKey) disableAlert(target.alertKey);
                    connectFromToast(target).catch((err) => logToConsole('ALERTS', `Connect failed -> ${err}`, 'Error'));
                }, true);
            }
            const { target } = match;
            if (nameEl.textContent !== target.name) nameEl.textContent = target.name;
            applyToastBackground(toast, target);
            const logo = toast.querySelector<HTMLElement>('.StandardLogoDimensions');
            if (logo && logo.style.display !== 'none') logo.style.display = 'none';
        });
    };
    new MutationObserver(apply).observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
    apply();
}
// #endregion



// #region MODAL
const ALERT_CSS = constSysfsExpr('alert.css', { encoding: 'utf8' }).content;
let closeActiveModal: (() => void) | null = null;

const parseCount = (v: string): number | null => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

export function openAlertModal(doc: Document, server: any): void {
    injectStyle(doc, 'sbplus-alert-style', ALERT_CSS);
    closeActiveModal?.();

    const key = serverKey(server);
    const existing = getAlert(key);
    const target = toTarget(server);
    const name = target.name;
    const hasLiveData = server.players != null;
    const needsFavorite = !isFavorite(key);
    const defaultAtLeast = hasLiveData ? Math.min(Number(server.maxPlayers ?? 10), Number(server.players) + 5) : 10;

    const overlay = doc.createElement('div');
    overlay.id = 'sbplus-alert-overlay';
    overlay.className = 'sbplus-alert-overlay';
    overlay.innerHTML = `
        <div class="sbplus-alert-panel">
            <div class="sbplus-alert-head">
                <div class="sbplus-alert-title">Server alert</div>
                <div class="sbplus-alert-sub" title="${escapeHtml(name)}">${escapeHtml(name)} &middot; ${escapeHtml(key)}</div>
            </div>
            <div class="sbplus-alert-body">
                <div class="sbplus-alert-row">
                    <input type="checkbox" id="sbplus-alert-atleast-on">
                    <label for="sbplus-alert-atleast-on">Players reach at least</label>
                    <input type="number" min="0" id="sbplus-alert-atleast">
                </div>
                <div class="sbplus-alert-row">
                    <input type="checkbox" id="sbplus-alert-atmost-on">
                    <label for="sbplus-alert-atmost-on">Players drop to at most</label>
                    <input type="number" min="0" id="sbplus-alert-atmost">
                </div>
                <div class="sbplus-alert-row">
                    <input type="checkbox" id="sbplus-alert-mapchange">
                    <label for="sbplus-alert-mapchange">Map changes</label>
                </div>
                <div class="sbplus-alert-row">
                    <input type="checkbox" id="sbplus-alert-mapis-on">
                    <label for="sbplus-alert-mapis-on">Map changes to</label>
                    <input type="text" id="sbplus-alert-mapis" placeholder="de_dust2">
                </div>
            </div>
            <div class="sbplus-alert-foot">
                <button type="button" class="sbplus-alert-btn" id="sbplus-alert-test">Test</button>
                ${existing ? '<button type="button" class="sbplus-alert-btn" id="sbplus-alert-remove">Remove</button>' : ''}
                <span class="spacer"></span>
                <button type="button" class="sbplus-alert-btn" id="sbplus-alert-cancel">Cancel</button>
                <button type="button" class="sbplus-alert-btn primary" id="sbplus-alert-save">Save</button>
            </div>
        </div>
    `;

    const $ = <T extends HTMLElement>(id: string) => overlay.querySelector<T>(`#sbplus-alert-${id}`)!;
    const atLeastOn = $<HTMLInputElement>('atleast-on'), atLeast = $<HTMLInputElement>('atleast');
    const atMostOn = $<HTMLInputElement>('atmost-on'), atMost = $<HTMLInputElement>('atmost');
    const mapChange = $<HTMLInputElement>('mapchange');
    const mapIsOn = $<HTMLInputElement>('mapis-on'), mapIs = $<HTMLInputElement>('mapis');

    atLeastOn.checked = existing?.playersAtLeast != null;
    atLeast.value = String(existing?.playersAtLeast ?? defaultAtLeast);
    atMostOn.checked = existing?.playersAtMost != null;
    atMost.value = String(existing?.playersAtMost ?? 0);
    mapChange.checked = existing?.mapChange ?? false;
    mapIsOn.checked = !!existing?.mapIs;
    mapIs.value = existing?.mapIs ?? '';

    const syncDisabled = () => {
        atLeast.disabled = !atLeastOn.checked;
        atMost.disabled = !atMostOn.checked;
        mapIs.disabled = !mapIsOn.checked;
    };
    [atLeastOn, atMostOn, mapIsOn].forEach((el) => el.addEventListener('change', syncDisabled));
    syncDisabled();

    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const close = () => {
        doc.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        if (closeActiveModal === close) closeActiveModal = null;
    };
    closeActiveModal = close;
    doc.addEventListener('keydown', onKeyDown, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    $('cancel').addEventListener('click', close);

    $('test').addEventListener('click', () => sendToastNotification(target, hasLiveData ? `Test alert (${liveSummary(server)})` : 'Test alert'));

    $('remove')?.addEventListener('click', () => {
        removeAlert(key);
        close();
    });

    $('save').addEventListener('click', () => {
        const alert: ServerAlert = {
            key,
            name,
            appid: target.appid,
            queryPort: target.queryPort,
            playersAtLeast: atLeastOn.checked ? parseCount(atLeast.value) : null,
            playersAtMost: atMostOn.checked ? parseCount(atMost.value) : null,
            mapChange: mapChange.checked,
            mapIs: mapIsOn.checked ? mapIs.value.trim() : '',
            firedAt: existing?.firedAt,
            firedReason: existing?.firedReason,
        };
        if (!hasTrigger(alert)) {
            removeAlert(key);
            close();
            return;
        }

        upsertAlert(alert);
        if (hasLiveData) lastSeen.set(key, snapshotOf(server));
        if (needsFavorite) {
            Promise.resolve(steamClient()?.ServerBrowser?.AddFavoriteServer?.(server))
                .then((err) => { if (err) logToConsole('ALERTS', `Could not add ${key} to favorites (${err})`, 'Warn'); })
                .catch((e) => logToConsole('ALERTS', `Could not add ${key} to favorites -> ${e}`, 'Error'));
        }
        close();
    });

    doc.body.appendChild(overlay);
}

export function editAlert(doc: Document, alert: ServerAlert): void {
    openAlertModal(doc, targetFromAlert(alert));
}
// #endregion



// #region POLLER
const POLL_INTERVAL_MS = 60_000;
const FIRST_POLL_DELAY_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;

interface Snapshot {
    players: number;
    map: string;
}

const lastSeen = new Map<string, Snapshot>();
const snapshotOf = (s: any): Snapshot => ({ players: Number(s.players ?? 0), map: String(s.map ?? '') });

let bypassHook = false;
let started = false;

export const isAlertRequest = (): boolean => bypassHook;

function queryFavorites(): Promise<any[] | null> {
    return new Promise((resolve) => {
        const SB = steamClient()?.ServerBrowser;
        if (!SB?.CreateServerListRequest) return resolve(null);

        const servers: any[] = [];
        let reqId: number | null = null;
        let done = false;

        const destroy = () => { try { if (reqId !== null) SB.DestroyServerListRequest(reqId); } catch { } };
        const finish = (result: any[] | null) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            destroy();
            resolve(result);
        };
        const timer = setTimeout(() => finish(servers.length ? servers : null), REQUEST_TIMEOUT_MS);

        let request: unknown;
        bypassHook = true;
        try {
            request = SB.CreateServerListRequest(0, 'favorites', [], (s: any) => servers.push(s), () => finish(servers));
        } catch {
            return finish(null);
        } finally {
            bypassHook = false;
        }

        Promise.resolve(request)
            .then((id) => {
                if (typeof id !== 'number') return;
                reqId = id;
                if (done) destroy();
            })
            .catch(() => finish(null));
    });
}

export function evaluateTriggers(alert: ServerAlert, prev: Snapshot, cur: Snapshot): string[] {
    const reasons: string[] = [];
    if (alert.playersAtLeast !== null && prev.players < alert.playersAtLeast && cur.players >= alert.playersAtLeast) {
        reasons.push(`reached ${alert.playersAtLeast}+ players`);
    }
    if (alert.playersAtMost !== null && prev.players > alert.playersAtMost && cur.players <= alert.playersAtMost) {
        reasons.push(`dropped to ${alert.playersAtMost} or fewer players`);
    }
    if (alert.mapChange && prev.map !== cur.map) {
        reasons.push(`map changed ${prev.map} -> ${cur.map}`);
    } else if (alert.mapIs && prev.map !== cur.map && cur.map.toLowerCase() === alert.mapIs.toLowerCase()) {
        reasons.push(`map changed to ${cur.map}`);
    }
    return reasons;
}

async function pollOnce(): Promise<void> {
    if (!loadAlerts().some(isActive)) return;

    const servers = await queryFavorites();
    if (!servers) return;

    const byKey = new Map(loadAlerts().filter(isActive).map((a) => [a.key, a]));
    const now = Date.now();
    for (const s of servers) {
        const alert = byKey.get(serverKey(s));
        if (!alert || !s.bHadSuccessfulResponse) continue;

        const cur = snapshotOf(s);
        const prev = lastSeen.get(alert.key);
        lastSeen.set(alert.key, cur);
        if (!prev) continue;

        const reasons = evaluateTriggers(alert, prev, cur);
        if (!reasons.length) continue;

        const reason = reasons.join(', ');
        logToConsole('ALERTS', `Alert fired for ${alert.name}: ${reason}`);
        sendToastNotification(targetFromAlert(alert, cur.map), `${reason} (${liveSummary(s)})`);
        upsertAlert({ ...alert, firedAt: now, firedReason: reason });
    }
}

export function startAlertPoller(): void {
    if (started) return;
    started = true;
    startFavoritesTracking();
    const tick = async () => {
        try { await pollOnce(); } catch (e) { logToConsole('ALERTS', `Poll failed -> ${e}`, 'Error'); }
        setTimeout(tick, POLL_INTERVAL_MS);
    };
    setTimeout(tick, FIRST_POLL_DELAY_MS);
}
// #endregion

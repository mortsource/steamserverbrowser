import { Buffer } from 'buffer';
import { Reader, CityResponse } from 'mmdb-lib';
import { constSysfsExpr } from '@steambrew/client';

// #region HELPERS
export const serversMap = new Map<string, any>();
export const VERIFIED_NAME_MARKER = '​';

type LogSystem = 'SYSTEM' | 'ALERTS' | 'FILTERS' | 'VIEW';
type LogLevel = 'Info' | 'Warn' | 'Error';

const LOG_COLORS: Record<LogLevel, string> = { Info: '#544c4a', Warn: '#DD571c', Error: '#800000' };
const LOG_METHODS: Record<LogLevel, 'log' | 'warn' | 'error'> = { Info: 'log', Warn: 'warn', Error: 'error' };

export function logToConsole(system: LogSystem, message: string, level: LogLevel = 'Info') {
    const base = 'color:#fff;padding:2px 6px;font-weight:600';
    console[LOG_METHODS[level]](`%cServerBrowserPlus%c%c${system}%c ${message}`, `${base};background:#3e424b`, '', `${base};background:${LOG_COLORS[level]}`, '');
}

export const splitToSubnet24 = (ip: string): string => {
    const p = ip.split('.');
    return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0/24` : ip;
};

const ipToInt = (ip: string): number => {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || !p.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) return -1;
    return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
};

export function createIpMatcher(entries: string[]): (ip: string) => boolean {
    const netsByMask = new Map<number, Set<number>>();
    for (const entry of entries) {
        const [addr, lengthText = '32'] = entry.split('/');
        const length = Number(lengthText);
        const value = ipToInt(addr);
        if (value < 0 || !Number.isInteger(length) || length < 1 || length > 32) continue;
        const mask = (0xFFFFFFFF << (32 - length)) >>> 0;
        if (!netsByMask.has(mask)) netsByMask.set(mask, new Set());
        netsByMask.get(mask)!.add((value & mask) >>> 0);
    }
    return (ip) => {
        const value = ipToInt(ip);
        if (value < 0) return false;
        for (const [mask, nets] of netsByMask) if (nets.has((value & mask) >>> 0)) return true;
        return false;
    };
}
// #endregion



// #region REMOTE VERIFIED AND BLOCKLIST
function isValidSteamId64(id: any): id is string {
    return typeof id === 'string' && id !== '' && id !== '76561197960265728';
}

function getSteamId64(): Promise<string | null> {
    const immediate = (window as any)?.App?.m_CurrentUser?.strSteamID;
    if (isValidSteamId64(immediate)) return Promise.resolve(immediate);

    return new Promise((resolve) => {
        const steamUser = (window as any)?.SteamClient?.User;
        if (!steamUser?.RegisterForCurrentUserChanges) {
            resolve(null);
            return;
        }
        steamUser.RegisterForCurrentUserChanges((user: any) => {
            if (isValidSteamId64(user?.strSteamID)) resolve(user.strSteamID);
        });
    });
}

const PLUGIN_MANIFEST: { version: string } = JSON.parse(constSysfsExpr('plugin.json', { basePath: '..', encoding: 'utf8' }).content);
const PLUGIN_VERSION = PLUGIN_MANIFEST.version;
export let newVersionAvailable = false;

const REMOTE_BLOCKLIST_KEY = 'sbplus_remoteblocklist';
let verifiedSetCache: Set<string> | null = null;

export function loadRemoteFilters(): any {
    try {
        const raw = localStorage.getItem(REMOTE_BLOCKLIST_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function isRemoteVerified(ip: string, port: number): boolean {
    if (!verifiedSetCache) verifiedSetCache = new Set(loadRemoteFilters()?.verifiedIps ?? []);
    return verifiedSetCache.has(`${ip}:${port}`);
}

export async function updatePluginData(): Promise<string> {
    const steamId = await getSteamId64();
    if (!steamId) return 'Could not determine SteamID64';

    try {
        const res = await fetch(`https://purecsgo.com/api/plugin?_=${Date.now()}`, {
            headers: { 
                'Content-Type': 'application/json',
                'x-plugin-steamid': steamId,
                'x-plugin-version': PLUGIN_VERSION
            },
            cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!data?.success || !data.rows) throw new Error('Malformed API response');
        const rows = data.rows;

        if (rows.version && rows.version !== PLUGIN_VERSION) newVersionAvailable = true;

        const stored = JSON.parse(localStorage.getItem(REMOTE_BLOCKLIST_KEY) ?? 'null');
        if (stored?.timestamp != null && rows.timestamp == stored.timestamp) {
            return 'Up-to-date';
        }

        const lists = rows.lists ?? [];
        const verifiedIps = lists.flatMap((e: any) => e.verified ?? []);
        const ipBlocklist = lists.flatMap((e: any) => e['bad-ips'] ?? []);
        const hostnamePatterns = lists.flatMap((e: any) => e['bad-patterns'] ?? []);

        localStorage.setItem(REMOTE_BLOCKLIST_KEY, JSON.stringify({ timestamp: rows.timestamp, verifiedIps, ipBlocklist, hostnamePatterns }));
        verifiedSetCache = new Set(verifiedIps);
        return 'Updated';
    } catch (e) {
        return 'Update failed';
    }
}
// #endregion



// #region FAVORITES
let favoriteKeys = new Set<string>();
let favoritesTracked = false;
const favoritesListeners = new Set<() => void>();

export const onFavoritesChanged = (cb: () => void): void => { favoritesListeners.add(cb); };
export const isFavorite = (key: string): boolean => favoriteKeys.has(key);

export function startFavoritesTracking(): void {
    if (favoritesTracked) return;
    const SB = (window as any).SteamClient?.ServerBrowser;
    if (!SB?.RegisterForFavorites) return;
    favoritesTracked = true;
    SB.RegisterForFavorites((list: any) => {
        favoriteKeys = new Set((list?.favorites ?? []).map((s: any) => `${s.ip}:${s.port}`));
        favoritesListeners.forEach((cb) => cb());
    });
}
// #endregion



// #region LOCAL BLOCKLIST
const LOCAL_BLOCKLIST_KEY = 'sbplus_localblocklist';

export function loadLocalBlocklist(): string[] {
    try {
        const raw = localStorage.getItem(LOCAL_BLOCKLIST_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((e: any): e is string => typeof e === 'string') : [];
    } catch {
        return [];
    }
}

export function blockLocally(entry: string): void {
    const verifiedIps: string[] = loadRemoteFilters()?.verifiedIps ?? [];
    const coversVerified = verifiedIps.some((addr) => {
        const ip = addr.split(':')[0];
        return ip === entry || splitToSubnet24(ip) === entry;
    });
    if (coversVerified) return;

    const list = loadLocalBlocklist();
    if (!list.includes(entry)) saveLocalBlocklist([...list, entry]);
}

function saveLocalBlocklist(entries: string[]): void {
    try {
        localStorage.setItem(LOCAL_BLOCKLIST_KEY, JSON.stringify(entries));
    } catch (e) {
        logToConsole('FILTERS', `Failed to save local blocklist: ${e}`, 'Error');
    }
}

export function removeFromLocalBlocklist(entry: string): void {
    saveLocalBlocklist(loadLocalBlocklist().filter((e) => e !== entry));
}
// #endregion



// #region GEOLITE2 MMDB
const GEO_DB_PATHS = ['./serverbrowserplus/GeoLite2-City.mmdb', './serverbrowserplus/GeoLite2-Country.mmdb'];
let reader: Reader<CityResponse> | null = null;

export async function initGeoDatabase(): Promise<void> {
    for (const path of GEO_DB_PATHS) {
        try {
            const res = await fetch(path);
            if (!res.ok) continue;
            const buf = Buffer.from(await res.arrayBuffer());
            reader = new Reader<CityResponse>(buf);
            logToConsole('SYSTEM', `GeoIP database loaded: ${path}`);
            return;
        } catch { }
    }
    logToConsole('SYSTEM', 'No GeoIP database found (checked serverbrowserplus/GeoLite2-City.mmdb, serverbrowserplus/GeoLite2-Country.mmdb)', 'Warn');
}

export interface GeoRecord {
    countryCode: string;
    countryName: string;
    cityName: string | null;
    subdivisionName: string | null;
    latitude: number | null;
    longitude: number | null;
}

export function lookupGeo(ip: string): GeoRecord | null {
    if (!reader) return null;
    try {
        const record = reader.get(ip);
        const country = record?.country;
        if (!country?.iso_code) return null;
        const subdivisions = record?.subdivisions;
        return {
            countryCode: country.iso_code,
            countryName: country.names?.en ?? country.iso_code,
            cityName: record?.city?.names?.en ?? null,
            subdivisionName: subdivisions?.length ? subdivisions[subdivisions.length - 1].names?.en ?? null : null,
            latitude: record?.location?.latitude ?? null,
            longitude: record?.location?.longitude ?? null,
        };
    } catch {
        return null;
    }
}
// #endregion
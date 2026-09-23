import { Buffer } from 'buffer';
import { Reader, CityResponse } from 'mmdb-lib';
import { constSysfsExpr } from '@steambrew/client';

// HELPERS ————————————————————————————————————————————————————————————
export const serversMap = new Map<string, any>();
export const VERIFIED_NAME_MARKER = '​';

export function logToConsole(message: string, type: 'Info' | 'Warn' | 'Error' = 'Info') {
    let LOG_STYLES = {
        Plugin: [
            'background:#3e424b',
            'color:#fff',
            'padding:2px 6px',
            'font-weight:600',
        ].join(';'),

        Info: [
            'background:#544c4a',
            'color:#fff',
            'padding:2px 6px',
            'font-weight:600',
        ].join(';'),

        Warn: [
            'background:#DD571c',
            'color:#fff',
            'padding:2px 6px',
            'font-weight:600',
        ].join(';'),

        Error: [
            'background:#800000',
            'color:#fff',
            'padding:2px 6px',
            'font-weight:600',
        ].join(';'),
    };
    const style = LOG_STYLES[type] ?? LOG_STYLES.Info;
    console.log(`%cServerBrowserPlus%c%c${type}%c ${message}`, LOG_STYLES.Plugin, '', style, '');
}



// PLUGIN DATA ————————————————————————————————————————————————————————————
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
export let NEW_VERSION_AVAILABLE = false;

const STORAGE_KEY = 'sbplus_remoteblocklist';
let verifiedSetCache: Set<string> | null = null;

export async function updatePluginData(): Promise<string> {
    const steamId = await getSteamId64();
    if (!steamId) return 'Could not determine SteamID64';

    try {
        const res = await fetch(`https://purecsgo.com/api/plugin?steamid=${encodeURIComponent(steamId)}&version=${encodeURIComponent(PLUGIN_VERSION)}&_=${Date.now()}`, {
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!data?.success || !data.rows) throw new Error('Malformed API response');
        const rows = data.rows;

        if (rows.version && rows.version !== PLUGIN_VERSION) NEW_VERSION_AVAILABLE = true;

        const stored = loadRemoteFilters();
        if (stored?.timestamp != null && rows.timestamp == stored.timestamp) {
            return 'Up-to-date';
        }

        const lists = rows.lists ?? [];
        const verifiedIps = lists.flatMap((e: any) => e.verified ?? []);
        const ipBlocklist = lists.flatMap((e: any) => e['bad-ips'] ?? []);
        const hostnamePatterns = lists.flatMap((e: any) => e['bad-patterns'] ?? []);

        localStorage.setItem(STORAGE_KEY, JSON.stringify({ timestamp: rows.timestamp, verifiedIps, ipBlocklist, hostnamePatterns }));
        verifiedSetCache = new Set(verifiedIps);
        return 'Updated';
    } catch (e) {
        return 'Update failed';
    }
}

export function loadRemoteFilters(): any {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function isRemoteVerified(ip: string, port: number): boolean {
    if (!verifiedSetCache) verifiedSetCache = new Set(loadRemoteFilters()?.verifiedIps ?? []);
    return verifiedSetCache.has(`${ip}:${port}`);
}



// IP / CIDR MATCHING ————————————————————————————————————————————————————————————
export const ipToInt = (ip: string): number => {
    const p = ip.split('.');
    if (p.length !== 4) return -1;
    return ((+p[0] * 256 + +p[1]) * 256 + +p[2]) * 256 + +p[3];
};

export interface CidrBucket { mask: number; nets: Set<number>; }
export interface IpMatcher { ipSet: Set<string>; buckets: CidrBucket[]; }

export function buildIpMatcher(entries: string[]): IpMatcher {
    const ipSet = new Set<string>();
    const byLength = new Map<number, Set<number>>();

    for (const entry of entries) {
        if (!entry.includes('/')) { ipSet.add(entry); continue; }

        const [addr, lengthText] = entry.split('/');
        const length = Number(lengthText);
        const value = ipToInt(addr);
        if (value < 0 || !Number.isInteger(length) || length < 1 || length > 32) continue;

        const mask = (0xFFFFFFFF << (32 - length)) >>> 0;
        let nets = byLength.get(length);
        if (!nets) byLength.set(length, nets = new Set());
        nets.add((value & mask) >>> 0);
    }

    const buckets = [...byLength.entries()]
        .map(([length, nets]) => ({ mask: (0xFFFFFFFF << (32 - length)) >>> 0, nets }));
    return { ipSet, buckets };
}

export function matchesIpMatcher(ip: string, matcher: IpMatcher): boolean {
    if (matcher.ipSet.has(ip)) return true;
    const value = ipToInt(ip);
    if (value < 0) return false;
    for (const { mask, nets } of matcher.buckets) {
        if (nets.has((value & mask) >>> 0)) return true;
    }
    return false;
}

export const subnet24 = (ip: string): string => {
    const p = ip.split('.');
    return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0/24` : ip;
};



// LOCAL BLOCKLIST ————————————————————————————————————————————————————————————
const LOCAL_BLOCKLIST_KEY = 'sbplus_localblocklist';
let localBlocklistMatcher: IpMatcher = buildIpMatcher([]);

export function loadLocalBlocklist(): string[] {
    try {
        const raw = localStorage.getItem(LOCAL_BLOCKLIST_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((e: any): e is string => typeof e === 'string') : [];
    } catch {
        return [];
    }
}

function saveLocalBlocklist(entries: string[]): void {
    try {
        localStorage.setItem(LOCAL_BLOCKLIST_KEY, JSON.stringify(entries));
    } catch (e) {
        logToConsole(`Failed to save local blocklist: ${e}`, 'Error');
    }
}

export function refreshLocalBlocklistCache(): void {
    localBlocklistMatcher = buildIpMatcher(loadLocalBlocklist());
}
refreshLocalBlocklistCache();

export function isLocallyBlocked(ip: string): boolean {
    return matchesIpMatcher(ip, localBlocklistMatcher);
}

export function addToLocalBlocklist(entry: string): boolean {
    const list = loadLocalBlocklist();
    if (list.includes(entry)) return false;
    saveLocalBlocklist([...list, entry]);
    refreshLocalBlocklistCache();
    return true;
}

export function removeFromLocalBlocklist(entry: string): void {
    saveLocalBlocklist(loadLocalBlocklist().filter((e) => e !== entry));
    refreshLocalBlocklistCache();
}

export function blockLocally(entry: string): void {
    if (!addToLocalBlocklist(entry)) {
        logToConsole(`'${entry}' is already in the local blocklist`, 'Info');
        return;
    }
    logToConsole(`Added '${entry}' to the local blocklist, applies on next refresh`, 'Info');
}



// GEOLITE2 MMDB ————————————————————————————————————————————————————————————
const GEO_DB_PATHS = ['./serverbrowserplus/GeoLite2-City.mmdb', './serverbrowserplus/GeoLite2-Country.mmdb'];
let reader: Reader<CityResponse> | null = null;
let loadPromise: Promise<void> | null = null;

async function loadReader(): Promise<void> {
    for (const path of GEO_DB_PATHS) {
        try {
            const res = await fetch(path);
            if (!res.ok) continue;
            const buf = Buffer.from(await res.arrayBuffer());
            reader = new Reader<CityResponse>(buf);
            logToConsole(`GeoIP database loaded: ${path}`, 'Info');
            return;
        } catch { }
    }
    logToConsole('No GeoIP database found (checked serverbrowserplus/GeoLite2-City.mmdb, serverbrowserplus/GeoLite2-Country.mmdb)', 'Warn');
}

export function initGeoDatabase(): Promise<void> {
    console.log('ServerBrowserPlus Initializing GeoLite...')
    if (!loadPromise) loadPromise = loadReader();
    return loadPromise;
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
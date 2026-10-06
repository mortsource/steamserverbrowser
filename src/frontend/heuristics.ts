import { GameServer } from '@steambrew/client';
import type { OnServerCb, OnCompleteCb } from './index';
import {
    logToConsole, serversMap, GeoRecord, lookupGeo, VERIFIED_NAME_MARKER,
    loadRemoteFilters, loadLocalBlocklist, isRemoteVerified, createIpMatcher
} from './shared';
import { updateCounter } from './ui/elements';
import { CONFIG_KEY, DEFAULTS } from './ui/settings';

// #region CACHE
let filterCache: Record<string, any> | null = null;

function buildFilterCache(): void {
    try {
        const stored = localStorage.getItem(CONFIG_KEY);
        filterCache = stored ? JSON.parse(stored) : {};
    } catch {
        filterCache = {};
    }
}

const isFilterEnabled = (key: string): boolean => {
    if (!filterCache) buildFilterCache();
    const val = filterCache![key];
    return Boolean(val === undefined ? DEFAULTS[key] ?? true : val);
};

function compilePatterns(patterns: string[]): RegExp[] {
    const compiled: RegExp[] = [];
    for (const p of patterns) {
        try {
            const literalMatch = p.match(/^\/(.+)\/([gimsuy]*)$/);
            const flags = literalMatch?.[2] ? literalMatch[2].replace(/[gy]/g, '') : 'i';
            compiled.push(new RegExp(literalMatch ? literalMatch[1] : p, flags));
        } catch { }
    }
    return compiled;
}

let isRemoteIpBlocked = createIpMatcher([]);
let isLocallyBlocked = createIpMatcher([]);
let remoteHostnameRegexes: RegExp[] = [];

export function refreshCaches() {
    buildFilterCache();
    const stored = loadRemoteFilters();
    isRemoteIpBlocked = createIpMatcher(stored?.ipBlocklist ?? []);
    remoteHostnameRegexes = compilePatterns(stored?.hostnamePatterns ?? []);
    isLocallyBlocked = createIpMatcher(loadLocalBlocklist());
}
// #endregion



// #region PROCESSING
let serverStats = {
    count_servers_verified: 0,
    count_servers_good: 0,
    count_players_verified: 0,
    count_players_good: 0
};

export function resetCounters() {
    serverStats = {
        count_servers_verified: 0,
        count_servers_good: 0,
        count_players_verified: 0,
        count_players_good: 0
    };
    serversMap.clear();
    updateCounter(serverStats);
}

const COUNTER_STRIKE_APP_IDS: number[] = [10, 80, 240, 730, 4465480]
const COUNTER_STRIKE_PORT_RANGE: [number, number] = [26000, 30000];
const hasEmoji = (s: string): boolean => /\p{Extended_Pictographic}/u.test(s);
const hasCyrillic = (s: string): boolean => /[\p{Script=Cyrillic}]/u.test(s);
const hasChinese = (s: string): boolean => /[\p{Script=Han}]/u.test(s);
const isRemoteBlocked = (ip: string, hostname: string): boolean => {
    if (isRemoteIpBlocked(ip)) return true;
    if (remoteHostnameRegexes.some(re => re.test(hostname))) return true;
    return false;
};

export function isGoodServer(tab: string, server: GameServer, geo: GeoRecord): boolean {
    const { name, ip, port, players, maxPlayers } = server;

    // Intentional ordering
    if (tab === 'favorites')
        return true;

    if (geo?.countryCode === 'RU' || geo?.countryCode === 'BY')
        return false;

    if (server.appid && !COUNTER_STRIKE_APP_IDS.includes(server.appid))
        return true;

    if (isFilterEnabled('filter_emoji') && hasEmoji(name))
        return false;

    if (isFilterEnabled('filter_cyrillic') && hasCyrillic(name))
        return false;

    if (isFilterEnabled('filter_chinese') && hasChinese(name))
        return false;

    if (isFilterEnabled('filter_player_spoof') && (players > 64 || maxPlayers > 64))
        return false;

    if (isFilterEnabled('filter_unusual_port') && (port < COUNTER_STRIKE_PORT_RANGE[0] || port > COUNTER_STRIKE_PORT_RANGE[1]))
        return false;

    if (isFilterEnabled('filter_personal_blocklist') && isLocallyBlocked(ip))
        return false;

    if (isFilterEnabled('filter_remote_blocklist') && isRemoteBlocked(ip, name))
        return false;

    return true;
}

export function processServer(tab: string, srv: GameServer, serverCallback: OnServerCb): void {
    const geo = lookupGeo(srv.ip);

    if (!isGoodServer(tab, srv, geo))
        return;

    serverStats.count_servers_good++;
    serverStats.count_players_good += srv.players;
    const verified = isRemoteVerified(srv.ip, srv.port);
    if (verified) {
        serverStats.count_servers_verified++;
        serverStats.count_players_verified += srv.players;
        srv.name = VERIFIED_NAME_MARKER + srv.name;
    }

    serversMap.set(`${srv.ip}:${srv.port}`, { ...srv, verified, geo });
    updateCounter(serverStats);
    try {
        serverCallback(srv);
    } catch (e) {
        logToConsole('FILTERS', `Server callback threw for ${srv.ip}:${srv.port}: ${e}`, 'Error');
        throw e;
    }
}

export function requestCompleted(_serverTab: string, onComplete: OnCompleteCb, response: number): void {
    // logToConsole('FILTERS', `Request completed with response=${response} (0 = responded, 1 = failed to respond, 2 = no servers listed on master)`);
    onComplete(response);
}
// #endregion
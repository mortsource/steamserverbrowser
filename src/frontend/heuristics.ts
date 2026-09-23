import { GameServer } from '@steambrew/client';
import type { OnServerCb, OnCompleteCb } from './index';
import { isRemoteVerified, GeoRecord, lookupGeo, VERIFIED_NAME_MARKER, serversMap, loadRemoteFilters, buildIpMatcher, matchesIpMatcher, isLocallyBlocked, refreshLocalBlocklistCache, IpMatcher } from './shared';
import { ServerPlayerCounter } from './browser/elements';
import { CONFIG_KEY, DEFAULTS } from './browser/settings';
// import { recordConcentration, resetConcentration, printSummary, debugLogRejection } from './debug';

// PROCESSING ————————————————————————————————————————————————————————————
let serverStats = createServerStats();
let spamStats = createSpamStats();
let counterEl = new ServerPlayerCounter();
let pluginConfigCache: Record<string, any> | null = null;
let remoteMatcher: IpMatcher = buildIpMatcher([]);
let remoteHostnameRegexes: RegExp[] = [];

function compilePatterns(patterns: string[]): RegExp[] {
    const compiled: RegExp[] = [];
    for (const p of patterns) {
        try {
            const literalMatch = p.match(/^\/(.+)\/([gimsuy]*)$/);
            compiled.push(literalMatch ? new RegExp(literalMatch[1], literalMatch[2] || 'i') : new RegExp(p, 'i'));
        } catch { }
    }
    return compiled;
}

function refreshPluginConfigCache(): void {
    try {
        const stored = localStorage.getItem(CONFIG_KEY);
        pluginConfigCache = stored ? JSON.parse(stored) : {};
    } catch {
        pluginConfigCache = {};
    }
}

function rebuildRemoteFilterCache(): void {
    const stored = loadRemoteFilters();
    remoteMatcher = buildIpMatcher(stored?.ipBlocklist ?? []);
    remoteHostnameRegexes = compilePatterns(stored?.hostnamePatterns ?? []);
}

function createServerStats() {
    return {
        count_servers_total: 0,
        count_servers_verified: 0,
        count_servers_good: 0,
        count_servers_bad: 0,
        count_players_total: 0,
        count_players_verified: 0,
        count_players_good: 0,
        count_players_bad: 0,
    };
}

function createSpamStats() {
    return {
        count_remote_blocklist: 0,
        count_local_blocklist: 0,
        count_geographic: 0,
        count_cyrillic: 0,
        count_chinese: 0,
        count_emoji: 0,
        count_player_spoof: 0,
        count_port_range: 0
    };
}

export function resetCounters() {
    serverStats = createServerStats();
    spamStats = createSpamStats();
    serversMap.clear();
    // resetConcentration();
    rebuildRemoteFilterCache();
    refreshLocalBlocklistCache();
    refreshPluginConfigCache();
    counterEl.update(serverStats);
}

export function processServer(tab: string, srv: GameServer, serverCallback: OnServerCb): void {
    serverStats.count_servers_total++;
    serverStats.count_players_total += srv.players;

    // if (!(isFilterEnabled('filter_remote_blocklist') && isBlockedServer(srv.ip, srv.name))) recordConcentration(srv.ip);

    const geo = lookupGeo(srv.ip);
    
    if (!isGoodServer(tab, srv, geo, spamStats)) {
        serverStats.count_servers_bad++;
        serverStats.count_players_bad += srv.players;
        counterEl.update(serverStats);
        return;
    }

    serverStats.count_servers_good++;
    serverStats.count_players_good += srv.players;
    const verified = isRemoteVerified(srv.ip, srv.port);
    if (verified) {
        serverStats.count_servers_verified++;
        serverStats.count_players_verified += srv.players;
    }
    srv.name = markVerifiedName(srv.name, verified);

    serversMap.set(`${srv.ip}:${srv.port}`, { ...srv, verified, geo });
    counterEl.update(serverStats);
    serverCallback(srv);
}

export function requestCompleted(_serverTab: string, onComplete: OnCompleteCb, response: number): void {
    // printSummary(_serverTab, serverStats, spamStats);
    onComplete(response);
}



// HEURISTICS ————————————————————————————————————————————————————————————
const COUNTER_STRIKE_APP_IDS = [10, 80, 240, 730, 4465480] // CS, CS:CZ, CS:S, CS2, CS:GO Legacy
const COUNTER_STRIKE_PORT_RANGE: [number, number] = [26000, 30000]; // expanded from 27000-27999 to allow larger networks while blocking spam
const isCyrillic = (s: string): boolean => /[\p{Script=Cyrillic}]/u.test(s);
const isChinese = (s: string): boolean => /[\p{Script=Han}]/u.test(s);
const hasEmoji = (s: string): boolean => /\p{Extended_Pictographic}/u.test(s);

const isSuspiciousPort = (port: number): boolean =>
    port < COUNTER_STRIKE_PORT_RANGE[0] || port > COUNTER_STRIKE_PORT_RANGE[1];

function isBlockedServer(ip: string, hostname: string): boolean {
    if (matchesIpMatcher(ip, remoteMatcher)) return true;
    if (remoteHostnameRegexes.some(re => re.test(hostname))) return true;
    return false;
}

function markVerifiedName(name: string, verified: boolean): string {
    const stripped = (name ?? '').split(VERIFIED_NAME_MARKER).join('');
    return verified ? VERIFIED_NAME_MARKER + stripped : stripped;
}

const isFilterEnabled = (key: string): boolean => {
    if (!pluginConfigCache) refreshPluginConfigCache();
    const val = pluginConfigCache![key];
    return Boolean(val === undefined ? DEFAULTS[key] ?? true : val);
};

export function isGoodServer(tab: string, server: GameServer, geo: GeoRecord, stats: any): boolean {
    const { name, ip, port, players, maxPlayers } = server;
    // const addr = `${ip}:${port}`;

    // This ordering is intentional.
    if (tab === 'favorites')
        return true;

    if (geo?.countryCode === 'RU' || geo?.countryCode === 'BY') {
        // debugLogRejection('Geographic', addr, name, players, maxPlayers);
        stats.count_geographic++;
        return false;
    }

    if (server.appid && !COUNTER_STRIKE_APP_IDS.includes(server.appid))
        return true;

    if (isFilterEnabled('filter_emoji') && hasEmoji(name)) {
        // debugLogRejection('Emojis', addr, name, players, maxPlayers);
        stats.count_emoji++;
        return false;
    }

    if (isFilterEnabled('filter_cyrillic') && isCyrillic(name)) {
        // debugLogRejection('Cyrillic', addr, name, players, maxPlayers);
        stats.count_cyrillic++;
        return false;
    }

    if (isFilterEnabled('filter_chinese') && isChinese(name)) {
        // debugLogRejection('Chinese', addr, name, players, maxPlayers);
        stats.count_chinese++;
        return false;
    }

    if (isFilterEnabled('filter_player_spoof') && (players > 64 || maxPlayers > 64)) {
        // debugLogRejection('PlayerSpoof', addr, name, players, maxPlayers);
        stats.count_player_spoof++;
        return false;
    }

    if (isFilterEnabled('filter_unusual_port') && isSuspiciousPort(port)) {
        // debugLogRejection('PortRange', addr, name, players, maxPlayers);
        stats.count_port_range++;
        return false;
    }

    if (isFilterEnabled('filter_personal_blocklist') && isLocallyBlocked(ip)) {
        // debugLogRejection('LocalBlocklist', addr, name, players, maxPlayers);
        stats.count_local_blocklist++;
        return false;
    }

    if (isFilterEnabled('filter_remote_blocklist')) {
        if (isBlockedServer(ip, name)) {
            // debugLogRejection('RemoteBlocklist', addr, name, players, maxPlayers);
            stats.count_remote_blocklist++;
            return false;
        }
    }

    return true;
}
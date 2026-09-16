import { GameServer } from '@steambrew/client';
import type { OnServerCb, OnCompleteCb } from './index';
import { isRemoteVerified, GeoRecord, lookupGeo, VERIFIED_NAME_MARKER, serversMap, loadRemoteFilters } from './shared';
import { ServerPlayerCounter } from './browser/elements';
import { CONFIG_KEY } from './browser/settings';

// PROCESSING ————————————————————————————————————————————————————————————
let serverStats = createServerStats();
let spamStats = createSpamStats();
let counterEl = new ServerPlayerCounter();
let pluginConfigCache: Record<string, any> | null = null;
let remoteIpSet = new Set<string>();
let remoteHostnameRegexes: RegExp[] = [];
let remoteCidrBuckets: { mask: number; nets: Set<number> }[] = [];

const ipToInt = (ip: string): number => {
    const p = ip.split('.');
    if (p.length !== 4) return -1;
    return ((+p[0] * 256 + +p[1]) * 256 + +p[2]) * 256 + +p[3];
};

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
    remoteIpSet = new Set();

    const byLength = new Map<number, Set<number>>();
    for (const entry of stored?.ipBlocklist ?? []) {
        if (!entry.includes('/')) { remoteIpSet.add(entry); continue; }

        const [addr, lengthText] = entry.split('/');
        const length = Number(lengthText);
        const value = ipToInt(addr);
        if (value < 0 || !Number.isInteger(length) || length < 1 || length > 32) continue;

        const mask = (0xFFFFFFFF << (32 - length)) >>> 0;
        let nets = byLength.get(length);
        if (!nets) byLength.set(length, nets = new Set());
        nets.add((value & mask) >>> 0);
    }

    remoteCidrBuckets = [...byLength.entries()]
        .map(([length, nets]) => ({ mask: (0xFFFFFFFF << (32 - length)) >>> 0, nets }));
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
        count_blocklist: 0,
        count_geographic: 0,
        count_cyrillic: 0,
        count_emoji: 0,
        count_player_spoof: 0,
        count_port_range: 0
    };
}

export function resetCounters() {
    serverStats = createServerStats();
    spamStats = createSpamStats();
    serversMap.clear();
    rebuildRemoteFilterCache();
    refreshPluginConfigCache();
    counterEl.update(serverStats);
}

export function processServer(tab: string, srv: GameServer, serverCallback: OnServerCb): void {
    serverStats.count_servers_total++;
    serverStats.count_players_total += srv.players;

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

export function requestCompleted(onComplete: OnCompleteCb, response: number): void {
    onComplete(response);
}



// HEURISTICS ————————————————————————————————————————————————————————————
const COUNTER_STRIKE_APP_IDS = [10, 80, 240, 730, 4465480] // CS, CS:CZ, CS:S, CS2, CS:GO Legacy
const COUNTER_STRIKE_PORT_RANGE: [number, number] = [26000, 30000]; // expanded from 27000-27999 to allow larger networks while blocking spam
const isCyrillic = (s: string): boolean => /[\p{Script=Cyrillic}]/u.test(s);
const hasEmoji = (s: string): boolean => /\p{Extended_Pictographic}/u.test(s);

const isSuspiciousPort = (port: number): boolean =>
    port < COUNTER_STRIKE_PORT_RANGE[0] || port > COUNTER_STRIKE_PORT_RANGE[1];

function isBlockedServer(ip: string, hostname: string): boolean {
    if (remoteIpSet.has(ip)) return true;

    const value = ipToInt(ip);
    if (value >= 0) {
        for (const { mask, nets } of remoteCidrBuckets) {
            if (nets.has((value & mask) >>> 0)) return true;
        }
    }

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
    return val === undefined ? true : Boolean(val);
};

export function isGoodServer(tab: string, server: GameServer, geo: GeoRecord, stats: any): boolean {
    const { name, ip, port, players, maxPlayers } = server;

    // This ordering is intentional.
    if (tab === 'favorites')
        return true;

    if (geo?.countryCode === 'RU' || geo?.countryCode === 'BY') {
        stats.count_geographic++;
        return false;
    }

    if (server.appid && !COUNTER_STRIKE_APP_IDS.includes(server.appid))
        return true;

    if (isFilterEnabled('filter_emoji') && hasEmoji(name)) {
        stats.count_emoji++;
        return false;
    }

    if (isFilterEnabled('filter_cyrillic') && isCyrillic(name)) {
        stats.count_cyrillic++;
        return false;
    }

    if (isFilterEnabled('filter_player_spoof') && (players > 64 || maxPlayers > 64)) {
        stats.count_player_spoof++;
        return false;
    }

    if (isFilterEnabled('filter_port_range') && isSuspiciousPort(port)) {
        stats.count_port_range++;
        return false;
    }

    if (isFilterEnabled('filter_blocklist')) {
        if (isBlockedServer(ip, name)) {
            stats.count_blocklist++;
            return false;
        }
    }

    return true;
}
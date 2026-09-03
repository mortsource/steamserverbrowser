import { GameServer } from '@steambrew/client';
import type { OnServerCb, OnCompleteCb } from './index';
import { logToConsole, isDynamicVerified, lookupGeo, VERIFIED_NAME_MARKER, serversMap, loadDynamicFilters } from './shared';
import { ServerPlayerCounter } from './browser/elements';

// PROCESSING ————————————————————————————————————————————————————————————
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
        count_player_spoof: 0
    };
}

let serverStats = createServerStats();
let spamStats = createSpamStats();

let counterEl = new ServerPlayerCounter();

export function resetCounters() {
    serverStats = createServerStats();
    spamStats = createSpamStats();
    serversMap.clear();
    rebuildDynamicFilterCache();
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
    const verified = isDynamicVerified(srv.ip, srv.port);
    if (verified) {
        serverStats.count_servers_verified++;
        serverStats.count_players_verified += srv.players;
    }
    srv.name = markVerifiedName(srv.name, verified);

    serversMap.set(`${srv.ip}:${srv.port}`, { ...srv, verified, geo });
    counterEl.update(serverStats);
    serverCallback(srv);
}

function printSummary(tab: string) {
    let header = `Tab: ${tab} | ` +
        `Total: ${serverStats.count_servers_total} | ` +
        `Verified: ${serverStats.count_servers_verified} | ` +
        `Good: ${serverStats.count_servers_good} | ` +
        `Bad: ${serverStats.count_servers_bad}`;
    logToConsole(header, 'Info');

    let summary = `Blocklist: ${spamStats.count_blocklist} | ` +
        `Geographic: ${spamStats.count_geographic} | ` +
        `Emojis: ${spamStats.count_emoji} | ` +
        `Cyrillic: ${spamStats.count_cyrillic} | ` +
        `Player Spoofing: ${spamStats.count_player_spoof}`

    logToConsole(summary, 'Info');
}

export function requestCompleted(serverTab: string, onComplete: OnCompleteCb, response: number): void {
    printSummary(serverTab);
    onComplete(response);
}



// CONFIGURATION ————————————————————————————————————————————————————————————
const ipToInt = (ip: string): number => {
    const p = ip.split('.');
    if (p.length !== 4) return -1;
    return ((+p[0] * 256 + +p[1]) * 256 + +p[2]) * 256 + +p[3];
};

const isFilterEnabled = (key: string): boolean => {
    if (!pluginConfigCache) refreshPluginConfigCache();
    const val = pluginConfigCache![key];
    return val === undefined ? true : Boolean(val);
};

let pluginConfigCache: Record<string, any> | null = null;
let dynamicIpSet = new Set<string>();
let dynamicHostnameRegexes: RegExp[] = [];
let dynamicCidrBuckets: { mask: number; nets: Set<number> }[] = [];

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
        const stored = localStorage.getItem('plugin_BrowserPlus_config');
        pluginConfigCache = stored ? JSON.parse(stored) : {};
    } catch {
        pluginConfigCache = {};
    }
}

function rebuildDynamicFilterCache(): void {
    const stored = loadDynamicFilters();
    dynamicIpSet = new Set();

    const byLength = new Map<number, Set<number>>();
    for (const entry of stored?.ipBlocklist ?? []) {
        if (!entry.includes('/')) { dynamicIpSet.add(entry); continue; }

        const [addr, lengthText] = entry.split('/');
        const length = Number(lengthText);
        const value = ipToInt(addr);
        if (value < 0 || !Number.isInteger(length) || length < 1 || length > 32) continue;

        const mask = (0xFFFFFFFF << (32 - length)) >>> 0;
        let nets = byLength.get(length);
        if (!nets) byLength.set(length, nets = new Set());
        nets.add((value & mask) >>> 0);
    }

    dynamicCidrBuckets = [...byLength.entries()]
        .map(([length, nets]) => ({ mask: (0xFFFFFFFF << (32 - length)) >>> 0, nets }));
    dynamicHostnameRegexes = compilePatterns(stored?.hostnamePatterns ?? []);
}



// HEURISTICS ————————————————————————————————————————————————————————————
const COUNTER_STRIKE_APP_IDS = [10, 80, 240, 730, 4465480] // CS, CS:CZ, CS:S, CS2, CS:GO Legacy
const isCyrillic = (s: string): boolean => /[\p{Script=Cyrillic}]/u.test(s);
const hasEmoji = (s: string): boolean => /\p{Extended_Pictographic}/u.test(s);

function isBlockedServer(ip: string, hostname: string): boolean {
    if (dynamicIpSet.has(ip)) return true;

    const value = ipToInt(ip);
    if (value >= 0) {
        for (const { mask, nets } of dynamicCidrBuckets) {
            if (nets.has((value & mask) >>> 0)) return true;
        }
    }

    if (dynamicHostnameRegexes.some(re => re.test(hostname))) return true;
    return false;
}

function markVerifiedName(name: string, verified: boolean): string {
    const stripped = (name ?? '').split(VERIFIED_NAME_MARKER).join('');
    return verified ? VERIFIED_NAME_MARKER + stripped : stripped;
}

export function isGoodServer(tab: string, server: GameServer, geo: any, stats: any): boolean {
    const { name, ip, players, maxPlayers } = server;

    if (tab === 'favorites')
        return true;

    // This is intentional, fuck Russia and Belarus.
    if (geo?.countryCode === 'RU' || geo?.countryCode === 'BY') {
        stats.count_geographic++;
        return false;
    }

    if (server.appid && !COUNTER_STRIKE_APP_IDS.includes(server.appid))
        return true;

    if (isFilterEnabled('filter_blocklist')) {
        if (isBlockedServer(ip, name)) {
            stats.count_blocklist++;
            return false;
        }
    }

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

    return true;
}
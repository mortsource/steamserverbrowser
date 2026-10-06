// Debug-only helpers for heuristics.ts. Not wired in by default -- uncomment the
// import and the matching callsites in heuristics.ts to enable.

import { logToConsole } from './shared';

const IP_THRESHOLD = 30;
const SUBNET_THRESHOLD = 50;
const ipCounts = new Map<string, number>();
const subnetCounts = new Map<string, number>();

export function recordConcentration(ip: string): void {
    if (!ip) return;
    ipCounts.set(ip, (ipCounts.get(ip) ?? 0) + 1);
    const subnet = ip.split('.').slice(0, 3).join('.');
    subnetCounts.set(subnet, (subnetCounts.get(subnet) ?? 0) + 1);
}

export function resetConcentration(): void {
    ipCounts.clear();
    subnetCounts.clear();
}

export function printConcentration(): void {
    const top = (map: Map<string, number>, min: number, suffix: string) =>
        [...map].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1])
            .map(([key, n]) => `${key}${suffix} (${n})`);

    const ips = top(ipCounts, IP_THRESHOLD, '');
    const subnets = top(subnetCounts, SUBNET_THRESHOLD, '.0/24');
    logToConsole('FILTERS', `IP concentration >=${IP_THRESHOLD}: ${ips.join(', ') || 'none'}`);
    logToConsole('FILTERS', `Subnet concentration >=${SUBNET_THRESHOLD}: ${subnets.join(', ') || 'none'}`);
}

export function debugLogRejection(tag: string, addr: string, name: string, players: number, maxPlayers: number): void {
    logToConsole('FILTERS', `${tag} ${addr}: ${name} (${players}/${maxPlayers})`);
}

export function printSummary(tab: string, serverStats: any, spamStats: any): void {
    logToConsole(
        'FILTERS',
        `Tab: ${tab} | ` +
        `Total: ${serverStats.count_servers_total} | ` +
        `Verified: ${serverStats.count_servers_verified} | ` +
        `Good: ${serverStats.count_servers_good} | ` +
        `Bad: ${serverStats.count_servers_bad}`
    );

    logToConsole(
        'FILTERS',
        `Remote Blocklist: ${spamStats.count_remote_blocklist} | ` +
        `Local Blocklist: ${spamStats.count_local_blocklist} | ` +
        `Geographic: ${spamStats.count_geographic} | ` +
        `Emojis: ${spamStats.count_emoji} | ` +
        `Cyrillic: ${spamStats.count_cyrillic} | ` +
        `Chinese: ${spamStats.count_chinese} | ` +
        `Player Spoofing: ${spamStats.count_player_spoof} | ` +
        `Port Range: ${spamStats.count_port_range}`
    );

    printConcentration();
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    loadRemoteFilters: vi.fn((): any => null),
    loadLocalBlocklist: vi.fn((): string[] => []),
    lookupGeo: vi.fn((): any => null),
    isRemoteVerified: vi.fn((): boolean => false),
    logToConsole: vi.fn(),
    updateCounter: vi.fn(),
}));

vi.mock('../src/frontend/ui/elements', () => ({
    updateCounter: mocks.updateCounter,
}));
vi.mock('../src/frontend/ui/settings', () => ({
    CONFIG_KEY: 'test_config',
    DEFAULTS: {},
}));
vi.mock('../src/frontend/shared', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/frontend/shared')>()),
    loadRemoteFilters: mocks.loadRemoteFilters,
    loadLocalBlocklist: mocks.loadLocalBlocklist,
    lookupGeo: mocks.lookupGeo,
    isRemoteVerified: mocks.isRemoteVerified,
    logToConsole: mocks.logToConsole,
}));

import { isGoodServer, processServer, refreshCaches, resetCounters } from '../src/frontend/heuristics';
import { serversMap, VERIFIED_NAME_MARKER, createIpMatcher } from '../src/frontend/shared';

const makeServer = (overrides: Record<string, any> = {}): any => ({
    name: 'Normal Community Server',
    ip: '1.2.3.4',
    port: 27015,
    players: 10,
    maxPlayers: 32,
    appid: 730,
    ...overrides,
});

const setup = (opts: { config?: Record<string, boolean>; remote?: any; local?: string[] } = {}): void => {
    localStorage.clear();
    if (opts.config) localStorage.setItem('test_config', JSON.stringify(opts.config));
    mocks.loadRemoteFilters.mockReturnValue(opts.remote ?? null);
    mocks.loadLocalBlocklist.mockReturnValue(opts.local ?? []);
    refreshCaches();
};

const isGood = (server: any, geo: any = null, tab = 'internet'): boolean => isGoodServer(tab, server, geo);

beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookupGeo.mockReturnValue(null);
    mocks.isRemoteVerified.mockReturnValue(false);
    setup();
    resetCounters();
});

describe('isGoodServer basics', () => {
    it('accepts a normal server', () => {
        expect(isGood(makeServer())).toBe(true);
    });

    it('always accepts servers on the favorites tab', () => {
        const server = makeServer({ name: '🔥 Спам 服务器', port: 1234, players: 100 });
        expect(isGood(server, null, 'favorites')).toBe(true);
    });

    it('accepts ports at the edges of the allowed range and rejects those just outside', () => {
        expect(isGood(makeServer({ port: 26000 }))).toBe(true);
        expect(isGood(makeServer({ port: 30000 }))).toBe(true);
        expect(isGood(makeServer({ port: 25999 }))).toBe(false);
        expect(isGood(makeServer({ port: 30001 }))).toBe(false);
    });

    it('skips filters for non Counter-Strike games', () => {
        const server = makeServer({ appid: 440, name: '🔥 TF2 Server', port: 1234 });
        expect(isGood(server)).toBe(true);
    });
});

describe('isGoodServer filter toggles', () => {
    const cases: Array<[string, string, Record<string, any>]> = [
        ['emoji names', 'filter_emoji', { name: '🔥 Best Server' }],
        ['Cyrillic names', 'filter_cyrillic', { name: 'Сервер CS' }],
        ['Chinese names', 'filter_chinese', { name: '中文服务器' }],
        ['spoofed player counts', 'filter_player_spoof', { players: 99 }],
        ['spoofed max player counts', 'filter_player_spoof', { maxPlayers: 128 }],
        ['unusual ports', 'filter_unusual_port', { port: 1234 }],
    ];

    it.each(cases)('rejects %s while %s is on', (_label, _key, overrides) => {
        expect(isGood(makeServer(overrides))).toBe(false);
    });

    it.each(cases)('allows %s once %s is turned off', (_label, key, overrides) => {
        setup({ config: { [key]: false } });
        expect(isGood(makeServer(overrides))).toBe(true);
    });

    it('only disables the filter that was turned off', () => {
        setup({ config: { filter_emoji: false } });
        expect(isGood(makeServer({ name: '🔥 Best Server' }))).toBe(true);
        expect(isGood(makeServer({ name: 'Сервер CS' }))).toBe(false);
    });

    it('falls back to every filter being on when the stored config is corrupt', () => {
        localStorage.setItem('test_config', '{not json');
        refreshCaches();
        expect(isGood(makeServer({ name: '🔥 Best Server' }))).toBe(false);
    });
});

describe('isGoodServer geography', () => {
    it('rejects servers located in Russia', () => {
        expect(isGood(makeServer(), { countryCode: 'RU' })).toBe(false);
    });

    it('rejects servers located in Belarus', () => {
        expect(isGood(makeServer(), { countryCode: 'BY' })).toBe(false);
    });

    it('accepts servers located elsewhere', () => {
        expect(isGood(makeServer(), { countryCode: 'US' })).toBe(true);
    });

    it('rejects Russian servers even for games outside Counter-Strike', () => {
        expect(isGood(makeServer({ appid: 440 }), { countryCode: 'RU' })).toBe(false);
    });

    it('still accepts a Russian server on the favorites tab', () => {
        expect(isGood(makeServer(), { countryCode: 'RU' }, 'favorites')).toBe(true);
    });
});

describe('isGoodServer personal blocklist', () => {
    it('rejects an exactly blocked IP', () => {
        setup({ local: ['1.2.3.4'] });
        expect(isGood(makeServer())).toBe(false);
        expect(isGood(makeServer({ ip: '1.2.3.5' }))).toBe(true);
    });

    it('rejects every IP in a blocked subnet', () => {
        setup({ local: ['1.2.3.0/24'] });
        expect(isGood(makeServer({ ip: '1.2.3.200' }))).toBe(false);
        expect(isGood(makeServer({ ip: '1.2.4.200' }))).toBe(true);
    });

    it('allows a blocked IP once the personal blocklist is turned off', () => {
        setup({ local: ['1.2.3.4'], config: { filter_personal_blocklist: false } });
        expect(isGood(makeServer())).toBe(true);
    });

    it('does not apply the personal blocklist to other games', () => {
        setup({ local: ['1.2.3.4'] });
        expect(isGood(makeServer({ appid: 440 }))).toBe(true);
    });

    it('picks up blocklist changes on the next cache refresh', () => {
        expect(isGood(makeServer())).toBe(true);
        setup({ local: ['1.2.3.4'] });
        expect(isGood(makeServer())).toBe(false);
        setup({ local: [] });
        expect(isGood(makeServer())).toBe(true);
    });
});

describe('isGoodServer remote blocklist', () => {
    it('rejects a remotely blocked IP and subnet', () => {
        setup({ remote: { ipBlocklist: ['9.9.9.9', '8.8.0.0/16'] } });
        expect(isGood(makeServer({ ip: '9.9.9.9' }))).toBe(false);
        expect(isGood(makeServer({ ip: '8.8.4.4' }))).toBe(false);
        expect(isGood(makeServer({ ip: '8.9.4.4' }))).toBe(true);
    });

    it('rejects hostnames matching a plain pattern, ignoring case', () => {
        setup({ remote: { hostnamePatterns: ['free skins'] } });
        expect(isGood(makeServer({ name: 'Get FREE SKINS here' }))).toBe(false);
        expect(isGood(makeServer({ name: 'Regular Server' }))).toBe(true);
    });

    it('supports regex syntax in plain patterns', () => {
        setup({ remote: { hostnamePatterns: ['^\\[AD\\]', 'casino\\d+'] } });
        expect(isGood(makeServer({ name: '[AD] Join now' }))).toBe(false);
        expect(isGood(makeServer({ name: 'best casino777 server' }))).toBe(false);
        expect(isGood(makeServer({ name: 'Not [AD] at the start' }))).toBe(true);
    });

    it('honours flags on /regex/flags patterns', () => {
        setup({ remote: { hostnamePatterns: ['/SPAM/'] } });
        expect(isGood(makeServer({ name: 'spam server' }))).toBe(false);

        setup({ remote: { hostnamePatterns: ['/SPAM/g'] } });
        expect(isGood(makeServer({ name: 'spam server' }))).toBe(true);
        expect(isGood(makeServer({ name: 'SPAM server' }))).toBe(false);
    });

    it('rejects every matching hostname in a row for a pattern with the g flag', () => {
        setup({ remote: { hostnamePatterns: ['/spam/gi'] } });
        expect(isGood(makeServer({ name: 'first spam server' }))).toBe(false);
        expect(isGood(makeServer({ name: 'spam again' }))).toBe(false);
        expect(isGood(makeServer({ name: 'more spam' }))).toBe(false);
    });

    it('skips an invalid pattern and keeps the valid ones', () => {
        setup({ remote: { hostnamePatterns: ['(unclosed', 'scam'] } });
        expect(isGood(makeServer({ name: 'scam server' }))).toBe(false);
        expect(isGood(makeServer({ name: '(unclosed server' }))).toBe(true);
    });

    it('allows remotely blocked servers once the remote blocklist is turned off', () => {
        setup({ remote: { ipBlocklist: ['9.9.9.9'], hostnamePatterns: ['scam'] }, config: { filter_remote_blocklist: false } });
        expect(isGood(makeServer({ ip: '9.9.9.9' }))).toBe(true);
        expect(isGood(makeServer({ name: 'scam server' }))).toBe(true);
    });

    it('accepts everything when no remote data has been downloaded', () => {
        setup({ remote: null });
        expect(isGood(makeServer())).toBe(true);
    });
});

describe('processServer', () => {
    const lastStats = (): any => mocks.updateCounter.mock.calls.at(-1)?.[0];

    it('passes a good server to the callback and records it', () => {
        const callback = vi.fn();
        const server = makeServer();
        processServer('internet', server, callback);

        expect(callback).toHaveBeenCalledExactlyOnceWith(server);
        expect(serversMap.get('1.2.3.4:27015')).toMatchObject({ ip: '1.2.3.4', port: 27015, verified: false, geo: null });
        expect(lastStats()).toMatchObject({ count_servers_good: 1, count_players_good: 10, count_servers_verified: 0, count_players_verified: 0 });
    });

    it('drops a rejected server without calling back, recording or counting it', () => {
        const callback = vi.fn();
        mocks.updateCounter.mockClear();
        processServer('internet', makeServer({ name: '🔥 Spam' }), callback);

        expect(callback).not.toHaveBeenCalled();
        expect(serversMap.size).toBe(0);
        expect(mocks.updateCounter).not.toHaveBeenCalled();
    });

    it('marks verified servers and counts them separately', () => {
        mocks.isRemoteVerified.mockReturnValue(true);
        const server = makeServer({ name: 'Verified Server', players: 7 });
        processServer('internet', server, vi.fn());

        expect(server.name).toBe(`${VERIFIED_NAME_MARKER}Verified Server`);
        expect(serversMap.get('1.2.3.4:27015').verified).toBe(true);
        expect(lastStats()).toMatchObject({ count_servers_good: 1, count_players_good: 7, count_servers_verified: 1, count_players_verified: 7 });
    });

    it('accumulates counts across servers', () => {
        processServer('internet', makeServer({ ip: '1.1.1.1', players: 5 }), vi.fn());
        processServer('internet', makeServer({ ip: '2.2.2.2', players: 8 }), vi.fn());
        processServer('internet', makeServer({ ip: '3.3.3.3', name: '🔥 Spam', players: 50 }), vi.fn());

        expect(lastStats()).toMatchObject({ count_servers_good: 2, count_players_good: 13 });
        expect([...serversMap.keys()]).toEqual(['1.1.1.1:27015', '2.2.2.2:27015']);
    });

    it('stores the looked-up location and rejects by it', () => {
        mocks.lookupGeo.mockReturnValue({ countryCode: 'DE' });
        processServer('internet', makeServer({ ip: '1.1.1.1' }), vi.fn());
        expect(serversMap.get('1.1.1.1:27015').geo).toEqual({ countryCode: 'DE' });

        const callback = vi.fn();
        mocks.lookupGeo.mockReturnValue({ countryCode: 'RU' });
        processServer('internet', makeServer({ ip: '2.2.2.2' }), callback);
        expect(callback).not.toHaveBeenCalled();
    });

    it('resets counts and recorded servers', () => {
        processServer('internet', makeServer(), vi.fn());
        resetCounters();

        expect(serversMap.size).toBe(0);
        expect(lastStats()).toEqual({ count_servers_good: 0, count_players_good: 0, count_servers_verified: 0, count_players_verified: 0 });
    });

    it('logs and rethrows when the callback throws', () => {
        const failing = vi.fn(() => { throw new Error('boom'); });
        expect(() => processServer('internet', makeServer(), failing)).toThrow('boom');
        expect(mocks.logToConsole).toHaveBeenCalledWith('FILTERS', expect.stringContaining('1.2.3.4:27015'), 'Error');
    });
});

describe('createIpMatcher', () => {
    it('matches an exact IP', () => {
        const matches = createIpMatcher(['1.2.3.4']);
        expect(matches('1.2.3.4')).toBe(true);
        expect(matches('1.2.3.5')).toBe(false);
    });

    it('treats a /32 entry the same as an exact IP', () => {
        const matches = createIpMatcher(['1.2.3.4/32']);
        expect(matches('1.2.3.4')).toBe(true);
        expect(matches('1.2.3.5')).toBe(false);
    });

    it('matches every address inside a /24', () => {
        const matches = createIpMatcher(['10.20.30.0/24']);
        expect(matches('10.20.30.0')).toBe(true);
        expect(matches('10.20.30.128')).toBe(true);
        expect(matches('10.20.30.255')).toBe(true);
    });

    it('rejects addresses just outside a /24', () => {
        const matches = createIpMatcher(['10.20.30.0/24']);
        expect(matches('10.20.29.255')).toBe(false);
        expect(matches('10.20.31.0')).toBe(false);
    });

    it('matches a /16 and rejects its neighbours', () => {
        const matches = createIpMatcher(['172.16.0.0/16']);
        expect(matches('172.16.0.1')).toBe(true);
        expect(matches('172.16.255.255')).toBe(true);
        expect(matches('172.15.255.255')).toBe(false);
        expect(matches('172.17.0.0')).toBe(false);
    });

    it('normalises a CIDR entry whose address is not the network address', () => {
        const matches = createIpMatcher(['10.20.30.77/24']);
        expect(matches('10.20.30.1')).toBe(true);
        expect(matches('10.20.31.1')).toBe(false);
    });

    it('handles addresses in the upper half of the IPv4 range', () => {
        const matches = createIpMatcher(['200.100.50.0/24', '255.255.255.255']);
        expect(matches('200.100.50.9')).toBe(true);
        expect(matches('255.255.255.255')).toBe(true);
        expect(matches('200.100.51.9')).toBe(false);
    });

    it('combines exact IPs and ranges of different sizes', () => {
        const matches = createIpMatcher(['1.2.3.4', '10.0.0.0/8', '192.168.1.0/24']);
        expect(matches('1.2.3.4')).toBe(true);
        expect(matches('10.200.3.4')).toBe(true);
        expect(matches('192.168.1.50')).toBe(true);
        expect(matches('192.168.2.50')).toBe(false);
        expect(matches('11.0.0.1')).toBe(false);
    });

    it('matches nothing when the list is empty', () => {
        const matches = createIpMatcher([]);
        expect(matches('1.2.3.4')).toBe(false);
        expect(matches('0.0.0.0')).toBe(false);
    });

    it('ignores malformed entries without matching unrelated addresses', () => {
        const matches = createIpMatcher(['a.b.c.d', '1.2.3', '1.2.3.4.5', '300.1.1.1', '1.2.3.0/33', '1.2.3.0/0', '1.2.3.0/x', '']);
        expect(matches('0.0.0.0')).toBe(false);
        expect(matches('1.2.3.4')).toBe(false);
        expect(matches('1.2.3.0')).toBe(false);
    });

    it('keeps valid entries when malformed ones are mixed in', () => {
        const matches = createIpMatcher(['not-an-ip', '5.6.7.8', 'a.b.c.d/24']);
        expect(matches('5.6.7.8')).toBe(true);
        expect(matches('0.0.0.1')).toBe(false);
    });

    it('never matches a malformed address being looked up', () => {
        const matches = createIpMatcher(['0.0.0.0/1', '1.2.3.4']);
        expect(matches('a.b.c.d')).toBe(false);
        expect(matches('1.2.3')).toBe(false);
        expect(matches('')).toBe(false);
    });
});

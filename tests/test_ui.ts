import { describe, it, expect } from 'vitest';
import { evaluateTriggers } from '../src/frontend/ui/alert';
import { spreadServerCoords } from '../src/frontend/ui/enhanced/map';
import { compareServers } from '../src/frontend/ui/enhanced/core';

// #region ALERT TRIGGERS
const makeAlert = (overrides: Record<string, any> = {}): any => ({
    key: '1.2.3.4:27015',
    name: 'Test Server',
    appid: 730,
    queryPort: 27015,
    playersAtLeast: null,
    playersAtMost: null,
    mapChange: false,
    mapIs: '',
    ...overrides,
});

const snap = (players: number, map = 'de_dust2') => ({ players, map });

describe('evaluateTriggers', () => {
    describe('players at least', () => {
        const alert = makeAlert({ playersAtLeast: 10 });

        it('fires when the count crosses the threshold upward', () => {
            expect(evaluateTriggers(alert, snap(9), snap(10))).toEqual(['reached 10+ players']);
            expect(evaluateTriggers(alert, snap(3), snap(18))).toEqual(['reached 10+ players']);
        });

        it('does not fire while the count stays at or above the threshold', () => {
            expect(evaluateTriggers(alert, snap(10), snap(12))).toEqual([]);
            expect(evaluateTriggers(alert, snap(12), snap(10))).toEqual([]);
        });

        it('does not fire while the count stays below the threshold', () => {
            expect(evaluateTriggers(alert, snap(4), snap(9))).toEqual([]);
        });

        it('does not fire when the count drops below the threshold', () => {
            expect(evaluateTriggers(alert, snap(12), snap(6))).toEqual([]);
        });
    });

    describe('players at most', () => {
        const alert = makeAlert({ playersAtMost: 5 });

        it('fires when the count drops to the threshold', () => {
            expect(evaluateTriggers(alert, snap(6), snap(5))).toEqual(['dropped to 5 or fewer players']);
            expect(evaluateTriggers(alert, snap(20), snap(0))).toEqual(['dropped to 5 or fewer players']);
        });

        it('does not fire while the count stays at or below the threshold', () => {
            expect(evaluateTriggers(alert, snap(5), snap(3))).toEqual([]);
            expect(evaluateTriggers(alert, snap(3), snap(5))).toEqual([]);
        });

        it('does not fire when the count rises above the threshold', () => {
            expect(evaluateTriggers(alert, snap(3), snap(9))).toEqual([]);
        });

        it('supports a threshold of zero for an emptied server', () => {
            const emptied = makeAlert({ playersAtMost: 0 });
            expect(evaluateTriggers(emptied, snap(1), snap(0))).toEqual(['dropped to 0 or fewer players']);
            expect(evaluateTriggers(emptied, snap(0), snap(0))).toEqual([]);
        });
    });

    describe('map change', () => {
        const alert = makeAlert({ mapChange: true });

        it('fires on any map change and names both maps', () => {
            expect(evaluateTriggers(alert, snap(5, 'de_dust2'), snap(5, 'de_inferno'))).toEqual(['map changed de_dust2 -> de_inferno']);
        });

        it('does not fire when the map is unchanged', () => {
            expect(evaluateTriggers(alert, snap(5, 'de_dust2'), snap(8, 'de_dust2'))).toEqual([]);
        });
    });

    describe('map changes to a specific map', () => {
        const alert = makeAlert({ mapIs: 'de_nuke' });

        it('fires when the server switches to that map', () => {
            expect(evaluateTriggers(alert, snap(5, 'de_dust2'), snap(5, 'de_nuke'))).toEqual(['map changed to de_nuke']);
        });

        it('matches the map name case-insensitively', () => {
            expect(evaluateTriggers(alert, snap(5, 'de_dust2'), snap(5, 'DE_Nuke'))).toEqual(['map changed to DE_Nuke']);
        });

        it('does not fire when the server switches to a different map', () => {
            expect(evaluateTriggers(alert, snap(5, 'de_dust2'), snap(5, 'de_inferno'))).toEqual([]);
        });

        it('does not fire while the server stays on that map', () => {
            expect(evaluateTriggers(alert, snap(5, 'de_nuke'), snap(9, 'de_nuke'))).toEqual([]);
        });
    });

    describe('combined triggers', () => {
        it('reports every trigger met in the same poll', () => {
            const alert = makeAlert({ playersAtLeast: 10, mapChange: true });
            expect(evaluateTriggers(alert, snap(4, 'de_dust2'), snap(12, 'de_inferno'))).toEqual([
                'reached 10+ players',
                'map changed de_dust2 -> de_inferno',
            ]);
        });

        it('reports a later trigger on its own after an earlier one already fired', () => {
            const alert = makeAlert({ playersAtLeast: 10, mapChange: true });
            expect(evaluateTriggers(alert, snap(4, 'de_dust2'), snap(12, 'de_dust2'))).toEqual(['reached 10+ players']);
            expect(evaluateTriggers(alert, snap(12, 'de_dust2'), snap(12, 'de_inferno'))).toEqual(['map changed de_dust2 -> de_inferno']);
        });

        it('reports a map change once when both map triggers are set', () => {
            const alert = makeAlert({ mapChange: true, mapIs: 'de_nuke' });
            expect(evaluateTriggers(alert, snap(5, 'de_dust2'), snap(5, 'de_nuke'))).toEqual(['map changed de_dust2 -> de_nuke']);
        });

        it('fires nothing when no triggers are set', () => {
            expect(evaluateTriggers(makeAlert(), snap(0, 'de_dust2'), snap(64, 'de_nuke'))).toEqual([]);
        });
    });
});
// #endregion



// #region MAP SPREAD
const CHICAGO = { latitude: 41.8781, longitude: -87.6298 };
const FRANKFURT = { latitude: 50.1109, longitude: 8.6821 };

const makeGeoServer = (ip: string, port: number, geo: any = CHICAGO): any => ({ ip, port, geo });
const keyOf = (server: any): string => `${server.ip}:${server.port}`;

const manyServers = (): any[] => {
    const servers: any[] = [];
    for (let subnet = 0; subnet < 4; subnet++) {
        for (let host = 1; host <= 6; host++) {
            for (let port = 27015; port < 27018; port++) servers.push(makeGeoServer(`10.0.${subnet}.${host}`, port));
        }
    }
    return servers;
};

describe('spreadServerCoords', () => {
    it('returns nothing for an empty list', () => {
        expect(spreadServerCoords([]).size).toBe(0);
    });

    it('leaves a lone server at its exact coordinates', () => {
        const coords = spreadServerCoords([makeGeoServer('1.2.3.4', 27015)]);
        expect(coords.get('1.2.3.4:27015')).toEqual([CHICAGO.latitude, CHICAGO.longitude]);
    });

    it('skips servers without usable coordinates', () => {
        const coords = spreadServerCoords([
            makeGeoServer('1.1.1.1', 27015, null),
            makeGeoServer('2.2.2.2', 27015, { latitude: null, longitude: 5 }),
            makeGeoServer('3.3.3.3', 27015, { latitude: 5, longitude: null }),
            makeGeoServer('4.4.4.4', 27015),
        ]);
        expect([...coords.keys()]).toEqual(['4.4.4.4:27015']);
    });

    it('keeps servers at different locations where they are', () => {
        const coords = spreadServerCoords([makeGeoServer('1.2.3.4', 27015, CHICAGO), makeGeoServer('5.6.7.8', 27015, FRANKFURT)]);
        expect(coords.get('1.2.3.4:27015')).toEqual([CHICAGO.latitude, CHICAGO.longitude]);
        expect(coords.get('5.6.7.8:27015')).toEqual([FRANKFURT.latitude, FRANKFURT.longitude]);
    });

    it('gives every server sharing a location a distinct position', () => {
        const servers = manyServers();
        const coords = spreadServerCoords(servers);
        expect(coords.size).toBe(servers.length);
        const positions = new Set([...coords.values()].map(([lat, lng]) => `${lat},${lng}`));
        expect(positions.size).toBe(servers.length);
    });

    it('keeps spread servers close to their real location', () => {
        const coords = spreadServerCoords(manyServers());
        for (const [lat, lng] of coords.values()) {
            expect(Math.abs(lat - CHICAGO.latitude)).toBeLessThan(0.05);
            expect(Math.abs(lng - CHICAGO.longitude)).toBeLessThan(0.05);
        }
    });

    it('lays out ports of the same IP left to right on one row', () => {
        const coords = spreadServerCoords([
            makeGeoServer('1.2.3.4', 27017),
            makeGeoServer('1.2.3.4', 27015),
            makeGeoServer('1.2.3.4', 27016),
        ]);
        const [a, b, c] = [27015, 27016, 27017].map((port) => coords.get(`1.2.3.4:${port}`)!);
        expect(a[0]).toBe(b[0]);
        expect(b[0]).toBe(c[0]);
        expect(a[1]).toBeLessThan(b[1]);
        expect(b[1]).toBeLessThan(c[1]);
    });

    it('produces the same layout regardless of input order', () => {
        const servers = manyServers();
        const forward = spreadServerCoords(servers);
        const reversed = spreadServerCoords([...servers].reverse());
        for (const server of servers) {
            expect(reversed.get(keyOf(server))).toEqual(forward.get(keyOf(server)));
        }
    });

    it('produces the same layout on repeated calls', () => {
        const servers = manyServers();
        expect([...spreadServerCoords(servers)]).toEqual([...spreadServerCoords(servers)]);
    });

    it('spreads servers whose IP is not IPv4 without throwing', () => {
        const coords = spreadServerCoords([makeGeoServer('not-an-ip', 1), makeGeoServer('not-an-ip', 2), makeGeoServer('1.2.3.4', 3)]);
        expect(coords.size).toBe(3);
    });
});
// #endregion



// #region SERVER SORTING
const makeSortServer = (name: string, overrides: Record<string, any> = {}): any => ({
    name,
    players: 10,
    ping: 50,
    map: 'de_dust2',
    ...overrides,
});

const sortedNames = (servers: any[], key: any, descending: boolean): string[] =>
    [...servers].sort((a, b) => compareServers(a, b, key, descending)).map((s) => s.name);

describe('compareServers', () => {
    describe('by players', () => {
        const servers = [makeSortServer('low', { players: 2 }), makeSortServer('high', { players: 30 }), makeSortServer('mid', { players: 12 })];

        it('puts the fullest servers first when descending', () => {
            expect(sortedNames(servers, 'players', true)).toEqual(['high', 'mid', 'low']);
        });

        it('puts the emptiest servers first when ascending', () => {
            expect(sortedNames(servers, 'players', false)).toEqual(['low', 'mid', 'high']);
        });

        it('breaks ties with the lower ping first', () => {
            const tied = [makeSortServer('slow', { ping: 90 }), makeSortServer('fast', { ping: 20 })];
            expect(sortedNames(tied, 'players', true)).toEqual(['fast', 'slow']);
            expect(sortedNames(tied, 'players', false)).toEqual(['fast', 'slow']);
        });

        it('treats a missing player count as zero', () => {
            const withMissing = [makeSortServer('unknown', { players: undefined }), makeSortServer('one', { players: 1 })];
            expect(sortedNames(withMissing, 'players', true)).toEqual(['one', 'unknown']);
        });
    });

    describe('by ping', () => {
        const servers = [makeSortServer('slow', { ping: 120 }), makeSortServer('fast', { ping: 15 }), makeSortServer('mid', { ping: 60 })];

        it('puts the lowest ping first when ascending', () => {
            expect(sortedNames(servers, 'ping', false)).toEqual(['fast', 'mid', 'slow']);
        });

        it('puts the highest ping first when descending', () => {
            expect(sortedNames(servers, 'ping', true)).toEqual(['slow', 'mid', 'fast']);
        });

        it('sorts servers with a missing or zero ping after every real ping when ascending', () => {
            const withMissing = [makeSortServer('zero', { ping: 0 }), makeSortServer('missing', { ping: undefined }), makeSortServer('real', { ping: 300 })];
            expect(sortedNames(withMissing, 'ping', false)[0]).toBe('real');
        });

        it('breaks ties with the fuller server first', () => {
            const tied = [makeSortServer('empty', { players: 1 }), makeSortServer('full', { players: 20 })];
            expect(sortedNames(tied, 'ping', false)).toEqual(['full', 'empty']);
            expect(sortedNames(tied, 'ping', true)).toEqual(['full', 'empty']);
        });
    });

    describe('by map', () => {
        const servers = [makeSortServer('nuke', { map: 'de_nuke' }), makeSortServer('dust', { map: 'de_dust2' }), makeSortServer('inferno', { map: 'de_inferno' })];

        it('sorts map names alphabetically when ascending', () => {
            expect(sortedNames(servers, 'map', false)).toEqual(['dust', 'inferno', 'nuke']);
        });

        it('reverses the order when descending', () => {
            expect(sortedNames(servers, 'map', true)).toEqual(['nuke', 'inferno', 'dust']);
        });

        it('orders numbered maps numerically', () => {
            const numbered = [makeSortServer('ten', { map: 'surf_10' }), makeSortServer('two', { map: 'surf_2' }), makeSortServer('one', { map: 'surf_1' })];
            expect(sortedNames(numbered, 'map', false)).toEqual(['one', 'two', 'ten']);
        });

        it('breaks ties within a map with the fuller server first', () => {
            const tied = [makeSortServer('empty', { players: 0 }), makeSortServer('full', { players: 24 }), makeSortServer('half', { players: 12 })];
            expect(sortedNames(tied, 'map', false)).toEqual(['full', 'half', 'empty']);
        });

        it('sorts a missing map name before named maps', () => {
            const withMissing = [makeSortServer('named', { map: 'de_dust2' }), makeSortServer('missing', { map: undefined })];
            expect(sortedNames(withMissing, 'map', false)).toEqual(['missing', 'named']);
        });
    });

    it('returns zero for servers that are equal on every key', () => {
        expect(compareServers(makeSortServer('a'), makeSortServer('b'), 'players', true)).toBe(0);
    });
});
// #endregion

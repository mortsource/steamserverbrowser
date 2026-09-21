import React from 'react';
import { definePlugin, Millennium, IconsModule, GameServer } from '@steambrew/client';
import { logToConsole, initGeoDatabase, updatePluginData } from './shared';
import { processServer, requestCompleted, resetCounters } from './heuristics';

import { ServerPlayerCounter, VerifiedFilter, ViewMode } from './browser/elements'
import { SettingsModal } from './browser/settings';
import { EnhancedView } from './browser/view';
import { GameSelect } from './browser/gameselect';
import { browserState } from './browser/ui_shared';

// DOM RESOLUTION ————————————————————————————————————————————————————————————
const RESOLVE_DOC_POLL_MS = 500;
const RESOLVE_DOC_MAX_ATTEMPTS = 10;

// *TODO Does not handle the Steam in-game overlay server browser currently
function resolveDocument(ctx: any): Document | null {
    const candidates: any[] = [
        ctx,
        ctx?.m_element,
        ctx?.m_popup,
        ctx?.window,
        ctx?.m_element?.window,
        ctx?.m_popup?.window,
        ctx?.m_element?.contentWindow,
    ];
    for (const c of candidates) {
        if (c == null) continue;
        try {
            if (c.document && typeof c.document.createElement === 'function') return c.document;
            if (c.createElement && typeof c.createElement === 'function') return c as Document;
        } catch (_) { }
    }
    return null;
}

const INJECT_TITLE_POLL_MS = 500;
const INJECT_TITLE_MAX_ATTEMPTS = 10;

function tryInjectWhenReady(doc: Document): void {
    let attempts = 0;

    const attempt = () => {
        const title = doc.title ?? '';
        if (title.includes('Game Servers')) {
            logToConsole('Injecting into Game Servers window', 'Info');

            new ServerPlayerCounter().setup(doc);
            GameSelect(doc);
            ViewMode(doc);
            EnhancedView(doc);
            SettingsModal(doc);
            VerifiedFilter(doc);
            return;
        }

        attempts++;
        if (attempts >= INJECT_TITLE_MAX_ATTEMPTS) {
            logToConsole(`Game Servers window title never matched after ${attempts} attempts (last title: "${title}")`, 'Warn');
            return;
        }
        setTimeout(attempt, INJECT_TITLE_POLL_MS);
    };

    if (doc.readyState === 'complete' || doc.readyState === 'interactive') {
        attempt();
    } else {
        doc.addEventListener('DOMContentLoaded', attempt, { once: true });
    }
}

let pluginDataInitialized = false;

function windowCreated(context: any): void {
    const title: string = context?.m_strTitle ?? '';
    if (!title.includes('Game Servers')) return;

    logToConsole('Found Game Servers window', 'Info');

    if (!pluginDataInitialized) {
        pluginDataInitialized = true;
        updatePluginData();
    }

    const doc = resolveDocument(context);
    if (doc) {
        tryInjectWhenReady(doc);
        return;
    }

    let attempts = 0;
    const timer = setInterval(() => {
        attempts++;
        const d = resolveDocument(context);
        if (d) {
            clearInterval(timer);
            tryInjectWhenReady(d);
        } else if (attempts >= RESOLVE_DOC_MAX_ATTEMPTS) {
            clearInterval(timer);
            logToConsole(`Could not resolve document for Game Servers window after ${attempts} attempts`, 'Warn');
        }
    }, RESOLVE_DOC_POLL_MS);
}



// PLUGIN CORE ————————————————————————————————————————————————————————————
export type OnServerCb = (server: GameServer) => void;
export type OnCompleteCb = (response: number) => void;
declare global {
    interface Window {
        __BrowserHooked?: boolean;
    }
}

function installHook(): void {
    if (window.__BrowserHooked) return;

    const SB = window.SteamClient?.ServerBrowser;
    if (!SB) return;

    const origCreate = SB.CreateServerListRequest.bind(SB);

    SB.CreateServerListRequest = (appId, queryType, filters, serverCallback, requestCompletedCallback) => {
        browserState.currentAppId = appId;
        resetCounters();

        const onServer: OnServerCb = (srv) => processServer(queryType, srv, serverCallback);
        const onComplete: OnCompleteCb = (response) => requestCompleted(queryType, requestCompletedCallback, response);

        return origCreate(appId, queryType, filters, onServer, onComplete);
    };

    window.__BrowserHooked = true;
    logToConsole('Server Browser hooked', 'Info');
}

export default definePlugin(() => {
    initGeoDatabase();

    Millennium.AddWindowCreateHook?.((ctx: any) => {
        windowCreated(ctx);
        installHook();
    });

    return {
        title: 'ServerBrowserPlus',
        icon: <IconsModule.Settings />,
    };
});
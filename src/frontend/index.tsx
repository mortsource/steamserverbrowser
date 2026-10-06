import React from 'react';
import { definePlugin, Millennium, IconsModule, GameServer } from '@steambrew/client';
import { logToConsole, initGeoDatabase, updatePluginData } from './shared';
import { resetCounters, refreshCaches, processServer, requestCompleted } from './heuristics';
import { browserState, isServerBrowserDocument, isSteamOverlay } from './ui/ui_shared';
import { startAlertPoller, isAlertRequest, hookToastWindow } from './ui/alert';
import { setupCounter, VerifiedFilter, ViewModeToggle, NativeContextMenu } from './ui/elements'
import { SettingsModal } from './ui/settings';
import { GameSelect } from './ui/gameselect';
import { EnhancedView } from './ui/enhanced/core';

// #region DOM
const RESOLVE_DOC_POLL_MS = 500;
const RESOLVE_DOC_MAX_ATTEMPTS = 10;

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
            if (c.document && typeof c.document.createElement === 'function') return c.document; // Found a document object, return it immediately
            if (c.createElement && typeof c.createElement === 'function') return c as Document; // Found a document-like object, return it as a Document
        } catch (_) { }
    }
    return null;
}

function whenDocumentResolved(context: any, onDoc: (doc: Document) => void, onGiveUp?: (attempts: number) => void): void {
    const doc = resolveDocument(context);
    if (doc) {
        onDoc(doc);
        return;
    }

    let attempts = 0;
    const timer = setInterval(() => {
        attempts++;
        const d = resolveDocument(context);
        if (d) {
            clearInterval(timer);
            onDoc(d);
        } else if (attempts >= RESOLVE_DOC_MAX_ATTEMPTS) {
            clearInterval(timer);
            onGiveUp?.(attempts);
        }
    }, RESOLVE_DOC_POLL_MS);
}

function windowCreated(context: any): void {
    const title: string = context?.m_strTitle ?? '';
    if (title.startsWith('notificationtoasts_')) {
        whenDocumentResolved(context, hookToastWindow);
        return;
    }
    const titled = title.includes('Game Servers');
    if (!titled && title !== '') return;
    logToConsole('SYSTEM', titled ? 'Found Game Servers window' : 'Found untitled window, checking for overlay server browser');

    whenDocumentResolved(context, (doc) => tryInjectWhenReady(doc, titled), (attempts) => {
        if (titled) logToConsole('SYSTEM', `Could not resolve document for Game Servers window after ${attempts} attempts`, 'Warn');
    });
}

let pluginDataInitialized = false;

function tryInjectWhenReady(doc: Document, titled: boolean): void {
    let attempts = 0;

    const attempt = () => {
        if (isServerBrowserDocument(doc)) {
            if (!pluginDataInitialized) {
                pluginDataInitialized = true;
                updatePluginData();
            }

            setupCounter(doc);
            if (!isSteamOverlay(doc)) GameSelect(doc);
            ViewModeToggle(doc);
            EnhancedView(doc);
            SettingsModal(doc);
            VerifiedFilter(doc);
            NativeContextMenu(doc);
            logToConsole('SYSTEM', `Injected into ${titled ? 'Game Servers window' : 'overlay server browser'}`);
            return;
        }

        attempts++;
        if (attempts >= RESOLVE_DOC_MAX_ATTEMPTS) {
            if (titled) logToConsole('SYSTEM', `Game Servers window never rendered the server browser after ${attempts} attempts`, 'Warn');
            return;
        }
        setTimeout(attempt, RESOLVE_DOC_POLL_MS);
    };

    if (doc.readyState === 'complete' || doc.readyState === 'interactive') {
        attempt();
    } else {
        doc.addEventListener('DOMContentLoaded', attempt, { once: true });
    }
}
// #endregion



// #region PLUGIN
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
        if (isAlertRequest()) return origCreate(appId, queryType, filters, serverCallback, requestCompletedCallback);

        browserState.currentAppId = appId;
        resetCounters();
        refreshCaches();

        const onServer: OnServerCb = (srv) => processServer(queryType, srv, serverCallback);
        const onComplete: OnCompleteCb = (response) => requestCompleted(queryType, requestCompletedCallback, response);

        return origCreate(appId, queryType, filters, onServer, onComplete);
    };

    window.__BrowserHooked = true;
    logToConsole('SYSTEM', 'Server Browser hooked');
}

export default definePlugin(async () => {
    await initGeoDatabase();
    startAlertPoller();

    Millennium.AddWindowCreateHook?.((ctx: any) => {
        windowCreated(ctx);
        installHook();
    });

    return {
        title: 'ServerBrowserPlus',
        icon: <IconsModule.Settings />,
    };
});
// #endregion
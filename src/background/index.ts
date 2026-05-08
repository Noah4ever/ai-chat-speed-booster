import { loadConfig, saveConfig, loadRequestCount, incrementRequestCount, resetRequestCount } from "../shared/storage";
import { onMessage, api } from "../shared/browser-api";
import { MessageType } from "../shared/types";
import type { ExtensionConfig, ExtensionMessageUnion, ExtensionStatus } from "../shared/types";
import { logger } from "../shared/logger";
import { getAllUrlPatterns } from "../shared/sites";

const allUrlPatterns = getAllUrlPatterns();

api.runtime.onInstalled.addListener(async (details: chrome.runtime.InstalledDetails) => {
    if (details.reason === "install") {
        const config = await loadConfig();
        logger.info("extension installed, config initialised", config);
    }
    if (details.reason === "update") {
        await loadConfig();
        logger.info("extension updated");
    }
});

onMessage(async (message): Promise<unknown> => {
    const msg = message as ExtensionMessageUnion;

    switch (msg.type) {
        case MessageType.GET_CONFIG:
            return await loadConfig();

        case MessageType.SET_CONFIG: {
            const partial = msg.payload as Partial<ExtensionConfig>;
            const updated = await saveConfig(partial);
            await broadcastToContentScripts({ type: MessageType.CONFIG_UPDATED, payload: updated });
            return updated;
        }

        case MessageType.GET_STATUS:
            return await forwardToActiveTab(msg);

        case MessageType.TOGGLE_ENABLED: {
            const current = await loadConfig();
            const updated = await saveConfig({ enabled: !current.enabled });
            await broadcastToContentScripts({ type: MessageType.CONFIG_UPDATED, payload: updated });
            return updated;
        }

        //New message type for the status indicator
        case MessageType.TOGGLE_STATUS: {
            const current = await loadConfig();
            const updated = await saveConfig({ showStatus: !current.showStatus });
            await broadcastToContentScripts({ type: MessageType.CONFIG_UPDATED, payload: updated });
            return updated;
        }

        case MessageType.TOGGLE_FETCH_INTERCEPT: {
            const current = await loadConfig();
            const updated = await saveConfig({ fetchInterceptEnabled: !current.fetchInterceptEnabled });
            await broadcastToContentScripts({ type: MessageType.CONFIG_UPDATED, payload: updated });
            return updated;
        }

        case MessageType.TOGGLE_AUTO_LOAD: {
            const current = await loadConfig();
            const updated = await saveConfig({ autoLoad: !current.autoLoad });
            await broadcastToContentScripts({ type: MessageType.CONFIG_UPDATED, payload: updated });
            return updated;
        }

        case MessageType.GET_REQUEST_COUNT: {
            const siteId = (msg as { payload?: { siteId?: string } }).payload?.siteId ?? "";
            return await loadRequestCount(siteId);
        }

        case MessageType.INCREMENT_REQUEST_COUNT: {
            const incPayload = (msg as { payload?: { siteId?: string; count?: number } }).payload ?? {};
            return await incrementRequestCount(incPayload.siteId ?? "", incPayload.count ?? 1);
        }

        case MessageType.RESET_REQUEST_COUNT: {
            const siteId = (msg as { payload?: { siteId?: string } }).payload?.siteId ?? "";
            return await resetRequestCount(siteId);
        }

        default:
            return undefined;
    }
});

async function broadcastToContentScripts(message: ExtensionMessageUnion): Promise<void> {
    try {
        const tabs = await api.tabs.query({ url: allUrlPatterns as string[] });
        for (const tab of tabs) {
            if (tab.id == null) continue;
            try { await api.tabs.sendMessage(tab.id, message); } catch { /* not injected */ }
        }
    } catch (error) {
        logger.error("failed to broadcast to content scripts", error);
    }
}

async function forwardToActiveTab(message: ExtensionMessageUnion): Promise<ExtensionStatus | undefined> {
    try {
        const [tab] = await api.tabs.query({ active: true, currentWindow: true, url: allUrlPatterns as string[] });
        if (!tab?.id) return undefined;
        return (await api.tabs.sendMessage(tab.id, message)) as ExtensionStatus | undefined;
    } catch {
        return undefined;
    }
}

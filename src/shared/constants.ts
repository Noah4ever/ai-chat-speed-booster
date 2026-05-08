import type { ExtensionConfig } from "./types";

export const STORAGE_KEY = "ai_chat_speed_booster_config" as const;

export const DEFAULT_CONFIG: Readonly<ExtensionConfig> = Object.freeze({
    visibleMessageLimit: 3,
    loadMoreBatchSize: 3,
    enabled: true,
    showStatus: true,
    statusPosition: "top-right",
    fetchInterceptEnabled: true,
    theme: "dark",
    autoLoad: true,
    weeklyRequestLimit: 3000,
});

/** localStorage key used by settings bridge → MAIN-world fetch interceptor. */
export const LOCALSTORAGE_BRIDGE_KEY = "acsb_bridge_config" as const;

/** chrome.storage.local key for per-site weekly request counts. */
export const REQUEST_COUNTS_KEY = "acsb_request_counts" as const;

export const CONFIG_LIMITS = Object.freeze({
    visibleMessageLimit: { min: 1, max: 200 },
    loadMoreBatchSize: { min: 1, max: 50 },
    weeklyRequestLimit: { min: 0, max: 99999 },
});

export const EXTENSION_NAME = "AI Chat Speed Booster" as const;
export const CSS_PREFIX = "acsb" as const;
export const DATA_ATTR = "data-acsb-managed" as const;
export const MUTATION_DEBOUNCE_MS = 80 as const;

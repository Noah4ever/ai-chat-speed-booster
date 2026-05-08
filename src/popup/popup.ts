import { sendMessage } from "../shared/browser-api";
import { CONFIG_LIMITS, DEFAULT_CONFIG } from "../shared/constants";
import { MessageType, Theme, type ExtensionConfig, type ExtensionStatus, type StatusPosition, type WeeklyRequestCount } from "../shared/types";
import { SITES } from "../shared/sites";

const toggleEnabled = document.getElementById("toggle-enabled") as HTMLInputElement;
const toggleStatus = document.getElementById("toggle-status") as HTMLInputElement;
const toggleFetchIntercept = document.getElementById("toggle-fetch-intercept") as HTMLInputElement;
const toggleAutoLoad = document.getElementById("toggle-auto-load") as HTMLInputElement;
const visibleLimitInput = document.getElementById("visible-limit") as HTMLInputElement;
const batchSizeInput = document.getElementById("batch-size") as HTMLInputElement;
const statusText = document.getElementById("status-text") as HTMLElement;
const settingsSection = document.querySelector(".popup-settings") as HTMLElement;
const positionPicker = document.getElementById("position-picker") as HTMLElement;
const positionButtons = positionPicker.querySelectorAll<HTMLButtonElement>(".position-picker__btn");
const lightIcon = document.querySelector(".theme-toggle__icon.lucide-sun") as HTMLElement;
const darkIcon = document.querySelector(".theme-toggle__icon.lucide-moon") as HTMLElement;
const themeToggle = document.getElementById("theme-toggle") as HTMLButtonElement;
const requestCounter = document.getElementById("request-counter") as HTMLElement;
const requestCountValue = document.getElementById("request-count-value") as HTMLElement;
const requestLimitSep = document.getElementById("request-limit-sep") as HTMLElement;
const requestLimitInput = document.getElementById("request-limit-input") as HTMLInputElement;
const requestCountHint = document.getElementById("request-counter-hint") as HTMLElement;
const requestCountReset = document.getElementById("request-count-reset") as HTMLButtonElement;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let limitSaveTimer: ReturnType<typeof setTimeout> | null = null;
let currentSiteId: string | undefined;
let lastCount = 0;
let lastWeekStart = 0;

function applyTheme(theme: Theme): void {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggle.setAttribute("aria-pressed", String(theme === "light"));
    if (theme === "light") {
        lightIcon.classList.add("hidden");
        darkIcon.classList.remove("hidden");
    } else {
        lightIcon.classList.remove("hidden");
        darkIcon.classList.add("hidden");
    }
}

async function safeSendMessage<T>(message: unknown): Promise<T | null> {
    try {
        return (await sendMessage<T>(message)) ?? null;
    } catch {
        return null;
    }
}

async function init(): Promise<void> {
    const config = await safeSendMessage<ExtensionConfig>({ type: MessageType.GET_CONFIG });
    const finalConfig = config ?? DEFAULT_CONFIG;
    applyTheme(finalConfig.theme);
    renderConfig(finalConfig);
    await refreshStatus();
}

function renderConfig(config: ExtensionConfig): void {
    toggleEnabled.checked = config.enabled;
    toggleStatus.checked = config.showStatus;
    toggleAutoLoad.checked = config.autoLoad;
    toggleFetchIntercept.checked = config.fetchInterceptEnabled;
    visibleLimitInput.value = String(config.visibleMessageLimit);
    batchSizeInput.value = String(config.loadMoreBatchSize);
    requestLimitInput.value = String(config.weeklyRequestLimit);
    settingsSection.setAttribute("aria-disabled", String(!config.enabled));

    positionButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.pos === config.statusPosition);
    });
}

async function refreshStatus(): Promise<void> {
    try {
        const status = await safeSendMessage<ExtensionStatus | undefined>({ type: MessageType.GET_STATUS });
        if (status && typeof status.totalMessages === "number") {
            statusText.textContent =
                `${Math.floor(status.visibleMessages / 2)}/${Math.floor(status.totalMessages / 2)} messages visible` +
                (status.hiddenMessages > 0 ? ` · ${Math.floor(status.hiddenMessages / 2)} hidden` : "");
            settingsSection.style.display = "";
            currentSiteId = status.siteId;
            await refreshRequestCounter();
        } else {
            settingsSection.style.display = "none";
            statusText.textContent = "Open a supported AI chat to see status";
            currentSiteId = undefined;
            requestCounter.hidden = true;
        }
    } catch {
        statusText.textContent = "Unable to fetch status";
    }
}

async function refreshRequestCounter(): Promise<void> {
    if (!currentSiteId) { requestCounter.hidden = true; return; }
    const site = SITES.find((s) => s.id === currentSiteId);
    if (!site?.selectors.userMessageSelector) { requestCounter.hidden = true; return; }

    const data = await safeSendMessage<WeeklyRequestCount>({
        type: MessageType.GET_REQUEST_COUNT,
        payload: { siteId: currentSiteId },
    });
    if (!data) { requestCounter.hidden = true; return; }

    lastCount = data.count;
    lastWeekStart = data.weekStart;
    renderRequestCount(data.count, data.weekStart);
    requestCounter.hidden = false;
}

function renderRequestCount(count: number, weekStart: number): void {
    const limit = parseInt(requestLimitInput.value, 10);
    const hasLimit = !isNaN(limit) && limit > 0;

    requestCountValue.textContent = count.toLocaleString();
    requestLimitSep.hidden = !hasLimit;
    requestCountValue.classList.toggle("request-count-value--warn", hasLimit && count / limit >= 0.8);

    const resetDate = new Date(weekStart + 7 * 24 * 60 * 60 * 1000);
    const formatted = resetDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    requestCountHint.textContent = `Resets ${formatted}`;
}

function clampInput(input: HTMLInputElement, min: number, max: number): number {
    let value = parseInt(input.value, 10);
    if (isNaN(value)) value = min;
    value = Math.max(min, Math.min(max, value));
    input.value = String(value);
    return value;
}

function scheduleAutoSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        saveTimer = null;
        const visibleLimit = clampInput(visibleLimitInput, CONFIG_LIMITS.visibleMessageLimit.min, CONFIG_LIMITS.visibleMessageLimit.max);
        const batchSize = clampInput(batchSizeInput, CONFIG_LIMITS.loadMoreBatchSize.min, CONFIG_LIMITS.loadMoreBatchSize.max);
        const config = await safeSendMessage<ExtensionConfig>({
            type: MessageType.SET_CONFIG,
            payload: { visibleMessageLimit: visibleLimit, loadMoreBatchSize: batchSize },
        });
        if (config) renderConfig(config);
        await refreshStatus();
    }, 600);
}

function scheduleLimitSave(): void {
    if (limitSaveTimer) clearTimeout(limitSaveTimer);
    limitSaveTimer = setTimeout(async () => {
        limitSaveTimer = null;
        const limit = clampInput(requestLimitInput, CONFIG_LIMITS.weeklyRequestLimit.min, CONFIG_LIMITS.weeklyRequestLimit.max);
        const config = await safeSendMessage<ExtensionConfig>({
            type: MessageType.SET_CONFIG,
            payload: { weeklyRequestLimit: limit },
        });
        if (config) renderConfig(config);
        renderRequestCount(lastCount, lastWeekStart);
    }, 600);
}

toggleEnabled.addEventListener("change", async () => {
    const config = await safeSendMessage<ExtensionConfig>({ type: MessageType.TOGGLE_ENABLED });
    if (config) renderConfig(config);
    await refreshStatus();
});

toggleStatus.addEventListener("change", async () => {
    const config = await safeSendMessage<ExtensionConfig>({ type: MessageType.TOGGLE_STATUS });
    if (config) renderConfig(config);
    await refreshStatus();
});

toggleAutoLoad.addEventListener("change", async () => {
    const config = await safeSendMessage<ExtensionConfig>({ type: MessageType.TOGGLE_AUTO_LOAD });
    if (config) renderConfig(config);
    await refreshStatus();
});

toggleFetchIntercept.addEventListener("change", async () => {
    const config = await safeSendMessage<ExtensionConfig>({ type: MessageType.TOGGLE_FETCH_INTERCEPT });
    if (config) renderConfig(config);
    await refreshStatus();
});

visibleLimitInput.addEventListener("input", scheduleAutoSave);
batchSizeInput.addEventListener("input", scheduleAutoSave);
requestLimitInput.addEventListener("input", scheduleLimitSave);

positionPicker.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".position-picker__btn");
    if (!btn || !btn.dataset.pos) return;
    const config = await safeSendMessage<ExtensionConfig>({
        type: MessageType.SET_CONFIG,
        payload: { statusPosition: btn.dataset.pos as StatusPosition },
    });
    if (config) renderConfig(config);
    await refreshStatus();
});

themeToggle.addEventListener("click", async () => {
    const currentTheme = document.documentElement.getAttribute("data-theme") as "light" | "dark" || "dark";
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    const config = await safeSendMessage<ExtensionConfig>({
        type: MessageType.SET_CONFIG,
        payload: { theme: newTheme },
    });
    if (config) {
        applyTheme(config.theme);
        renderConfig(config);
    }
});

// Tooltip: fixed-position bubble that can't be clipped by popup overflow
const tooltip = document.getElementById("tooltip") as HTMLElement;
const TOOLTIP_W = 220; // must match CSS width
const POPUP_W = 300;   // body width

document.querySelectorAll<HTMLElement>("[data-tooltip]").forEach((el) => {
    el.addEventListener("mouseenter", () => {
        const text = el.dataset.tooltip;
        if (!text) return;
        tooltip.textContent = text;
        tooltip.classList.add("visible");

        // Measure after showing so offsetHeight is accurate
        const rect = el.getBoundingClientRect();
        const h = tooltip.offsetHeight;
        const gap = 6;
        const top = rect.top - h - gap >= 0
            ? rect.top - h - gap          // above
            : rect.bottom + gap;           // below (near top of popup)

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${(POPUP_W - TOOLTIP_W) / 2}px`; // always centered
    });
    el.addEventListener("mouseleave", () => tooltip.classList.remove("visible"));
});

requestCountReset.addEventListener("click", async () => {
    if (!currentSiteId) return;
    const data = await safeSendMessage<WeeklyRequestCount>({
        type: MessageType.RESET_REQUEST_COUNT,
        payload: { siteId: currentSiteId },
    });
    if (data) {
        lastCount = data.count;
        lastWeekStart = data.weekStart;
        renderRequestCount(data.count, data.weekStart);
    }
});

init();

import { SiteConfig, type SiteSelectors } from "../shared/sites";
import { MUTATION_DEBOUNCE_MS } from "../shared/constants";
import { logger } from "../shared/logger";

export interface DOMObserverCallbacks {
    onMessagesAdded(elements: HTMLElement[]): void;
    onMessagesRemoved(elements: HTMLElement[]): void;
    onConversationChanged(): void;
    onMessagesReset(): void;
    getLastTrackedMessageId(): string | null;
    hasTrackedMessageId(id: string): boolean;
    onScrollToTop(): void;
}

export class DOMObserver {
    private observer: MutationObserver | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingMutations: MutationRecord[] = [];
    private readonly currentSite: SiteConfig;
    private readonly selectors: SiteSelectors;
    private readonly callbacks: DOMObserverCallbacks;
    private lastUrl = "";
    private urlPollTimer: ReturnType<typeof setInterval> | null = null;
    private totalMessages = 0;
    private visibleMessages = 0;
    private scrollEl: HTMLElement | null = null;
    private scrollRaf: number | null = null;
    private autoLoadEnabled = false;
    private scrollRetryTimer: ReturnType<typeof setInterval> | null = null;
    private lastAutoLoadAt = 0;

    constructor(currentSite: SiteConfig, callbacks: DOMObserverCallbacks) {
        this.currentSite = currentSite;
        this.selectors = currentSite.selectors;
        this.callbacks = callbacks;
        this.scrollEl = this.findScrollContainer();    }

    start(): void {
        if (this.observer) {
            logger.warn("DOMObserver already running");
            return;
        }
        this.lastUrl = location.href;
        this.observer = new MutationObserver(this.handleMutations);
        this.observer.observe(document.body, { childList: true, subtree: true });

        // Detect SPA navigations (pushState / replaceState / popstate)
        window.addEventListener("popstate", this.handleNavigation);
        this.patchHistoryMethod("pushState");
        this.patchHistoryMethod("replaceState");

        // Fallback: poll for URL changes every 500ms in case patches miss something
        this.urlPollTimer = setInterval(() => this.checkUrlChange(), 500);

        logger.debug("DOMObserver started");
    }

    stop(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.pendingMutations = [];
        if (this.urlPollTimer) {
            clearInterval(this.urlPollTimer);
            this.urlPollTimer = null;
        }
        window.removeEventListener("popstate", this.handleNavigation);
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        logger.debug("DOMObserver stopped");
    }

    queryAllMessages(): HTMLElement[] {
        return Array.from(document.querySelectorAll<HTMLElement>(this.selectors.messageTurn));
    }

    // Updates internal message counts based on the provided numbers.
    // Required for gating the scroll listener callback.
    updateMessageStats(total: number, visible: number): void {
        this.totalMessages = total;
        this.visibleMessages = visible;
    }

    SetAutoLoad(enable: boolean): void {
        if (this.autoLoadEnabled === enable) return;
        this.autoLoadEnabled = enable;

        if (this.autoLoadEnabled) {
            logger.debug("Auto-load enabled: will load one more message when user scrolls to top");
            this.attachScrollListener();
        } else {
            logger.debug("Auto-load disabled: will not load more messages on scroll");
            if (this.scrollRetryTimer) {
                clearInterval(this.scrollRetryTimer);
                this.scrollRetryTimer = null;
            }
            if (this.scrollEl) this.scrollEl.removeEventListener("scroll", this.handleScroll);
            if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
            this.scrollRaf = null;
        }
    }

    private attachScrollListener(): void {
        if (!this.scrollEl) this.scrollEl = this.findScrollContainer();
        if (this.scrollEl) {
            this.handleScroll();
            this.scrollEl.addEventListener("scroll", this.handleScroll, { passive: true });
            return;
        }
        // Scroll container not yet in the DOM (some sites load it asynchronously) — poll until found
        this.scrollRetryTimer = setInterval(() => {
            this.scrollEl = this.findScrollContainer();
            if (this.scrollEl) {
                clearInterval(this.scrollRetryTimer!);
                this.scrollRetryTimer = null;
                if (this.autoLoadEnabled) {
                    this.handleScroll();
                    this.scrollEl.addEventListener("scroll", this.handleScroll, { passive: true });
                }
            }
        }, 500);
    }

    resetAutoLoad(): void {
        if(this.autoLoadEnabled){
            logger.debug("Resetting auto-load state: temporarily disabling and re-enabling to reset internal state");
            this.SetAutoLoad(false);
            this.SetAutoLoad(true);
        }
    }

    findScrollContainer(): HTMLElement | null {
        const primary = document.querySelector<HTMLElement>(this.selectors.scrollContainer);
        if (primary) return primary;
        if (this.selectors.scrollContainerAlt) {
            return document.querySelector<HTMLElement>(this.selectors.scrollContainerAlt);
        }
        return null;
    }

    private patchHistoryMethod(method: "pushState" | "replaceState"): void {
        const original = history[method].bind(history);
        history[method] = (...args: Parameters<typeof history.pushState>) => {
            original(...args);
            this.checkUrlChange();
        };
    }

    private checkUrlChange(): void {
        const current = location.href;
        if (current !== this.lastUrl) {
            logger.debug(`URL changed: ${this.lastUrl} -> ${current}`);
            this.lastUrl = current;
            this.callbacks.onConversationChanged();
        }
    }

    private readonly handleNavigation = (): void => {
        this.checkUrlChange();
    };

    private readonly handleMutations = (mutations: MutationRecord[]): void => {
        this.pendingMutations.push(...mutations);
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            const batch = this.pendingMutations;
            this.pendingMutations = [];
            this.processMutations(batch);
        }, MUTATION_DEBOUNCE_MS);
    };

    private processMutations(mutations: MutationRecord[]): void {
        const addedMessages: HTMLElement[] = [];
        const removedMessages: HTMLElement[] = [];

        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof HTMLElement)) continue;
                if (this.isMessageTurn(node)) {
                    addedMessages.push(node);
                } else {
                    const nested = node.querySelectorAll<HTMLElement>(this.selectors.messageTurn);
                    addedMessages.push(...nested);
                }
            }

            for (const node of mutation.removedNodes) {
                if (!(node instanceof HTMLElement)) continue;
                if (this.isMessageTurn(node)) {
                    removedMessages.push(node);
                } else {
                    const nested = node.querySelectorAll<HTMLElement>(this.selectors.messageTurn);
                    removedMessages.push(...nested);
                }
            }
        }

        // Conversation changes are detected via URL monitoring (pushState,
        // replaceState, popstate, polling).  The previous DOM-based
        // "isConversationContainer" heuristic (checking if any added/removed
        // node contained 2+ message turns) caused duplicate change events
        // and race conditions during SPA navigations.

        if (addedMessages.length > 2 && this.currentSite.isDynamic) { 
        // If a large batch of messages is added at once, it's likely a dynamic
        // loading scenario (e.g. Gemini) where the existing message tracking can get out of sync, so we trigger a full reset to be safe

        // Only apply this heuristic for sites known to have dynamic loading (e.g. Gemini),
        // to avoid unnecessary resets on more static sites where the existing mutation handling is sufficient
            logger.debug(`Detected ${addedMessages.length} new messages, triggering full reset`);
            this.callbacks.onMessagesReset();
        } else if (addedMessages.length > 0) {
            logger.debug(`${addedMessages.length} message turn(s) added`);
            this.callbacks.onMessagesAdded(addedMessages);
        }

        if (removedMessages.length > 0) {
            logger.debug(`${removedMessages.length} message turn(s) removed out of ${this.totalMessages} total tracked messages`);
            this.callbacks.onMessagesRemoved(removedMessages);
            // If essentially every tracked turn is removed in one batch it's a
            // re-render of the whole thread (e.g. the ChatGPT + Excel-table
            // collapse bug), so trigger a full reset to keep tracking aligned.
            // Guard on totalMessages > 0 so this never fires before the first
            // refreshUI has populated the count (totalMessages starts at 0,
            // which would otherwise make ANY removal look like a full wipe).
            if (this.totalMessages > 0 && removedMessages.length >= this.totalMessages) {
                logger.debug(`Detected ${removedMessages.length} removed messages, triggering full reset`);
                this.callbacks.onMessagesReset();
            }
        }
    }

    private isMessageTurn(el: HTMLElement): boolean {
        return el.matches?.(this.selectors.messageTurn) ?? false;
    }

    private static readonly AUTO_LOAD_COOLDOWN_MS = 800;
/*
    private readonly handleScroll = (): void => {
        if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
        if (this.visibleMessages >= this.totalMessages) return; // nothing hidden left to reveal
        this.scrollRaf = requestAnimationFrame(() => {
            const el = this.scrollEl ?? this.findScrollContainer();
            if (!el) return;
            const max = el.scrollHeight - el.clientHeight;
            const percentFromTop = max > 0 ? (el.scrollTop / max) * 100 : 100;
            if (percentFromTop > 10) return;
            // Throttle so parking at the top reveals turns gradually instead of
            // dumping them all at once. We intentionally do NOT force-scroll the
            // user — browser scroll anchoring keeps their view stable when the
            // newly revealed turn is prepended above the viewport.
            const now = Date.now();
            if (now - this.lastAutoLoadAt < DOMObserver.AUTO_LOAD_COOLDOWN_MS) return;
            this.lastAutoLoadAt = now;
            this.callbacks.onScrollToTop();
        });
    };
*/

	private readonly handleScroll = (): void => {
		if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
		if (this.visibleMessages >= this.totalMessages) return; // nothing hidden left to reveal

		this.scrollRaf = requestAnimationFrame(() => {
			const el = this.scrollEl ?? this.findScrollContainer();
			if (!el) return;

			const max = el.scrollHeight - el.clientHeight;
			const percentFromTop = max > 0 ? (el.scrollTop / max) * 100 : 100;

			if (percentFromTop > 10) return;

			// I still prefer this approach over the previous cooldown/debounce logic,
			// since that depended on the previous scroll tick timing and could become
			// unreliable while the user was actively scrolling near the top.
			//
			// In practice, users could end up needing to scroll down and back up again
			// before auto-load would trigger, because all scroll events inside the
			// cooldown window were ignored.
			//
			// This approach triggers auto-load immediately, then slightly scrolls down
			// afterward only if the UI itself did not already shift the scroll position,
			// as in Gemini, preventing repeated auto-load triggers while keeping
			// scrolling responsive.
			//
			// Keeping the old implementation commented for now since it can easily be
			// restored if needed.

			this.callbacks.onScrollToTop();

			requestAnimationFrame(() => {
				const updatedMax = el.scrollHeight - el.clientHeight;
				const updatedPercent =
					updatedMax > 0 ? (el.scrollTop / updatedMax) * 100 : 100;

				if (updatedPercent <= 10) {
					el.scrollTo({
						top: 0.12 * el.scrollHeight,
						behavior: "smooth"
					});

					logger.debug("Auto scrolled down slightly to prevent multiple auto-load triggers");
				}
			});
		});
	};
}

import sitesConfig from "../../sites.config.json";

export interface SiteSelectors {
    readonly messageTurn: string;
    readonly scrollContainer: string;
    readonly scrollContainerAlt?: string;
    readonly userMessageSelector?: string;
}

export interface StatusAnchors {
    readonly name?: string;
    readonly controls?: string;
    readonly bottom?: string;
}

export interface SiteUI {
    readonly loadMoreMargin?: string;
}

export interface FetchInterceptTreeWalkConfig {
    readonly nodesKey: string;
    readonly currentNodeKey: string;
    readonly rootKey: string;
    readonly parentPointer: string;
    readonly childrenKey: string;
    readonly messageKey: string;
    readonly roleAccessor: string;
    readonly visibleRoles: readonly string[];
}

export interface FetchInterceptArraySliceConfig {
    readonly messagesKey: string;
    readonly roleKey: string;
    readonly visibleRoles: readonly string[];
    /** Number of initial messages to always keep (system prompts, etc.). */
    readonly keepInitial?: number;
}

export interface FetchInterceptConfig {
    /** Substring that must appear in the URL to match. */
    readonly urlMatch: string;
    /** URL substrings that exclude a request from interception. */
    readonly urlExclude: readonly string[];
    /** HTTP method to match (e.g. "GET"). */
    readonly method: string;
    /** Trimming strategy to apply. */
    readonly strategy: "tree-walk" | "array-slice";
    readonly treeWalk?: FetchInterceptTreeWalkConfig;
    readonly arraySlice?: FetchInterceptArraySliceConfig;
}

export interface SiteConfig {
    readonly id: string;
    readonly name: string;
    readonly hostnames: readonly string[];
    readonly isDynamic?: boolean; // Indicates if the site has dynamic content loading that may require special handling (e.g. Gemini)
    readonly urlPatterns: readonly string[];
    readonly selectors: SiteSelectors;
    readonly messageIdAttribute?: string;
    readonly statusAnchors?: StatusAnchors;
    readonly ui?: SiteUI;
    readonly fetchIntercept?: FetchInterceptConfig;
}

export const SITES: readonly SiteConfig[] = sitesConfig as SiteConfig[];

/**
 * Detect which supported AI chat site the content script is running on.
 * Returns null if the current page is not a supported site.
 */
export function detectCurrentSite(): SiteConfig | null {
    const hostname = window.location.hostname;
    return (
        SITES.find((site) =>
            site.hostnames.some((h) => hostname === h || hostname.endsWith(`.${h}`)),
        ) ?? null
    );
}

/** Collect every URL pattern across all configured sites. */
export function getAllUrlPatterns(): string[] {
    return SITES.flatMap((site) => [...site.urlPatterns]);
}

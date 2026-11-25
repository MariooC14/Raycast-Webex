import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, Page } from "./webex";

const noItems: never[] = [];

type LoadPage<T> = (next: string | undefined, signal: AbortSignal, refresh: boolean) => Promise<Page<T>>;
type State<T> = Page<T> & {
  loadPage: LoadPage<T>;
  isLoading: boolean;
  hasLoaded: boolean;
  error?: string;
};

export function usePages<T extends { id: string }>(loadPage: LoadPage<T>, { enabled = true, delay = 0 } = {}) {
  const [state, setState] = useState<State<T>>();
  const pending = useRef<AbortController>(null);
  const scheduled = useRef<ReturnType<typeof setTimeout>>(undefined);
  const loadedPages = useRef(new Set<string>());
  const load = useCallback(
    async (next?: string, refresh = false) => {
      if (!enabled || pending.current) return;
      const controller = new AbortController();
      pending.current = controller;
      setState((previous) => ({
        ...(previous?.loadPage === loadPage ? previous : { items: [], loadPage, hasLoaded: false }),
        isLoading: true,
        error: undefined,
      }));

      try {
        const page = await loadPage(next, controller.signal, refresh);
        if (controller.signal.aborted) return;
        if (next) loadedPages.current.add(next);
        else loadedPages.current.clear();
        const nextPage = page.next && !loadedPages.current.has(page.next) ? page.next : undefined;
        setState((previous) => {
          if (previous?.loadPage !== loadPage) return previous;
          const combined = next ? [...previous.items, ...page.items] : page.items;
          const items = [...new Map(combined.map((item) => [item.id, item])).values()];
          return {
            items,
            next: nextPage,
            isLoading: false,
            hasLoaded: true,
            loadPage,
          };
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          setState((previous) =>
            previous?.loadPage === loadPage ? { ...previous, isLoading: false, error: errorMessage(error) } : previous,
          );
        }
      } finally {
        if (pending.current === controller) pending.current = null;
      }
    },
    [enabled, loadPage],
  );

  useEffect(() => {
    if (!enabled) return;
    scheduled.current = setTimeout(() => {
      scheduled.current = undefined;
      void load();
    }, delay);
    return () => {
      clearTimeout(scheduled.current);
      scheduled.current = undefined;
      pending.current?.abort();
      pending.current = null;
    };
  }, [delay, enabled, load]);

  const page = state?.loadPage === loadPage && enabled ? state : undefined;
  return {
    items: page?.items ?? noItems,
    hasLoaded: page?.hasLoaded ?? false,
    error: page?.error,
    isLoading: enabled && (page?.isLoading ?? true),
    reload: () => {
      clearTimeout(scheduled.current);
      scheduled.current = undefined;
      pending.current?.abort();
      pending.current = null;
      return load(undefined, true);
    },
    loadMore: page?.next ? () => load(page.next) : undefined,
  };
}

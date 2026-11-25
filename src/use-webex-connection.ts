import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionPreview, Session } from "./auth";
import { errorMessage, SignInRequired } from "./webex";

type Auth = typeof import("./auth");
type PreviewView = "spaces" | "people";
type Connect = (auth: Auth, signal: AbortSignal) => Promise<Session | undefined>;

export function useWebexConnection(previewView?: PreviewView) {
  const [session, setSession] = useState<Session>();
  const [preview, setPreview] = useState<ConnectionPreview>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const pending = useRef<AbortController>(null);

  const connect = useCallback(async (operation: Connect) => {
    if (pending.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    pending.current = controller;
    setIsLoading(true);
    setError(undefined);
    setPreview(undefined);
    try {
      const auth = await import("./auth");
      signal.throwIfAborted();
      const next = await operation(auth, signal);
      if (!signal.aborted) setSession(next);
    } catch (error) {
      if (!signal.aborted) setError(errorMessage(error));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setIsLoading(false);
      }
    }
  }, []);

  const reload = useCallback(
    (view?: PreviewView) =>
      connect(async (auth, signal) => {
        try {
          return await auth.restoreSession(view, setPreview, signal);
        } catch (error) {
          if (error instanceof SignInRequired && !signal.aborted) setSession(undefined);
          throw error;
        }
      }),
    [connect],
  );

  useEffect(() => {
    void reload(previewView);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [previewView, reload]);

  return {
    session,
    preview,
    error,
    isLoading,
    reload: () => reload(),
    signIn: () => connect((auth) => auth.signInWithWebex()),
    signOut: () =>
      connect(async (auth) => {
        await auth.signOutOfWebex();
        return undefined;
      }),
    removeToken: () =>
      connect(async (auth, signal) => {
        await auth.removeDeveloperToken();
        if (!signal.aborted) setSession(undefined);
        return auth.restoreSession(undefined, undefined, signal);
      }),
    applySession: (next: Session) => {
      setPreview(undefined);
      setSession(next);
      setError(undefined);
    },
  };
}

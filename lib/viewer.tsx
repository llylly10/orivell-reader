"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type ViewerState = { id: string | null; name: string | null; email: string; avatar: string | null };

const ViewerContext = createContext<ViewerState & { setViewer: (patch: Partial<ViewerState>) => void }>({
  id: null,
  name: null,
  email: "",
  avatar: null,
  setViewer: () => {},
});

/**
 * Who is reading, seeded by the server on every page load (layout passes the
 * session's reader in), so the top bar never flickers while a fetch resolves.
 * The only ways the answer changes — signing in, out, or a new avatar — go
 * through a full navigation or setViewer below.
 */
export function ViewerProvider({ initial, children }: { initial: ViewerState; children: ReactNode }) {
  const [viewer, setViewer] = useState(initial);
  return (
    <ViewerContext.Provider
      value={{ ...viewer, setViewer: (patch) => setViewer((v) => ({ ...v, ...patch })) }}
    >
      {children}
    </ViewerContext.Provider>
  );
}

export function useViewer() {
  const v = useContext(ViewerContext);
  return { ...v, loaded: true as const };
}

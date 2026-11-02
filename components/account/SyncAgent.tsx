"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { useViewer } from "@/lib/viewer";
import { startSync } from "@/lib/sync";

/** Runs account sync while someone is signed in. Renders nothing. */
export function SyncAgent() {
  const { loaded, id } = useViewer();
  useEffect(() => {
    if (!loaded || !id) return;
    useStore.getState().hydrate();
    const s = startSync(id);
    return () => s.stop();
  }, [loaded, id]);
  return null;
}

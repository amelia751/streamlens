"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { TitleDialog } from "./title-dialog";

type Ctx = { open: (title: string) => void; close: () => void };

const TitleCtx = createContext<Ctx>({ open: () => {}, close: () => {} });

export function useTitleDialog() {
  return useContext(TitleCtx);
}

export function TitleLink({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  const { open } = useTitleDialog();
  return (
    <button type="button" className="title-link" onClick={() => open(title)}>
      {children ?? title}
    </button>
  );
}

export function TitleDialogProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const open = useCallback((t: string) => setTitle(t), []);
  const close = useCallback(() => setTitle(null), []);

  return (
    <TitleCtx.Provider value={{ open, close }}>
      {children}
      {title && <TitleDialog title={title} onClose={close} />}
    </TitleCtx.Provider>
  );
}

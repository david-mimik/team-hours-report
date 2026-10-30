import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { BlockData, ReportBlock } from './types';

type ReportApi = {
  blocks: ReportBlock[];
  add: (block: BlockData) => void;
  clear: () => void;
};

const ReportContext = createContext<ReportApi | null>(null);

export function ReportProvider({ children }: { children: ReactNode }) {
  const [blocks, setBlocks] = useState<ReportBlock[]>([]);
  const api = useMemo<ReportApi>(() => ({
    blocks,
    add: (block) => setBlocks((prev) => [...prev, { ...block, id: crypto.randomUUID() }]),
    clear: () => setBlocks([]),
  }), [blocks]);
  return <ReportContext.Provider value={api}>{children}</ReportContext.Provider>;
}

export function useReport() {
  const api = useContext(ReportContext);
  if (!api) throw new Error('useReport must be used inside <ReportProvider>');
  return api;
}

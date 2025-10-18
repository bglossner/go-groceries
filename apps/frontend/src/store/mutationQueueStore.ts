import { create } from 'zustand';
import type { OnMutationArgs } from '../db/db';

export type DbMutationHook = (mutation: OnMutationArgs) => void;

export interface MutationQueueState {
  mutationQueue: OnMutationArgs[];
  addMutation: (mutation: OnMutationArgs) => void;
  clearQueue: () => void;
  mutationHooks: DbMutationHook[];
  addDbMutationHook: (f: DbMutationHook) => void;
}

export const useMutationQueueStore = create<MutationQueueState>((set) => ({
  mutationQueue: [],
  addMutation: (mutation) =>
    set((state) => ({
      mutationQueue: [...state.mutationQueue, mutation],
    })),
  clearQueue: () => set(() => ({ mutationQueue: [] })),
  mutationHooks: [],
  addDbMutationHook: (hook) =>
    set((state) => ({
      mutationHooks: [...state.mutationHooks, hook],
    })),
}));

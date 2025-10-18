import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import './App.css';

// Import the generated route tree
import { routeTree } from './routeTree.gen';
import { DebugConsole } from './pages/DebugConsole';
import InstallPWAButton from './components/InstallPWAButton';
import { checkAndTriggerAutoSync, saveSuccessfulSync } from './util/sync-from';
import { DiffsModalProvider } from './contexts/DiffsModalProvider';
import { useDiffsModal } from './hooks/useDiffsModal';
import { checkAndTriggerAutoSyncTo } from './util/sync-to';
import { useDebouncedSync } from './hooks/useDebouncedSync';

// Create a new router instance
const router = createRouter({ routeTree });

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();
const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const isInstalled = window.matchMedia('(display-mode: standalone)').matches;

const AppWrapper = () => {
  useDebouncedSync(); // Call the debounced sync hook
  const { openDiffsModal, showSuccessToast, showErrorToast } = useDiffsModal();

  const { data, isLoading } = useQuery({
    queryKey: ['checkSyncFromData'],
    queryFn: async () => {
      try {
        return await checkAndTriggerAutoSync();
      } catch (error: unknown) {
        showErrorToast(`Automatic sync [from] failed: ${(error as Error).message}`);
        return null;
      }
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data: syncToData, isLoading: isSyncingTo } = useQuery({
    queryKey: ['checkSyncToData'],
    queryFn: async () => {
      try {
        return await checkAndTriggerAutoSyncTo();
      } catch (error: unknown) {
        showErrorToast(`Automatic sync [to] failed: ${(error as Error).message}`);
        return null;
      }
    },
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (isSyncingTo) {
      return;
    }

    if (syncToData && syncToData.type !== 'ERROR') {
      if (syncToData.type === 'SUCCESS') {
        showSuccessToast('Automatic sync [to] successful!');
      } else {
        showSuccessToast('Automatic sync [to] successful! Nothing done.');
      }
    }
  }, [syncToData, isSyncingTo, showSuccessToast]);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    const triggerSync = async () => {
      const result = data;
      if (result) {
        const { outcome } = result;
        if (outcome === 'SUCCESS' && (result.diffsResult.mealDiffs.toAdd.length > 0 || result.diffsResult.mealDiffs.toRemove.length > 0)) {
          openDiffsModal(result.diffsResult, result.blob, () => showSuccessToast('Automatic sync [from] successful!'));
        } else if (outcome === 'SUCCESS') {
          await saveSuccessfulSync();
          showSuccessToast('Automatic sync [from] successful! Already latest!');
        } else if (outcome === 'RECENT_SYNC') {
          await saveSuccessfulSync();
          showSuccessToast('Automatic sync [from] successful! Nothing done because recent sync!');
        }
      }
    };
    triggerSync();
  }, [data, isLoading, openDiffsModal, showSuccessToast]);

  return <RouterProvider router={router} />
};

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <DiffsModalProvider>
        <AppWrapper />
      </DiffsModalProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} client={queryClient} />}
      {isMobile &&import.meta.env.DEV && <DebugConsole />}
      {!isInstalled && <InstallPWAButton />}
    </QueryClientProvider>
  );
};

export default App;

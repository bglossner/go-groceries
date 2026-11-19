import React, { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import './App.css';

// Import the generated route tree
import { routeTree } from './routeTree.gen';
import { DebugConsole } from './pages/DebugConsole';
import InstallPWAButton from './components/InstallPWAButton';
import { checkAndTriggerAutoSync, importSyncFile, saveSyncFromLocation } from './util/sync-from';
import { consumeIncomingLocation } from './util/sync/location';
import { DiffsModalProvider } from './contexts/DiffsModalProvider';
import { ToastProvider } from './contexts/ToastProvider';
import { useDiffsModal } from './hooks/useDiffsModal';
import { useToast } from './hooks/useToast';
import { checkAndTriggerAutoSyncTo } from './util/sync-to';
import { useDebouncedSync } from './hooks/useDebouncedSync';
import { useServiceWorkerUpdate } from './hooks/useSWUpdate';
import { runImageMigration } from './db/image-cache';

const incomingLocation = consumeIncomingLocation();
const incomingSave = incomingLocation ? saveSyncFromLocation(incomingLocation) : Promise.resolve();

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
  const handledImports = useRef(new WeakSet<Blob>());
  useDebouncedSync(); // Call the debounced sync hook
  const { openDiffsModal } = useDiffsModal();
  const { showSuccessToast, showErrorToast } = useToast();

  useServiceWorkerUpdate();
  useEffect(() => {
    if (incomingLocation) {
      void incomingSave.then(() => queryClient.invalidateQueries({ queryKey: ['syncFrom'] }))
        .catch(() => showErrorToast('Shared location could not be opened. Reopen the original link.'));
    }
  }, [showErrorToast]);
  useEffect(() => {
    const controller = new AbortController();
    const migrate = async () => {
      try {
        const result = await runImageMigration(undefined, { signal: controller.signal });
        if (result.interrupted && !controller.signal.aborted) { void migrate(); return; }
        if (result.converted && !controller.signal.aborted) await queryClient.invalidateQueries();
        if (result.blocked && !controller.signal.aborted) showErrorToast('Some original images need recovery. Their stored data has been retained.');
      } catch {
        if (!controller.signal.aborted) showErrorToast('Image conversion will retry. Original images have been retained.');
      }
    };
    void migrate();
    const timer = window.setInterval(() => { void migrate(); }, 60000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [showErrorToast]);

  const { data, isLoading } = useQuery({
    queryKey: ['checkSyncFromData'],
    queryFn: async () => {
      try {
        await incomingSave;
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
        if (outcome === 'SUCCESS' && handledImports.current.has(result.blob)) return;
        if (outcome === 'SUCCESS') handledImports.current.add(result.blob);
        if (outcome === 'SUCCESS' && (result.needsConfirmation || result.diffsResult.mealDiffs.toAdd.length > 0 || result.diffsResult.mealDiffs.toRemove.length > 0)) {
          openDiffsModal(result.diffsResult, result.blob, () => { void queryClient.invalidateQueries(); });
        } else if (outcome === 'SUCCESS') {
          const message = await importSyncFile(result.blob, { automatic: true });
          await queryClient.invalidateQueries({ predicate: query => !['checkSyncFromData', 'checkSyncToData'].includes(String(query.queryKey[0])) });
          showSuccessToast(message);
        } else if (outcome === 'ERROR') {
          showErrorToast('Automatic sync [from] failed. Retry in Sync settings.');
        } else if (outcome === 'RECENT_SYNC') {
          showSuccessToast('Automatic sync [from] successful! Nothing done because recent sync!');
        }
      }
    };
    void triggerSync().catch(error => showErrorToast(error instanceof Error ? error.message : 'Sync import failed.'));
  }, [data, isLoading, openDiffsModal, showSuccessToast, showErrorToast]);

  return <RouterProvider router={router} />
};

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DiffsModalProvider>
          <AppWrapper />
        </DiffsModalProvider>
      </ToastProvider>
      {(import.meta.env.DEV || __PWA_TEST_MODE__) && <ReactQueryDevtools initialIsOpen={false} client={queryClient} />}
      {isMobile && (import.meta.env.DEV || __PWA_TEST_MODE__) && <DebugConsole />}
      {!isInstalled && <InstallPWAButton />}
    </QueryClientProvider>
  );
};

export default App;

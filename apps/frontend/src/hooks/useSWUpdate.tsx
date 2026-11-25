import { useEffect, useRef, useState } from 'react';
import { Button } from '@mui/material';
import { liveQuery } from 'dexie';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { pwaUpdateNotificationsQuery } from '../util/db/settings';
import { useToast } from './useToast';

const UPDATE_CHECK_THROTTLE_MS = 30_000;

export const useServiceWorkerUpdate = () => {
  const { showActionToast } = useToast();
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const updateToast = useRef<{ worker: ServiceWorker; dismiss: () => void }>();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ onRegisteredSW: (_, registered) => setRegistration(registered) });

  useEffect(() => {
    if (!registration) return;

    let lastCheck = -Infinity;
    let checking = false;
    const checkOnForeground = async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine || checking) return;
      const now = performance.now();
      if (now - lastCheck < UPDATE_CHECK_THROTTLE_MS) return;
      lastCheck = now;
      checking = true;
      try {
        await registration.update();
      } catch {
        // A failed update check leaves the active worker in place. Retry on a later return.
      } finally {
        checking = false;
      }
    };
    document.addEventListener('visibilitychange', checkOnForeground);
    return () => document.removeEventListener('visibilitychange', checkOnForeground);
  }, [registration]);

  useEffect(() => {
    if (!registration) return;

    const controller = new AbortController();
    const options = { signal: controller.signal };
    const readWaitingWorker = () => setWaitingWorker(registration.active ? registration.waiting : null);
    const watchInstall = () => {
      const installing = registration.installing;
      if (installing) {
        const readInstalledWorker = () => {
          readWaitingWorker();
          if (installing.state !== 'installing') {
            installing.removeEventListener('statechange', readInstalledWorker);
          }
        };
        installing.addEventListener('statechange', readInstalledWorker, options);
      }
      readWaitingWorker();
    };
    // Reconcile on needRefresh and observe later installs after Workbox stops reporting them.
    registration.addEventListener('updatefound', watchInstall, options);
    navigator.serviceWorker.addEventListener('controllerchange', readWaitingWorker, options);
    watchInstall();
    return () => controller.abort();
  }, [registration, needRefresh]);

  useEffect(() => {
    if (updateToast.current && updateToast.current.worker !== waitingWorker) {
      updateToast.current.dismiss();
      updateToast.current = undefined;
    }
    if (!registration || !waitingWorker || updateToast.current) return;

    let accepted = false;
    const reload = () => {
      if (accepted || registration.waiting !== waitingWorker) return;
      accepted = true;

      // Workbox reloads clients that were controlled at registration. Cover a page
      // that installed its first worker here, and cancel if Workbox starts the reload.
      const serviceWorkers = navigator.serviceWorker;
      let fallbackTimer: number | undefined;
      const reloadAfterControl = () => {
        if (serviceWorkers.controller === waitingWorker) {
          fallbackTimer = window.setTimeout(() => window.location.reload(), 1000);
        }
      };
      const navigation = new AbortController();
      const options = { once: true, signal: navigation.signal };
      const cancelFallback = () => {
        navigation.abort();
        window.clearTimeout(fallbackTimer);
      };
      serviceWorkers.addEventListener('controllerchange', reloadAfterControl, options);
      window.addEventListener('beforeunload', cancelFallback, options);
      window.addEventListener('pagehide', cancelFallback, options);
      void updateServiceWorker(true);
    };

    // Read the stored setting when a worker waits and observe changes from other tabs.
    const preference = liveQuery(pwaUpdateNotificationsQuery.queryFn).subscribe({
      next: (enabled) => {
        if (!enabled || registration.waiting !== waitingWorker || updateToast.current) return;
        const dismiss = showActionToast(
          'A new version of the app is available.',
          <Button color="inherit" size="small" onClick={reload}>Reload</Button>,
        );
        updateToast.current = { worker: waitingWorker, dismiss };
      },
      error: () => { /* Leave the worker waiting if the preference could not be read. */ },
    });
    return () => preference.unsubscribe();
  }, [registration, waitingWorker, showActionToast, updateServiceWorker]);

  useEffect(() => () => {
    updateToast.current?.dismiss();
    updateToast.current = undefined;
  }, []);
};

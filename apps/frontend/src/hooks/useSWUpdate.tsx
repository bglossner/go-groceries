import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "../db/db";
import { useToast } from "./useToast";
import { Button } from "@mui/material";

const updateServiceWorker = (_val: boolean) => undefined;

export const useServiceWorkerUpdate = () => {
  const { showActionToast } = useToast();
  const [needRefresh] = useState(false);
  // const {
  //   needRefresh: [needRefresh],
  //   updateServiceWorker,
  // } = useRegisterSW({
  //   onRegistered(r) {
  //     console.log(`SW Registered: ${r}`);
  //   },
  //   onRegisterError(error) {
  //     console.log('SW registration error', error);
  //   },
  // });

  const { data: pwaUpdateNotificationsEnabled } = useQuery({
    queryKey: ['settings', 'pwaUpdateNotificationsEnabled'],
    queryFn: async () => {
      const setting = await db.settings.get('pwaUpdateNotificationsEnabled');
      // Default to true if the setting is not found
      return setting?.value === 'true' || setting?.value === undefined;
    },
  });

  useEffect(() => {
    if (needRefresh && pwaUpdateNotificationsEnabled) {
      const reloadButton = (
        <Button color="inherit" size="small" onClick={() => updateServiceWorker(true)}>
          Reload
        </Button>
      );
      showActionToast(
        'A new version of the app is available.',
        reloadButton
      );
    }
  }, [needRefresh, pwaUpdateNotificationsEnabled, showActionToast, updateServiceWorker]);
};

import { Button } from '@mui/material';
import { useState, useEffect } from 'react';

export function usePWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any | null>(null);

  useEffect(() => {
    function handler(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as any);
    }

    window.addEventListener('beforeinstallprompt', handler);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  return { deferredPrompt, setDeferredPrompt };
}

export default function InstallPWAButton() {
  const { deferredPrompt, setDeferredPrompt } = usePWAInstallPrompt();

  const handleInstallClick = () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();

    deferredPrompt.userChoice.then((choiceResult: any) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('User accepted the install prompt');
      } else {
        console.log('User dismissed the install prompt');
      }
      setDeferredPrompt(null);
    });
  };

  if (!deferredPrompt) {
    // Nothing to show if no install prompt is available yet
    return null;
  }

  return (
    <Button sx={{ mt: 2, minWidth: '20%', maxWidth: '250px' }} variant="contained" onClick={handleInstallClick}>
      Install App
    </Button>
  );
}

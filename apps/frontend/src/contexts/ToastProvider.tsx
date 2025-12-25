import React, { useState, type ReactNode, useCallback } from 'react';
import { Snackbar, Alert } from '@mui/material';
import { ToastContext } from './ToastContext';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  action?: React.ReactNode;
}

const TOAST_DURATION = 5000; // milliseconds

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toastMessages, setToastMessages] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info', action?: React.ReactNode) => {
    setToastMessages((prev) => [...prev, { id: Math.random().toString(36).substring(7), message, type, action }]);
  }, []);

  const showSuccessToast = useCallback((message: string) => showToast(message, 'success'), [showToast]);
  const showErrorToast = useCallback((message: string) => showToast(message, 'error'), [showToast]);
  const showActionToast = useCallback((message: string, action: React.ReactNode) => showToast(message, 'info', action), [showToast]);

  return (
    <ToastContext.Provider value={{ showSuccessToast, showErrorToast, showActionToast }}>
      {children}
      {toastMessages.map((toast, index) => (
        <Snackbar
          key={toast.id}
          open={true}
          autoHideDuration={toast.action ? null : TOAST_DURATION}
          onClose={() => setToastMessages((prev) => prev.filter((t) => t.id !== toast.id))}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          sx={{ top: `${8 + index * 60}px !important` }}
        >
          <Alert
            onClose={() => setToastMessages((prev) => prev.filter((t) => t.id !== toast.id))}
            severity={toast.type}
            sx={{ width: '100%' }}
            action={toast.action}
          >
            {toast.message}
          </Alert>
        </Snackbar>
      ))}
    </ToastContext.Provider>
  );
};

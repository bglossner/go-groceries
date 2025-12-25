import { createContext } from 'react';

interface ToastContextType {
  showSuccessToast: (message: string) => void;
  showErrorToast: (message: string) => void;
  showActionToast: (message: string, action: React.ReactNode) => void;
}

export const ToastContext = createContext<ToastContextType | undefined>(undefined);

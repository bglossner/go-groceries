import type { DiffsResult } from '../util/db/import';
import React from "react";
import type { Meal } from "../db/db";

interface DiffsModalContextType {
  openDiffsModal: (diffsData: { mealDiffs: { toAdd: Meal[], toRemove: Meal[] }; restaurantDiffs?: DiffsResult['restaurantDiffs'] }, blob: Blob, onConfirm: () => void) => void;
  closeDiffsModal: () => void;
  showSuccessToast: (message: string) => void;
  showErrorToast: (message: string) => void;
}

export const DiffsModalContext = React.createContext<DiffsModalContextType | undefined>(undefined);

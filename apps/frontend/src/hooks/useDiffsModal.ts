import { useContext } from "react";
import { DiffsModalContext } from "../contexts/DiffsModalContext";

export const useDiffsModal = () => {
  const context = useContext(DiffsModalContext);
  if (context === undefined) {
    throw new Error('useDiffsModal must be used within a DiffsModalProvider');
  }
  return context;
};

import React from 'react';

import { StoreAccordion } from './StoreAccordion';
import { UNCATEGORIZED_STORE_ID } from '../constants';
import type { AggregatedIngredient, PartitionedIngredients } from '../types/grocery-list-types';



interface PartitionedGroceryListProps {
  partitionedIngredients: PartitionedIngredients;
  searchTerm: string;
  expandedStoreAccordions: Map<number, boolean>;
  handleAccordionToggle: (storeId: number) => (event: React.SyntheticEvent) => void;
  renderIngredientItem: (ing: AggregatedIngredient, showDivider: boolean) => JSX.Element;
}

export const PartitionedGroceryList: React.FC<PartitionedGroceryListProps> = ({
  partitionedIngredients,
  searchTerm,
  expandedStoreAccordions,
  handleAccordionToggle,
  renderIngredientItem,
}) => {
  const filteredByStore = new Map(
    Array.from(partitionedIngredients.byStore.entries()).filter(([, entry]) =>
      entry.ingredients.some(ing => ing.name.toLowerCase().includes(searchTerm.toLowerCase()))
    )
  );
  const filteredUncategorized = partitionedIngredients.uncategorized.filter(ing =>
    ing.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <>
      {Array.from(filteredByStore.entries()).map(([storeId, storeEntryValue]) => (
        <StoreAccordion
          key={storeId}
          storeId={storeId}
          storeName={storeEntryValue.storeName}
          storeColor={storeEntryValue.storeColor}
          ingredients={storeEntryValue.ingredients}
          expanded={expandedStoreAccordions.get(storeId) ?? true}
          onToggleExpand={handleAccordionToggle}
          renderIngredientItem={renderIngredientItem}
        />
      ))}

      {filteredUncategorized.length > 0 && (
        <StoreAccordion
          storeId={UNCATEGORIZED_STORE_ID}
          storeName="Uncategorized"
          ingredients={filteredUncategorized}
          expanded={expandedStoreAccordions.get(UNCATEGORIZED_STORE_ID) ?? true}
          onToggleExpand={handleAccordionToggle}
          renderIngredientItem={renderIngredientItem}
        />
      )}
    </>
  );
};

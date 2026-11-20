import React from 'react';
import { Accordion, AccordionSummary, AccordionDetails, Typography, Box, IconButton, List } from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import type { AggregatedIngredient } from '../types/grocery-list-types';


interface StoreAccordionProps {
  storeId: number;
  storeName: string;
  storeColor?: string;
  ingredients: AggregatedIngredient[];
  expanded: boolean;
  onToggleExpand: (storeId: number) => (event: React.SyntheticEvent) => void;
  renderIngredientItem: (ing: AggregatedIngredient, showDivider: boolean) => JSX.Element;
}

export const StoreAccordion: React.FC<StoreAccordionProps> = ({
  storeId,
  storeName,
  storeColor,
  ingredients,
  expanded,
  onToggleExpand,
  renderIngredientItem,
}) => {
  return (
    <Accordion
      key={storeId}
      expanded={expanded}
      onChange={onToggleExpand(storeId)}
    >
      <AccordionSummary>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {storeColor && (
              <Box sx={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: storeColor, border: '1px solid grey' }} />
            )}
            <Typography>{storeName}</Typography>
          </Box>
          <IconButton onClick={onToggleExpand(storeId)} size="small">
            <ExpandMore sx={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s"
            }} />
          </IconButton>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <List>
          {ingredients.map((ing) => renderIngredientItem(ing, false))}
        </List>
      </AccordionDetails>
    </Accordion>
  );
};

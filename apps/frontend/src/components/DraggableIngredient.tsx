import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMemo, type CSSProperties } from 'react';
import IngredientItem from './IngredientItem';
import { Paper, Box } from '@mui/material';
import { type Store, type IngredientStore } from '../db/db';

const DraggableIngredient = ({ name, storeId, stores, ingredientStores }: { name: string, storeId?: number, stores?: Store[], ingredientStores?: IngredientStore[] }) => {
    const id = useMemo(() => {
      return storeId !== undefined ? `${name}-${storeId}` : name;
    }, [name, storeId]);

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: id });
    const style: CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      cursor: 'grab',
      userSelect: 'none',
      opacity: isDragging ? 0 : 1, // Hide the original item when dragging
    };

    const associatedStores = useMemo(() => {
      if (!stores || !ingredientStores) return [];
      const associatedStoreIds = ingredientStores
        .filter(is => is.ingredientName === name)
        .map(is => is.storeId);
      return stores.filter(s => associatedStoreIds.includes(s.id!));
    }, [name, stores, ingredientStores]);

    return (
      <Paper ref={setNodeRef} style={style} {...attributes} {...listeners} sx={{ display: 'flex', alignItems: 'center', p: 1, mb: 1 }}>
        {associatedStores.length > 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', mr: 1 }}>
            {associatedStores.map(s => s.color && (
              <Box key={s.id} sx={{ width: 5, height: 10, backgroundColor: s.color, mb: 0.5 }} />
            ))}
          </Box>
        )}
        <IngredientItem name={name} />
      </Paper>
    );
};

export default DraggableIngredient;

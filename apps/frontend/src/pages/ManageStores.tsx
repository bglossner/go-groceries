import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '../db/db';
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, DragOverlay, type DragStartEvent, defaultDropAnimationSideEffects, type DropAnimation, TouchSensor, rectIntersection, pointerWithin, type CollisionDetection } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Box } from '@mui/material';
import CreateStoreForm from '../components/CreateStoreForm';
import AvailableIngredientsList from '../components/AvailableIngredientsList';
import StoreBucket from '../components/StoreBucket';
import IngredientItem from '../components/IngredientItem';
import TrashCan from '../components/TrashCan';

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.5',
      },
    },
  }),
};

const ManageStoresPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const addIngredientToStore = useMutation({
    mutationFn: (data: { ingredientName: string, storeId: number }) => db.ingredientStores.add(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredientStores'] });
    },
    onError: () => {
      // Ignore constraint violations (duplicate entries)
    }
  });

  const removeIngredientFromStore = useMutation({
    mutationFn: async (data: { ingredientName: string, storeId: number }) => {
      await db.ingredientStores.where({ ingredientName: data.ingredientName, storeId: data.storeId }).delete();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredientStores'] });
    },
  });

  const { data: meals } = useQuery({ queryKey: ['meals'], queryFn: () => db.meals.toArray() });
  const { data: customIngredients } = useQuery({ queryKey: ['customIngredients'], queryFn: () => db.customIngredients.toArray() });
  const { data: stores } = useQuery({ queryKey: ['stores'], queryFn: () => db.stores.orderBy('name').toArray() });
  const { data: ingredientStores } = useQuery({ queryKey: ['ingredientStores'], queryFn: () => db.ingredientStores.toArray() });

  const allIngredients = useMemo(() => {
    const ingredients = new Set<string>();
    meals?.forEach(meal => meal.ingredients.forEach(ing => ingredients.add(ing.name.toLowerCase())));
    customIngredients?.forEach(ing => ingredients.add(ing.name.toLowerCase()));
    return Array.from(ingredients).sort();
  }, [meals, customIngredients]);

  const ingredientsByStore = useMemo(() => {
    const byStore = new Map<number, string[]>();
    stores?.forEach(store => byStore.set(store.id!, []));
    ingredientStores?.forEach(is => {
      if (byStore.has(is.storeId)) {
        byStore.get(is.storeId)!.push(is.ingredientName);
      }
    });
    byStore.forEach(ings => ings.sort());
    return byStore;
  }, [stores, ingredientStores]);

  const sensors = useSensors(
    useSensor(TouchSensor),
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over) {
      setActiveId(null);
      return;
    }

    const draggedIdParts = String(active.id).split('-');
    const ingredientName = draggedIdParts[0];
    const sourceStoreId = draggedIdParts.length > 1 ? Number(draggedIdParts[1]) : undefined;

    if (over.id === 'trash-can') {
      if (sourceStoreId !== undefined) {
        removeIngredientFromStore.mutate({ ingredientName, storeId: sourceStoreId });
      }
    } else if (!isNaN(Number(over.id))) { // Dropped over a store bucket
      const targetStoreId = Number(over.id);
      if (allIngredients.includes(ingredientName)) {
        addIngredientToStore.mutate({ ingredientName, storeId: targetStoreId });
      }
    }
    setActiveId(null);
  }

  const collisionDetection: CollisionDetection = (args) => {
    const filtered = args.droppableContainers.filter(container =>
      container.id !== args.active.id
        && (typeof container.id !== 'string' || !container.id.endsWith('-ing'))
    );

    const pointerCollisions = pointerWithin({ ...args, droppableContainers: filtered });
    // If the pointer is over a droppable, return that collision
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return rectIntersection({ ...args, droppableContainers: filtered });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 2, p: 2 }}>
        <SortableContext items={allIngredients} strategy={verticalListSortingStrategy}>
          <AvailableIngredientsList ingredients={allIngredients} stores={stores || []} ingredientStores={ingredientStores || []} />
        </SortableContext>

        <div>
          <CreateStoreForm />
          <TrashCan />
          <SortableContext items={stores?.map(s => s.id!) || []} strategy={verticalListSortingStrategy}>
            {stores?.map(store => (
              <StoreBucket key={store.id} store={store} ingredients={ingredientsByStore.get(store.id!) || []} />
            ))}
          </SortableContext>
        </div>
      </Box>
      <DragOverlay style={{ pointerEvents: 'none', zIndex: 9999 }} dropAnimation={dropAnimation}>
        {activeId ? <IngredientItem name={activeId.split('-')[0]} /> : null}
      </DragOverlay>
    </DndContext>
  );
};

export default ManageStoresPage;
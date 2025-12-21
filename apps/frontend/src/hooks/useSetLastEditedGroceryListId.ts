import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setLastEditedGroceryListId } from '../util/db/settings';

export const useSetLastEditedGroceryListId = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => setLastEditedGroceryListId(id),
    onSuccess: () => {
      return queryClient.invalidateQueries({
        queryKey: ['lastEditedGroceryListId'],
        refetchType: 'active',
      });
    },
  });
};

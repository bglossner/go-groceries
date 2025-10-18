import { createLazyFileRoute } from '@tanstack/react-router';
import ManageStoresPage from '../pages/ManageStores';

export const Route = createLazyFileRoute('/manage-stores')({
  component: ManageStoresPage,
});

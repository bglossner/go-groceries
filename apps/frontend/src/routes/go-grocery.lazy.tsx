import { createLazyFileRoute } from '@tanstack/react-router';
import GoGroceryPage from '../pages/GoGrocery';

export const Route = createLazyFileRoute('/go-grocery')({
  component: GoGroceryPage,
});

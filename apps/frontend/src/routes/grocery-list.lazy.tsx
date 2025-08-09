import { createLazyFileRoute } from '@tanstack/react-router'
import GroceryList from '../pages/GroceryList'

export const Route = createLazyFileRoute('/grocery-list')({
  component: GroceryList,
})

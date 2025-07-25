import { createLazyFileRoute } from '@tanstack/react-router'
import Meals from '../pages/Meals'

export const Route = createLazyFileRoute('/meals')({
  component: Meals,
})

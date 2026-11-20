import {createFileRoute} from '@tanstack/react-router';
import Restaurants from '../pages/Restaurants';
export const Route = createFileRoute('/restaurant/$restaurantId')({component:Detail});
function Detail(){const {restaurantId}=Route.useParams();return <Restaurants key={restaurantId} restaurantId={Number(restaurantId)} />;}

import type { ImageRef } from './image-assets';
export type OwnedImage = Extract<ImageRef, { kind: 'asset' }>;
export type Restaurant = {
  id?: number; name: string; tags: number[]; notes: string; isPinned: boolean;
  country?: string; region?: string; city?: string; countryKey: string; regionKey: string; cityKey: string;
  address?: string; latitude?: number; longitude?: number; googleMapsUrl?: string; menuImages?: OwnedImage[];
  createdAt: string; updatedAt: string;
};
export type RestaurantTag = { id?: number; name: string; normalizedName: string;
  group: 'cuisine' | 'dietary' | 'price' | 'service' | 'occasion' | 'custom' };
export type RestaurantItem = {
  id?: number; restaurantId: number; name: string; description: string; notes: string;
  images: OwnedImage[]; coverImageIndex?: number; priceAmount?: string; currency?: string; portion?: string;
  spiceLevel?: 'unknown' | 'none' | 'mild' | 'medium' | 'hot' | 'extra hot'; modifiers?: string;
  category?: 'unknown' | 'starter' | 'main' | 'side' | 'drink' | 'dessert'; lastOrderedDate?: string;
  dietaryFlags: ('vegetarian' | 'vegan' | 'gluten-free option' | 'dairy-free option')[];
  createdAt: string; updatedAt: string;
};
export type Person = { id?: number; name: string; normalizedName: string; status: 'active' | 'archived'; createdAt: string; updatedAt: string };
export type RestaurantItemRating = { id?: number; itemId: number; personId: number; score: number;
  comment?: string; wouldOrderAgain?: 'yes' | 'no' | 'undecided'; createdAt: string; updatedAt: string };

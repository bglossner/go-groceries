import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import type { ZodType, infer as zodInfer } from 'zod';
import type { ZodTypeDef } from 'zod/v3';

export function zodResolverLoggerWrapper<T extends ZodType<any, ZodTypeDef, any>>(
  schema: T
): Resolver<zodInfer<T>> {
  const resolver = zodResolver(schema);
  return async (resolve, ctx, values) => {
    const result = await resolver(resolve as unknown as any, ctx, values as unknown as any);
    console.log('Zod Resolver Output:', result);
    return result;
  };
}
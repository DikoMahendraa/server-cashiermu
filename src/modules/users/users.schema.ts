import { z } from 'zod';

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().default(''),
  pin: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
  branchId: z.string().uuid().optional(),
  role: z.enum(['cashier', 'owner']).default('cashier'),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  branchId: z.string().uuid().nullable().optional(),
});

export const changePinSchema = z.object({
  newPin: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
  ownerPin: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
export type ChangePinDto = z.infer<typeof changePinSchema>;

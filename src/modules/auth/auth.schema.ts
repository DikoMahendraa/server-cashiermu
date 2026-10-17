import { z } from 'zod';

export const registerSchema = z
  .object({
    storeName: z.string().min(1),
    ownerName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1),
    pin: z
      .string()
      .length(6)
      .regex(/^\d{6}$/),
    pinConfirm: z
      .string()
      .length(6)
      .regex(/^\d{6}$/),
  })
  .refine(data => data.pin === data.pinConfirm, {
    message: 'PIN confirmation does not match',
    path: ['pinConfirm'],
  });

export const checkCredentialSchema = z.object({
  credential: z.string().min(1),
});

export const loginSchema = z.object({
  credential: z.string().min(1),
  pin: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RegisterDto = z.infer<typeof registerSchema>;
export type CheckCredentialDto = z.infer<typeof checkCredentialSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;

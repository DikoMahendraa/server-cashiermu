import { randomBytes } from 'crypto';

/** Job progress of a service order. Independent of payment: a job can be paid and still be in progress. */
export const JOB_STATUSES = ['pending', 'in_progress', 'ready', 'completed'] as const;
export type JobStatusValue = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatusValue, string> = {
  pending: 'Menunggu',
  in_progress: 'Diproses',
  ready: 'Siap diambil',
  completed: 'Selesai',
};

/** Statuses that still need attention from the staff (everything except completed). */
export const OPEN_JOB_STATUSES: JobStatusValue[] = ['pending', 'in_progress', 'ready'];

/** 24 random bytes → 32 url-safe chars (192 bits): unguessable, so the link itself is the access control. */
export function newReceiptToken(): string {
  return randomBytes(24).toString('base64url');
}

export const RECEIPT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

export function receiptUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/r/${token}`;
}

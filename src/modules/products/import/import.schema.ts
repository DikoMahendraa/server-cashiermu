import { z } from 'zod';
import { MAX_IMPORT_ROWS } from './import.plan';

const cell = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]);

/**
 * The phone reads the spreadsheet and sends its rows as JSON; the server does ALL the validation.
 * `rows` are keyed by the header text found in the file.
 */
export const importBodySchema = z.object({
  headers: z.array(z.string().max(120)).min(1).max(100),
  rows: z.array(z.record(cell)).min(1).max(MAX_IMPORT_ROWS),
});

export type ImportBody = z.infer<typeof importBodySchema>;

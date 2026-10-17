# 4. Adding a feature

A worked example: **Suppliers** — each store keeps a list of suppliers (CRUD). Follow the same steps for any
new resource. Replace `Supplier/supplier` with your feature name.

## 0. Before you code

1. Write 3–5 lines: what endpoints, who can call them (owner? cashier?), what data is stored.
2. Check [`CHANGELOG.md`](../CHANGELOG.md) and the schema — does something similar exist?
3. Decide if it is **backwards compatible** for old app versions (new endpoint/optional field = yes; renaming/removing/changing meaning = no → see [Versioning](07-versioning-and-releases.md)).
4. Branch: `git switch main && git pull && git switch -c feat/suppliers`.

## 1. Data model — `prisma/schema.prisma`

```prisma
model Supplier {
  id        String   @id @default(uuid())
  storeId   String
  name      String
  phone     String   @default("")
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  store Store @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, name]) // unique PER STORE
  @@index([storeId])
}
```

Also add the back-relation inside `model Store { ... suppliers Supplier[] }`.

Checklist: `storeId` + relation + index ✔ · money as `Decimal(15,2)` ✔ · unique constraints scoped by store ✔ · fields have sensible defaults ✔.

## 2. Migration

```bash
npm run db:migrate -- --name add_suppliers   # creates prisma/migrations/<timestamp>_add_suppliers + applies it locally
npx prisma validate
```

Open the generated `migration.sql` and read it. Commit it together with the schema. Rules: never edit a migration
that was already applied anywhere; fix mistakes with a **new** migration (details in [Versioning](07-versioning-and-releases.md#database-migrations)).

## 3. Create the module folder

```
src/modules/suppliers/
  suppliers.schema.ts
  suppliers.controller.ts
  suppliers.routes.ts
```

### `suppliers.schema.ts` — validate input

```ts
import { z } from 'zod';

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(30).default(''),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export type CreateSupplierDto = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierDto = z.infer<typeof updateSupplierSchema>;
```

Be strict: set max lengths, use `z.coerce.number()` for numbers, `.uuid()` for ids. Never accept `storeId`
from the body.

### `suppliers.controller.ts` — thin handlers

```ts
import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/database';
import { CreateSupplierDto, UpdateSupplierDto } from './suppliers.schema';

export const listSuppliers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const suppliers = await prisma.supplier.findMany({
      where: { storeId: req.user!.storeId },
      orderBy: { name: 'asc' },
    });
    res.json(suppliers);
  } catch (err) {
    next(err); // always forward errors to errorHandler
  }
};

export const createSupplier = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const supplier = await prisma.supplier.create({
      data: { ...(req.body as CreateSupplierDto), storeId: req.user!.storeId },
    });
    res.status(201).json(supplier); // duplicate name → Prisma P2002 → errorHandler returns 409
  } catch (err) {
    next(err);
  }
};

export const updateSupplier = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const supplier = await prisma.supplier.update({
      where: { id, storeId: req.user!.storeId }, // storeId in `where` = cannot touch another shop's row
      data: req.body as UpdateSupplierDto,
    });
    res.json(supplier); // unknown id → P2025 → 404
  } catch (err) {
    next(err);
  }
};

export const deleteSupplier = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    await prisma.supplier.delete({ where: { id, storeId: req.user!.storeId } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
```

If a handler grows past ~30 lines or has real business rules, move that part into `suppliers.service.ts`
(see [Architecture](03-architecture.md#layers-and-their-one-job)).

### `suppliers.routes.ts` — wire middleware in the right order

```ts
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { createSupplierSchema, updateSupplierSchema } from './suppliers.schema';
import * as suppliersController from './suppliers.controller';

const router = Router();

// order matters: who are you → what may you do → is the body valid → handler
router.get('/', authenticate, suppliersController.listSuppliers);
router.post(
  '/',
  authenticate,
  requireRole('owner'),
  validate(createSupplierSchema),
  suppliersController.createSupplier,
);
router.patch(
  '/:id',
  authenticate,
  requireRole('owner'),
  validate(updateSupplierSchema),
  suppliersController.updateSupplier,
);
router.delete('/:id', authenticate, requireRole('owner'), suppliersController.deleteSupplier);

export default router;
```

**Every route starts with `authenticate`.** There are no public data routes. (Only `/health`, `/auth/register`,
`/auth/check-credential`, `/auth/login`, `/auth/refresh` and the documentation site `/docs` are open.)

## 4. Register the router — `src/app.ts`

```ts
import suppliersRoutes from './modules/suppliers/suppliers.routes';
// ...
app.use('/api/v1/suppliers', suppliersRoutes);
```

URL rules: plural kebab-case noun (`/pending-bills`), HTTP verb carries the action
(`GET` read, `POST` create, `PATCH` partial update, `DELETE` remove). Odd actions get a sub-path
(`POST /transactions/:id/void`).

## 5. Test it

1. **Unit tests** for any real logic (calculations, rules) — put pure functions in their own file and test them in `test/`. Pattern: `test/checkout.pricing.test.ts`. CRUD-only modules don't need unit tests.
2. **Manual / curl smoke test** with a real token:

   ```bash
   TOKEN=$(curl -s localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' \
     -d '{"credential":"you@example.com","pin":"123456"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).accessToken")
   curl -s localhost:3000/api/v1/suppliers -H "Authorization: Bearer $TOKEN"
   ```

3. **Isolation check (required for every new table):** log in as a second store (register a second owner) and confirm
   it cannot list, read, update or delete the first store's suppliers (you should get an empty list / 404).
4. **Permission check:** a cashier token must get `403` on owner-only routes.
5. Run `npm run check`.

## 6. Document and ship

1. Add a line under `## [Unreleased]` in [`CHANGELOG.md`](../CHANGELOG.md) (Added/Changed/Fixed; mention new endpoints and migrations).
2. Commit in small steps with [Conventional Commits](06-git-workflow.md#commit-messages):
   `feat(suppliers): add suppliers table and migration`, `feat(suppliers): add CRUD endpoints`.
3. Push, open a PR, tick the checklist (the template is in `.github/pull_request_template.md`).
4. After merge, release when ready — see [Versioning & releases](07-versioning-and-releases.md#releasing).

## Quick checklist

- [ ] Table has `storeId` + relation + index; uniques are per store
- [ ] Migration generated, read, committed with the schema
- [ ] Every route has `authenticate`; owner-only routes have `requireRole('owner')`
- [ ] Body validated with zod (max lengths, no `storeId` from client)
- [ ] Every query filters by `req.user.storeId`; foreign ids are checked to belong to the store
- [ ] Errors go through `next(err)` or a typed error with a stable `code`
- [ ] No `console.log`, no secrets, no PINs/tokens in logs
- [ ] Router registered in `app.ts`
- [ ] Tests for logic + isolation + permission checked
- [ ] `CHANGELOG.md` updated, `npm run check` passes

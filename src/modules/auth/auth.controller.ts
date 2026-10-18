import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../../config/database';
import { env } from '../../config/env';
import { RegisterDto, CheckCredentialDto, LoginDto, RefreshDto } from './auth.schema';
import { getSubtypeConfig, isValidSubtype } from '../sectors/sector.config';
import { loginTotal } from '../../observability/metrics';
import { LoginGuard } from './login-guard';

const lockoutMs = env.LOGIN_LOCKOUT_MINUTES * 60 * 1000;
// Two independent locks: per client address (stops one device guessing many accounts) and per account (stops guessing
// one PIN from many addresses). Either one locked means "try again later".
const ipGuard = new LoginGuard({ maxAttempts: env.MAX_LOGIN_ATTEMPTS, lockoutMs });
const accountGuard = new LoginGuard({ maxAttempts: env.MAX_LOGIN_ATTEMPTS * 2, lockoutMs });

// bcrypt hash of a random string; compared against when the account does not exist (see login)
const DUMMY_PIN_HASH = bcrypt.hashSync(randomUUID(), 10);

function signAccessToken(payload: object): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN } as jwt.SignOptions);
}

function signRefreshToken(payload: object): string {
  // jwtid makes each token unique: without it, two logins in the same second produce
  // identical tokens and the unique constraint on RefreshToken.token rejects the second.
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    jwtid: randomUUID(),
  } as jwt.SignOptions);
}

export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { storeName, ownerName, sector, subtype, email, phone, pin } = req.body as RegisterDto;

    if (!isValidSubtype(sector, subtype)) {
      res.status(422).json({ code: 'INVALID_SUBTYPE', message: 'Jenis usaha tidak valid untuk bidang usaha ini' });
      return;
    }

    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
    if (existing) {
      res.status(409).json({ message: 'Email or phone already registered' });
      return;
    }

    const pinHash = await bcrypt.hash(pin, 10);

    const { store, user } = await prisma.$transaction(async tx => {
      const store = await tx.store.create({ data: { name: storeName, phone, email, sector, subtype } });
      const branch = await tx.branch.create({ data: { name: 'Cabang Utama', storeId: store.id } });
      const user = await tx.user.create({
        data: { name: ownerName, email, phone, role: 'owner', pinHash, branchId: branch.id, storeId: store.id },
      });
      await tx.category.createMany({
        // Starter categories for the chosen sector; the owner can rename, add or delete them afterwards
        data: getSubtypeConfig(sector, subtype).categories.map((cat, index) => ({
          ...cat,
          sortOrder: index + 1,
          storeId: store.id,
        })),
      });
      return { store, user };
    });

    const tokenPayload = { userId: user.id, role: user.role, branchId: user.branchId, storeId: user.storeId };
    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken({ userId: user.id });

    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });

    res.status(201).json({
      user: { id: user.id, name: user.name, role: user.role, storeId: user.storeId },
      store: { id: store.id, name: store.name, sector: store.sector, subtype: store.subtype },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
};

export const checkCredential = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { credential } = req.body as CheckCredentialDto;

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: credential }, { phone: credential }],
        isActive: true,
      },
      select: { id: true, name: true, role: true, avatarUrl: true },
    });

    if (!user) {
      res.status(404).json({ exists: false, message: 'Akun tidak ditemukan' });
      return;
    }

    res.json({ exists: true, user });
  } catch (err) {
    next(err);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { credential, pin } = req.body as LoginDto;
    const ip = req.ip || 'unknown';
    const account = credential.trim().toLowerCase();

    if (ipGuard.lockedFor(ip) > 0 || accountGuard.lockedFor(account) > 0) {
      loginTotal.inc({ result: 'locked' });
      res.status(429).json({ message: `Too many failed attempts. Try again in ${env.LOGIN_LOCKOUT_MINUTES} minutes.` });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: credential }, { phone: credential }],
        isActive: true,
      },
    });

    // Same answer and same work whether the account exists or not, so timing does not reveal it either
    const pinMatch = await bcrypt.compare(pin, user?.pinHash ?? DUMMY_PIN_HASH);
    if (!user || !pinMatch) {
      ipGuard.recordFailure(ip);
      accountGuard.recordFailure(account);
      loginTotal.inc({ result: 'invalid_credentials' });
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    ipGuard.clear(ip);
    accountGuard.clear(account);
    loginTotal.inc({ result: 'success' });

    const tokenPayload = { userId: user.id, role: user.role, branchId: user.branchId, storeId: user.storeId };
    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken({ userId: user.id });

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const store = await prisma.store.findUnique({
      where: { id: user.storeId },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        email: true,
        logoUrl: true,
        receiptHeader: true,
        receiptFooter: true,
        taxEnabled: true,
        taxRate: true,
        serviceChargeEnabled: true,
        serviceChargeRate: true,
        currency: true,
        currencySymbol: true,
        shiftEnabled: true,
        shiftRequireOpeningBalance: true,
        shiftBranchSelection: true,
        globalDiscountEnabled: true,
        globalDiscountType: true,
        globalDiscountValue: true,
        cashierCanDiscount: true,
        sector: true,
        subtype: true,
      },
    });

    // requireShift: kasir wajib punya shift aktif sebelum operasional
    const requireShift = user.role !== 'owner' && (store?.shiftEnabled ?? false);

    // activeShift selalu di-query untuk semua role — owner juga bisa punya shift aktif
    const activeShift = await prisma.shift.findFirst({
      where: { userId: user.id, storeId: user.storeId, status: 'open' },
      select: { id: true, branchId: true, type: true, startedAt: true, openingBalance: true },
    });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        branchId: user.branchId,
        avatarUrl: user.avatarUrl,
        storeId: user.storeId,
      },
      store,
      requireShift,
      activeShift,
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
};

export const refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { refreshToken } = req.body as RefreshDto;

    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored || stored.expiresAt < new Date()) {
      res.status(401).json({ message: 'Invalid or expired refresh token' });
      return;
    }

    let payload: { userId: string };
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { userId: string };
    } catch {
      res.status(401).json({ message: 'Invalid refresh token' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive) {
      res.status(401).json({ message: 'User not found or inactive' });
      return;
    }

    const accessToken = signAccessToken({
      userId: user.id,
      role: user.role,
      branchId: user.branchId,
      storeId: user.storeId,
    });
    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { refreshToken } = req.body as RefreshDto;
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

export const updateMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { name, email, phone } = req.body as { name?: string; email?: string; phone?: string };

    if (email) {
      const conflict = await prisma.user.findFirst({ where: { email, NOT: { id: userId } } });
      if (conflict) {
        res.status(409).json({ message: 'Email sudah digunakan oleh akun lain' });
        return;
      }
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
      },
      select: { id: true, name: true, email: true, phone: true, role: true },
    });

    res.json(user);
  } catch (err) {
    next(err);
  }
};

export const me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        branchId: true,
        storeId: true,
        avatarUrl: true,
        isActive: true,
      },
    });
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const store = await prisma.store.findUnique({
      where: { id: user.storeId },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        email: true,
        logoUrl: true,
        receiptHeader: true,
        receiptFooter: true,
        taxEnabled: true,
        taxRate: true,
        serviceChargeEnabled: true,
        serviceChargeRate: true,
        currency: true,
        currencySymbol: true,
        shiftEnabled: true,
        shiftRequireOpeningBalance: true,
        shiftBranchSelection: true,
        globalDiscountEnabled: true,
        globalDiscountType: true,
        globalDiscountValue: true,
        cashierCanDiscount: true,
        sector: true,
        subtype: true,
      },
    });

    const requireShift = user.role !== 'owner' && (store?.shiftEnabled ?? false);

    // activeShift selalu di-query untuk semua role
    const activeShift = await prisma.shift.findFirst({
      where: { userId: user.id, storeId: user.storeId, status: 'open' },
      select: { id: true, branchId: true, type: true, startedAt: true, openingBalance: true },
    });

    res.json({ user, store, requireShift, activeShift });
  } catch (err) {
    next(err);
  }
};

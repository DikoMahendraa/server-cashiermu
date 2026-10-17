import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../../config/database';
import { CreateUserDto, UpdateUserDto, ChangePinDto } from './users.schema';

export const listUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const role = typeof req.query['role'] === 'string' ? req.query['role'] as 'owner' | 'cashier' : undefined;
    const users = await prisma.user.findMany({
      where: { storeId: req.user!.storeId, ...(role ? { role } : {}) },
      select: { id: true, name: true, email: true, phone: true, role: true, branchId: true, isActive: true, avatarUrl: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
};

export const createUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { pin, ...data } = req.body as CreateUserDto;
    const pinHash = await bcrypt.hash(pin, 10);
    const user = await prisma.user.create({
      data: { ...data, pinHash, storeId: req.user!.storeId },
      select: { id: true, name: true, email: true, phone: true, role: true, branchId: true, isActive: true },
    });
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
};

export const getUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const user = await prisma.user.findUnique({
      where: { id, storeId: req.user!.storeId },
      select: { id: true, name: true, email: true, phone: true, role: true, branchId: true, isActive: true, avatarUrl: true, createdAt: true },
    });
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    res.json(user);
  } catch (err) {
    next(err);
  }
};

export const updateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const user = await prisma.user.update({
      where: { id, storeId: req.user!.storeId },
      data: req.body as UpdateUserDto,
      select: { id: true, name: true, email: true, phone: true, role: true, branchId: true, isActive: true },
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
};

export const changePin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const { newPin, ownerPin } = req.body as ChangePinDto;
    const storeId = req.user!.storeId;

    const owner = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!owner) { res.status(404).json({ message: 'Owner not found' }); return; }

    const ownerPinMatch = await bcrypt.compare(ownerPin, owner.pinHash);
    if (!ownerPinMatch) { res.status(401).json({ message: 'Invalid owner PIN' }); return; }

    const targetUser = await prisma.user.findUnique({ where: { id, storeId } });
    if (!targetUser) { res.status(404).json({ message: 'User not found' }); return; }
    if (targetUser.role === 'owner' && targetUser.id !== owner.id) {
      res.status(403).json({ message: "Cannot change another owner's PIN" });
      return;
    }

    const pinHash = await bcrypt.hash(newPin, 10);
    await prisma.user.update({ where: { id, storeId }, data: { pinHash } });
    res.json({ message: 'PIN updated successfully' });
  } catch (err) {
    next(err);
  }
};

export const deleteUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const storeId = req.user!.storeId;

    if (id === req.user!.userId) {
      res.status(400).json({ message: 'Tidak dapat menghapus akun sendiri' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id, storeId } });
    if (!user) { res.status(404).json({ message: 'Karyawan tidak ditemukan' }); return; }
    if (user.role === 'owner') { res.status(403).json({ message: 'Tidak dapat menghapus akun owner' }); return; }

    const [txCount, shiftCount] = await Promise.all([
      prisma.transaction.count({ where: { userId: id } }),
      prisma.shift.count({ where: { userId: id } }),
    ]);

    if (txCount > 0 || shiftCount > 0) {
      res.status(409).json({
        message: `Karyawan ini memiliki ${txCount} transaksi dan ${shiftCount} shift. Nonaktifkan akun untuk membatasi akses.`,
        hasData: true,
      });
      return;
    }

    await prisma.user.delete({ where: { id } });
    res.json({ message: 'Karyawan berhasil dihapus' });
  } catch (err) {
    next(err);
  }
};

export const toggleStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const storeId = req.user!.storeId;

    if (id === req.user!.userId) {
      res.status(400).json({ message: 'Cannot deactivate your own account' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id, storeId } });
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    const updated = await prisma.user.update({
      where: { id, storeId },
      data: { isActive: !user.isActive },
      select: { id: true, name: true, isActive: true },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

import type { Request, Response } from 'express';
import type { users as UserModel } from '@prisma/client';

import { AppError } from '../../utils/AppError.js';
import { loginSchema, userIdParamSchema } from './schema.js';
import { getUserById, listUsers, upsertOnLogin } from './service.js';

/** Map a Prisma user row to the camelCase, JSON-safe DTO returned by the API. */
function toUserDTO(u: UserModel) {
  return {
    id: u.id.toString(), // BigInt → string to preserve precision.
    username: u.username,
    firstName: u.first_name,
    lastName: u.last_name,
    createdAt: u.created_at.toISOString(),
  };
}

/**
 * POST /api/users/login — create-on-first-contact upsert. Public (no auth): this is how a
 * user first becomes known to the system. Returns the (possibly newly created) user.
 */
export async function login(req: Request, res: Response): Promise<void> {
  const input = loginSchema.parse(req.body);
  const user = await upsertOnLogin(input);
  res.status(200).json({ data: toUserDTO(user) });
}

/** GET /api/users/me — the currently authenticated user. */
export async function getMe(req: Request, res: Response): Promise<void> {
  // requireAuth guarantees req.user; fetch the full row for a complete profile.
  const user = await getUserById(req.user!.id);
  if (!user) {
    throw AppError.notFound('User not found');
  }
  res.status(200).json({ data: toUserDTO(user) });
}

/** GET /api/users — every authenticated user, newest first. */
export async function list(_req: Request, res: Response): Promise<void> {
  const users = await listUsers();
  res.status(200).json({ data: users.map(toUserDTO) });
}

/** GET /api/users/:id — one user by Telegram id. */
export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = userIdParamSchema.parse(req.params);
  const user = await getUserById(id);
  if (!user) {
    throw AppError.notFound('User not found');
  }
  res.status(200).json({ data: toUserDTO(user) });
}

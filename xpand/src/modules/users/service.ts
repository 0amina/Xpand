import { logger } from '../../config/logger.js';
import { prisma } from '../../db/prisma.js';
import type { LoginInput } from './schema.js';

/** A Telegram profile that has already been proven authentic (initData signature or bot update). */
export interface VerifiedTelegramProfile {
  id: bigint;
  firstName: string;
  lastName?: string | undefined;
  username?: string | undefined;
}

/**
 * Resolve a *verified* Telegram identity to a user row, creating it on first contact.
 *
 * Used by both entry points where Telegram itself vouches for who the caller is: the
 * initData-validating auth middleware, and the bot (whose updates arrive over an authenticated
 * channel). The unverified `x-telegram-id` dev header must NOT use this — it has to go through
 * the explicit `POST /api/users/login` instead, so a spoofed header can't mint rows.
 *
 * A `findUnique` on the hot path with an insert only when missing: an upsert on every call
 * would turn each authenticated request into a write.
 */
export async function findOrCreateFromTelegram(
  profile: VerifiedTelegramProfile,
): Promise<{ id: bigint }> {
  const existing = await prisma.users.findUnique({
    where: { id: profile.id },
    select: { id: true },
  });
  if (existing) return existing;

  const created = await prisma.users.create({
    data: {
      id: profile.id,
      first_name: profile.firstName,
      last_name: profile.lastName ?? null,
      username: profile.username ?? null,
    },
    select: { id: true },
  });

  logger.info({ userId: created.id.toString() }, 'Created user on first verified Telegram contact');
  return created;
}

/** Shape returned by Prisma for a user row (kept in sync with the serializer). */
export type UserRecord = Awaited<ReturnType<typeof getUserById>>;

/** List every user, newest first. */
export function listUsers() {
  return prisma.users.findMany({ orderBy: { created_at: 'desc' } });
}

/** Fetch a single user by Telegram id, or null if absent. */
export function getUserById(id: bigint) {
  return prisma.users.findUnique({ where: { id } });
}

/**
 * Upsert a user on Telegram login: create on first contact, otherwise refresh the mutable
 * profile fields.
 *
 * Only the profile fields are written. Every user has the same, total access, so there is
 * nothing about a login that could grant or revoke anything.
 */
export function upsertOnLogin(input: LoginInput) {
  const { id, username, firstName, lastName } = input;

  return prisma.users.upsert({
    where: { id },
    create: {
      id,
      username: username ?? null,
      first_name: firstName,
      last_name: lastName ?? null,
    },
    update: {
      username: username ?? null,
      first_name: firstName,
      last_name: lastName ?? null,
    },
  });
}

import { Request, Response, NextFunction } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser } from '../db/repository.ts';
import type { UserProfile, UserRole } from '../types/rag.ts';
import { hasRoleAccess } from '../types/rag.ts';

export interface AuthRequest extends Request {
  firebaseUser?: DecodedIdToken;
  appUser?: UserProfile;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Authentication token is missing.' });
    return;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.firebaseUser = decoded;

    const email = decoded.email ?? `${decoded.uid}@users.meridian.local`;
    const displayName = decoded.name ?? email.split('@')[0] ?? 'Workspace Member';
    const user = await getOrCreateUser(decoded.uid, email, displayName);
    req.appUser = user;
    next();
  } catch (error) {
    console.error('Auth verification failed:', error);
    res.status(401).json({ error: 'Session expired or invalid credentials. Please sign in again.' });
  }
};

export const requireRole = (minimumRole: UserRole) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.appUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!hasRoleAccess(req.appUser.role, minimumRole)) {
      res.status(403).json({
        error: `Insufficient permissions. This action requires ${minimumRole} role or higher.`,
      });
      return;
    }
    next();
  };
};

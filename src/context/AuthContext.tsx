import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User as FirebaseUser } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { fetchMe } from '../lib/api.ts';
import type { UserProfile } from '../types/rag.ts';

interface WorkspaceStats {
  collectionCount: number;
  documentCount: number;
  chunkCount: number;
}

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  profile: UserProfile | null;
  stats: WorkspaceStats;
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<WorkspaceStats>({
    collectionCount: 0,
    documentCount: 0,
    chunkCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadBackendProfile = useCallback(async () => {
    try {
      const data = await fetchMe();
      setProfile(data.user);
      setStats(data.stats);
      setAuthError(null);
    } catch (error) {
      console.error('Failed to sync backend profile:', error);
      setAuthError(
        error instanceof Error ? error.message : 'Unable to verify your workspace account.'
      );
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        await loadBackendProfile();
      } else {
        setProfile(null);
        setStats({ collectionCount: 0, documentCount: 0, chunkCount: 0 });
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [loadBackendProfile]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Sign-in was cancelled or blocked.';
      setAuthError(message);
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (auth.currentUser) {
      await loadBackendProfile();
    }
  }, [loadBackendProfile]);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        stats,
        loading,
        authError,
        signInWithGoogle,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}

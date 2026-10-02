import {
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';

import type { ReactNode } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { User } from '../types';

import { supabase } from '../lib/supabase';
import { phoneToAuthEmail } from '../lib/authHelpers';

export type Profile = {
  id: string;
  full_name: string;
  phone: string;
  role: 'member' | 'admin';
  active: boolean;
  created_at: string;
};

type AuthContextType = {
  authUser: SupabaseUser | null;
  profile: Profile | null;
  currentUser: User | null;
  loading: boolean;

  login: (
    phone: string,
    password: string
  ) => Promise<{ error: string | null }>;

  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(
  undefined
);

async function loadProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, full_name, phone, role, active, created_at'
    )
    .eq('id', userId)
    .single();

  if (error) {
    throw error;
  }

  return data as Profile;
}

function profileToUser(profile: Profile): User {
  return {
    id: profile.id,
    name: profile.full_name,
    phone: profile.phone,
    role: profile.role,
    is_active: profile.active,
    created_at: profile.created_at,
    auth_uid: profile.id,
  };
}

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [authUser, setAuthUser] =
    useState<SupabaseUser | null>(null);

  const [profile, setProfile] =
    useState<Profile | null>(null);

  const [currentUser, setCurrentUser] =
    useState<User | null>(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function applyUser(
      user: SupabaseUser | null
    ) {
      if (!mounted) return;

      if (!user) {
        setAuthUser(null);
        setProfile(null);
        setCurrentUser(null);
        setLoading(false);
        return;
      }

      try {
        const userProfile = await loadProfile(user.id);

        if (!mounted) return;

        if (!userProfile.active) {
          await supabase.auth.signOut();

          if (!mounted) return;

          setAuthUser(null);
          setProfile(null);
          setCurrentUser(null);
          setLoading(false);
          return;
        }

        setAuthUser(user);
        setProfile(userProfile);
        setCurrentUser(profileToUser(userProfile));
      } catch (error) {
        console.error('Failed to load profile:', error);

        if (!mounted) return;

        setAuthUser(null);
        setProfile(null);
        setCurrentUser(null);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    async function loadInitialUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      await applyUser(user);
    }

    loadInitialUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        void applyUser(session?.user ?? null);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function login(
    phone: string,
    password: string
  ): Promise<{ error: string | null }> {
    const email = phoneToAuthEmail(phone);

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (error || !data.user) {
      return {
        error: 'رقم الهاتف أو كلمة المرور غير صحيحة',
      };
    }

    try {
      const userProfile = await loadProfile(
        data.user.id
      );

      if (!userProfile.active) {
        await supabase.auth.signOut();

        return {
          error: 'هذا الحساب غير نشط',
        };
      }

      setAuthUser(data.user);
      setProfile(userProfile);
      setCurrentUser(
        profileToUser(userProfile)
      );

      return {
        error: null,
      };
    } catch (error) {
      console.error(
        'Failed to load profile after login:',
        error
      );

      await supabase.auth.signOut();

      return {
        error: 'تعذر تحميل بيانات الحساب',
      };
    }
  }

  async function logout() {
    await supabase.auth.signOut();

    setAuthUser(null);
    setProfile(null);
    setCurrentUser(null);
  }

  return (
    <AuthContext.Provider
      value={{
        authUser,
        profile,
        currentUser,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      'useAuth must be used inside AuthProvider'
    );
  }

  return context;
}
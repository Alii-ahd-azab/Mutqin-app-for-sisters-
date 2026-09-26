import {
  User,
  GroupSettings,
  RestDay,
  RecitationLog,
  RevisionLog,
  CycleInfo,
  MemberDailyStatus,
} from '../types';
import { formatDate } from '../lib/calculations';

const TOKEN_KEY = 'motqin_auth_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // ignore
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Pass user device local date to ensure server calendar calculations match user timezone
  try {
    const localDate = formatDate(new Date());
    if (localDate) {
      headers['X-Client-Date'] = localDate;
    }
  } catch {
    // ignore
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = data?.error || data?.message || `خطأ في الاتصال (${response.status})`;
    throw new Error(errorMsg);
  }

  return data as T;
}

export const api = {
  // Auth
  async login(phone: string, password: string): Promise<{ user: User; token: string }> {
    const res = await request<{ user: User; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
    });
    setStoredToken(res.token);
    return res;
  },

  async logout(): Promise<void> {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      setStoredToken(null);
    }
  },

  async getMe(): Promise<{ user: User }> {
    return request<{ user: User }>('/api/auth/me');
  },

  async changePassword(payload: {
    currentPassword: string;
    newPassword: string;
    confirmPassword?: string;
  }): Promise<{ message: string }> {
    return request<{ message: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Bootstrap
  async getBootstrap(params?: { client_date?: string }): Promise<{
    cycleInfo: CycleInfo;
    settings: GroupSettings;
    restDays: RestDay[];
    users: User[];
    todayRecitations: RecitationLog[];
    todayRevisions: RevisionLog[];
  }> {
    const today = params?.client_date || formatDate(new Date());
    return request(`/api/bootstrap?client_date=${today}`);
  },

  // Recitations
  async getRecitations(params?: {
    member_id?: string;
    reciter_id?: string;
    date?: string;
  }): Promise<{ recitations: RecitationLog[] }> {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request(`/api/recitations${query ? `?${query}` : ''}`);
  },

  async recordRecitation(payload: {
    quarter_number: number;
    listener_id: string;
    notes?: string;
    date?: string;
  }): Promise<{ recitation: RecitationLog; message: string }> {
    return request('/api/recitations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Revisions
  async getRevisions(params?: {
    member_id?: string;
    date?: string;
  }): Promise<{ revisions: RevisionLog[] }> {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request(`/api/revisions${query ? `?${query}` : ''}`);
  },

  async recordRevision(payload: {
    notes?: string;
    date?: string;
  }): Promise<{ revision: RevisionLog; message: string }> {
    return request('/api/revisions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Admin APIs
  async adminAddMember(payload: {
    name: string;
    phone: string;
    password: string;
    role: 'member' | 'admin';
  }): Promise<{ user: User; message: string }> {
    return request('/api/admin/members', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async adminUpdateMember(
    id: string,
    payload: {
      name?: string;
      phone?: string;
      password?: string;
      role?: 'member' | 'admin';
      is_active?: boolean;
    }
  ): Promise<{ user: User; message: string }> {
    return request(`/api/admin/members/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async adminDeleteMemberCompletely(id: string): Promise<{ success: boolean; message: string }> {
    return request(`/api/admin/members/${id}/completely`, {
      method: 'DELETE',
    });
  },

  async adminAddRestDay(payload: {
    date: string;
    note: string;
  }): Promise<{ restDay: RestDay; message: string }> {
    return request('/api/admin/rest-days', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async adminDeleteRestDay(id: string): Promise<{ success: boolean; message: string }> {
    return request(`/api/admin/rest-days/${id}`, {
      method: 'DELETE',
    });
  },

  async adminPause(): Promise<{
    settings: GroupSettings;
    cycleInfo: CycleInfo;
    message: string;
  }> {
    return request('/api/admin/pause', {
      method: 'POST',
    });
  },

  async adminResume(): Promise<{
    settings: GroupSettings;
    cycleInfo: CycleInfo;
    message: string;
  }> {
    return request('/api/admin/resume', {
      method: 'POST',
    });
  },

  async adminUpdateSettings(payload: {
    start_date?: string;
  }): Promise<{ settings: GroupSettings; message: string }> {
    return request('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async adminUpdateDailyThought(payload: {
    daily_thought: string;
  }): Promise<{ settings: GroupSettings; message: string }> {
    return request('/api/admin/daily-thought', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async adminDeleteDailyThought(): Promise<{ settings: GroupSettings; message: string }> {
    return request('/api/admin/daily-thought', {
      method: 'DELETE',
    });
  },

  async adminFactoryReset(): Promise<{
    success: boolean;
    message: string;
    cycleInfo: CycleInfo;
    settings: GroupSettings;
  }> {
    return request('/api/admin/factory-reset', {
      method: 'POST',
    });
  },

  async adminGetStats(): Promise<{
    total_members: number;
    completed_recitation_count: number;
    completed_revision_count: number;
    pending_recitation_today: any[];
    pending_revision_today: any[];
    member_stats: any[];
  }> {
    return request('/api/admin/stats');
  },

  async getFirestoreStatus(): Promise<{
    projectId: string;
    databaseId: string;
    connected: boolean;
    error: string | null;
  }> {
    return request('/api/firestore/status');
  },
};

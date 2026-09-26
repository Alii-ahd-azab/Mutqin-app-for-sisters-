import React, { useEffect, useState, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Header } from './components/Header';
import { MemberDashboard } from './components/MemberDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { LoginView } from './components/LoginView';
import { api } from './api/client';
import {
  CycleInfo,
  GroupSettings,
  RestDay,
  User,
  RecitationLog,
  RevisionLog,
} from './types';
import { BookOpen, RefreshCw } from 'lucide-react';

const MainApp: React.FC = () => {
  const { currentUser, loading: authLoading } = useAuth();

  const [cycleInfo, setCycleInfo] = useState<CycleInfo | null>(null);
  const [settings, setSettings] = useState<GroupSettings | null>(null);
  const [restDays, setRestDays] = useState<RestDay[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [recitations, setRecitations] = useState<RecitationLog[]>([]);
  const [revisions, setRevisions] = useState<RevisionLog[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const loadAppData = useCallback(async () => {
    if (!currentUser) return;
    setDataLoading(true);
    setInitError(null);
    try {
      const [bootstrapRes, recitationsRes, revisionsRes] = await Promise.all([
        api.getBootstrap(),
        api.getRecitations(),
        api.getRevisions(),
      ]);

      setCycleInfo(bootstrapRes.cycleInfo);
      setSettings(bootstrapRes.settings);
      setRestDays(bootstrapRes.restDays);
      setAllUsers(bootstrapRes.users);
      setRecitations(recitationsRes.recitations);
      setRevisions(revisionsRes.revisions);
    } catch (err: any) {
      console.error('Error fetching app data:', err);
      setInitError(err?.message || 'تعذر جلب بيانات المقرأة');
    } finally {
      setDataLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      loadAppData();
    }
  }, [currentUser, loadAppData]);

  // Handlers for Member actions
  const handleRecordRecitation = async (payload: {
    quarter_number: number;
    listener_id: string;
    notes?: string;
  }) => {
    await api.recordRecitation(payload);
    await loadAppData();
  };

  const handleRecordRevision = async (payload: { notes?: string; date?: string }) => {
    await api.recordRevision(payload);
    await loadAppData();
  };

  // Handlers for Admin actions
  const handleAddMember = async (payload: {
    name: string;
    phone: string;
    password: string;
    role: 'member' | 'admin';
  }) => {
    await api.adminAddMember(payload);
    await loadAppData();
  };

  const handleUpdateMember = async (
    id: string,
    payload: { role?: 'member' | 'admin'; is_active?: boolean; password?: string; name?: string; phone?: string }
  ) => {
    await api.adminUpdateMember(id, payload);
    await loadAppData();
  };

  const handleAddRestDay = async (payload: { date: string; note: string }) => {
    await api.adminAddRestDay(payload);
    await loadAppData();
  };

  const handleDeleteRestDay = async (id: string) => {
    await api.adminDeleteRestDay(id);
    await loadAppData();
  };

  const handlePause = async () => {
    await api.adminPause();
    await loadAppData();
  };

  const handleResume = async () => {
    await api.adminResume();
    await loadAppData();
  };

  const handleUpdateSettings = async (payload: {
    start_date?: string;
  }) => {
    const res = await api.adminUpdateSettings(payload);
    setSettings(res.settings);
    await loadAppData();
  };

  const handleUpdateDailyThought = async (payload: { daily_thought: string }) => {
    const res = await api.adminUpdateDailyThought(payload);
    setSettings(res.settings);
    await loadAppData();
  };

  const handleDeleteDailyThought = async () => {
    const res = await api.adminDeleteDailyThought();
    setSettings(res.settings);
    await loadAppData();
  };

  const handleFactoryReset = async () => {
    const res = await api.adminFactoryReset();
    setCycleInfo(res.cycleInfo);
    setSettings(res.settings);
    await loadAppData();
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-pink-50/70 via-rose-50/30 to-stone-100 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-500 to-rose-400 text-white mx-auto flex items-center justify-center shadow-md animate-pulse">
            <BookOpen className="w-7 h-7 text-pink-100" />
          </div>
          <p className="text-xs font-bold text-pink-900">جاري الدخول لمقرأة مُتْقِن للنساء...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginView />;
  }

  return (
    <div className="min-h-screen bg-stone-50/90 text-stone-900 selection:bg-pink-200">
      <Header
        cycleInfo={cycleInfo}
        allUsers={allUsers}
        onRefresh={loadAppData}
      />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
        {initError && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between">
            <span>{initError}</span>
            <button
              onClick={loadAppData}
              className="px-3 py-1 bg-rose-600 text-white rounded-lg font-bold"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {cycleInfo && settings ? (
          currentUser.role === 'admin' ? (
            <AdminDashboard
              currentUser={currentUser}
              cycleInfo={cycleInfo}
              settings={settings}
              users={allUsers}
              restDays={restDays}
              recitations={recitations}
              revisions={revisions}
              onAddMember={handleAddMember}
              onUpdateMember={handleUpdateMember}
              onAddRestDay={handleAddRestDay}
              onDeleteRestDay={handleDeleteRestDay}
              onPause={handlePause}
              onResume={handleResume}
              onUpdateSettings={handleUpdateSettings}
              onUpdateDailyThought={handleUpdateDailyThought}
              onDeleteDailyThought={handleDeleteDailyThought}
              onFactoryReset={handleFactoryReset}
              onRefresh={loadAppData}
              loading={dataLoading}
            />
          ) : (
            <MemberDashboard
              currentUser={currentUser}
              cycleInfo={cycleInfo}
              settings={settings}
              restDays={restDays}
              allMembers={allUsers}
              recitations={recitations}
              revisions={revisions}
              onRecordRecitation={handleRecordRecitation}
              onRecordRevision={handleRecordRevision}
              onRefresh={loadAppData}
              loading={dataLoading}
            />
          )
        ) : (
          <div className="py-24 text-center space-y-3">
            <RefreshCw className="w-6 h-6 text-pink-600 animate-spin mx-auto" />
            <p className="text-xs text-stone-500">جاري تحميل بيانات الدورة...</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}

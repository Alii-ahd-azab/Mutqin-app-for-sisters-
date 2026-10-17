import React, { useEffect, useState, useCallback, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Header } from './components/Header';
import { MemberDashboard } from './components/MemberDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { LoginView } from './components/LoginView';
import { BatchSelector } from './components/BatchSelector';
import { api } from './api/client';
import {
  AdminAccountUpdate,
  Batch,
  CycleInfo,
  GroupSettings,
  NewAccountPayload,
  PeerTest,
  PeerTestAttempt,
  RestDay,
  User,
  RecitationLog,
  RevisionLog,
} from './types';
import { BookOpen, RefreshCw, Layers } from 'lucide-react';

// Remembered admin batch choice. This is only a UI hint: access is always
// re-validated against the batches the server returns for this user.
const selectedBatchStorageKey = (userId: string) => `mutqin.selectedBatch.${userId}`;

function readStoredBatchId(userId: string): string | null {
  try {
    return window.localStorage.getItem(selectedBatchStorageKey(userId));
  } catch {
    return null;
  }
}

function storeBatchId(userId: string, batchId: string) {
  try {
    window.localStorage.setItem(selectedBatchStorageKey(userId), batchId);
  } catch {
    // storage unavailable; selection just won't be remembered
  }
}

const MainApp: React.FC = () => {
  const { currentUser, loading: authLoading } = useAuth();
  // Depend on identity, not the object: token refreshes recreate currentUser.
  const currentUserId = currentUser?.id ?? null;
  const currentUserRole = currentUser?.role ?? null;

  const [accessibleBatches, setAccessibleBatches] = useState<Batch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [batchesLoaded, setBatchesLoaded] = useState(false);

  const [cycleId, setCycleId] = useState<string | null>(null);
  const [cycleInfo, setCycleInfo] = useState<CycleInfo | null>(null);
  const [settings, setSettings] = useState<GroupSettings | null>(null);
  const [restDays, setRestDays] = useState<RestDay[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [recitations, setRecitations] = useState<RecitationLog[]>([]);
  const [revisions, setRevisions] = useState<RevisionLog[]>([]);
  const [peerTests, setPeerTests] = useState<PeerTest[]>([]);
  const [peerTestAttempts, setPeerTestAttempts] = useState<PeerTestAttempt[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Ignores responses that arrive after the admin already switched batch.
  const loadRequestRef = useRef(0);

  const clearBatchData = useCallback(() => {
    setCycleId(null);
    setCycleInfo(null);
    setSettings(null);
    setRestDays([]);
    setAllUsers([]);
    setRecitations([]);
    setRevisions([]);
    setPeerTests([]);
    setPeerTestAttempts([]);
  }, []);

  // Resolve which batches this account can open (the server/RLS decides).
  const loadBatches = useCallback(
    async (preferredBatchId?: string) => {
      if (!currentUserId) return;
      try {
        const { batches } = await api.getAccessibleBatches();
        setAccessibleBatches(batches);

        const candidates = [
          preferredBatchId,
          currentUserRole === 'admin' ? readStoredBatchId(currentUserId) : null,
        ];
        const nextId =
          candidates.find((id) => id && batches.some((b) => b.id === id)) ||
          batches[0]?.id ||
          null;

        setSelectedBatchId(nextId);
        setInitError(null);
      } catch (err: any) {
        console.error('Error fetching batches:', err);
        setInitError(err?.message || 'تعذر جلب الدفعات');
      } finally {
        setBatchesLoaded(true);
      }
    },
    [currentUserId, currentUserRole]
  );

  useEffect(() => {
    setAccessibleBatches([]);
    setSelectedBatchId(null);
    setBatchesLoaded(false);
    clearBatchData();
    if (currentUserId) {
      loadBatches();
    }
  }, [currentUserId, loadBatches, clearBatchData]);

  const loadAppData = useCallback(async () => {
    if (!currentUserId || !selectedBatchId) return;
    const requestId = ++loadRequestRef.current;
    setDataLoading(true);
    setInitError(null);
    try {
      const bootstrapRes = await api.getBootstrap({ batch_id: selectedBatchId });
      if (requestId !== loadRequestRef.current) return;

      setCycleId(bootstrapRes.cycle_id);
      setCycleInfo(bootstrapRes.cycleInfo);
      setSettings(bootstrapRes.settings);
      setRestDays(bootstrapRes.restDays);
      setAllUsers(bootstrapRes.users);
      setRecitations(bootstrapRes.recitations);
      setRevisions(bootstrapRes.revisions);
      setPeerTests(bootstrapRes.peerTests);
      setPeerTestAttempts(bootstrapRes.peerTestAttempts);
    } catch (err: any) {
      if (requestId !== loadRequestRef.current) return;
      console.error('Error fetching app data:', err);
      setInitError(err?.message || 'تعذر جلب بيانات المقرأة');
    } finally {
      if (requestId === loadRequestRef.current) {
        setDataLoading(false);
      }
    }
  }, [currentUserId, selectedBatchId]);

  useEffect(() => {
    if (currentUserId && selectedBatchId) {
      loadAppData();
    }
  }, [currentUserId, selectedBatchId, loadAppData]);

  const handleSelectBatch = (batchId: string) => {
    if (!currentUser || batchId === selectedBatchId) return;
    if (!accessibleBatches.some((b) => b.id === batchId)) return;
    storeBatchId(currentUser.id, batchId);
    clearBatchData();
    setSelectedBatchId(batchId);
  };

  const handleBatchCreated = async (batch: Batch) => {
    if (currentUser) storeBatchId(currentUser.id, batch.id);
    clearBatchData();
    await loadBatches(batch.id);
  };

  const requireSelectedBatch = (): string => {
    if (!selectedBatchId) throw new Error('يرجى اختيار الدفعة أولاً');
    return selectedBatchId;
  };

  // Handlers for Member actions
  const handleRecordRecitation = async (payload: {
    quarter_number: number;
    listener_id: string;
    notes?: string;
  }) => {
    await api.recordRecitation(requireSelectedBatch(), payload);
    await loadAppData();
  };

  const handleRecordRevision = async (payload: { notes?: string; date?: string }) => {
    await api.recordRevision(requireSelectedBatch(), payload);
    await loadAppData();
  };

  // Handlers for Admin actions
  const handleAddMember = async (payload: NewAccountPayload) => {
    await api.adminAddMember(payload);
    await loadAppData();
  };

  const handleUpdateMember = async (id: string, payload: AdminAccountUpdate) => {
    await api.adminUpdateMember(id, payload);
    await loadAppData();
  };

  const handleMoveMember = async (id: string, destinationBatchId: string) => {
    const res = await api.adminMoveMemberBatch(id, destinationBatchId);
    await loadAppData();
    return res.message;
  };

  const handleAddRestDay = async (payload: { date: string; note: string }) => {
    await api.adminAddRestDay(requireSelectedBatch(), payload);
    await loadAppData();
  };

  const handleDeleteRestDay = async (id: string) => {
    await api.adminDeleteRestDay(id);
    await loadAppData();
  };

  const handlePause = async () => {
    await api.adminPause(requireSelectedBatch());
    await loadAppData();
  };

  const handleResume = async () => {
    await api.adminResume(requireSelectedBatch());
    await loadAppData();
  };

  const handleUpdateSettings = async (payload: { start_date?: string }) => {
    await api.adminUpdateSettings(requireSelectedBatch(), payload);
    await loadAppData();
  };

  const handleUpdateDailyThought = async (payload: { daily_thought: string }) => {
    await api.adminUpdateDailyThought(requireSelectedBatch(), payload);
    await loadAppData();
  };

  const handleDeleteDailyThought = async () => {
    await api.adminDeleteDailyThought(requireSelectedBatch());
    await loadAppData();
  };

  const handleFactoryReset = async () => {
    await api.adminFactoryReset(requireSelectedBatch(), cycleId || undefined);
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

  const isAdmin = currentUser.role === 'admin';
  const isMasterAdmin = isAdmin && !!currentUser.is_master_admin;
  const selectedBatch = accessibleBatches.find((b) => b.id === selectedBatchId) || null;
  const noBatchAccess = batchesLoaded && !initError && accessibleBatches.length === 0;

  return (
    <div className="min-h-screen bg-stone-50/90 text-stone-900 selection:bg-pink-200">
      <Header
        cycleInfo={cycleInfo}
        allUsers={allUsers}
        batchName={selectedBatch?.name}
        onRefresh={loadAppData}
      />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
        {isAdmin && (isMasterAdmin || accessibleBatches.length > 0) && (
          <BatchSelector
            batches={accessibleBatches}
            selectedBatchId={selectedBatchId}
            onSelect={handleSelectBatch}
            canCreate={isMasterAdmin}
            onBatchCreated={handleBatchCreated}
          />
        )}

        {initError && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between gap-3">
            <span>{initError}</span>
            <button
              onClick={() => (selectedBatchId ? loadAppData() : loadBatches())}
              className="px-3 py-1 bg-rose-600 text-white rounded-lg font-bold shrink-0"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {noBatchAccess ? (
          <div className="py-20 text-center space-y-3 max-w-md mx-auto">
            <div className="w-12 h-12 rounded-2xl bg-pink-50 text-pink-600 border border-pink-100 flex items-center justify-center mx-auto">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-stone-800 text-sm">
              {isAdmin ? 'لا توجد دفعات متاحة لكِ بعد' : 'حسابكِ غير مرتبط بأي دفعة'}
            </h3>
            <p className="text-xs text-stone-500 leading-relaxed">
              {isMasterAdmin
                ? 'ابدئي بإنشاء أول دفعة من زر «إنشاء دفعة جديدة» بالأعلى.'
                : isAdmin
                ? 'لم يتم تعيينكِ على أي دفعة بعد. تواصلي مع المشرفة العامة.'
                : 'تواصلي مع مشرفة المقرأة لإضافتكِ إلى دفعتكِ.'}
            </p>
          </div>
        ) : cycleInfo && settings && selectedBatch ? (
          isAdmin ? (
            <AdminDashboard
              currentUser={currentUser}
              batch={selectedBatch}
              accessibleBatches={accessibleBatches}
              cycleInfo={cycleInfo}
              settings={settings}
              users={allUsers}
              restDays={restDays}
              recitations={recitations}
              revisions={revisions}
              onAddMember={handleAddMember}
              onUpdateMember={handleUpdateMember}
              onMoveMember={handleMoveMember}
              onAccountsChanged={loadAppData}
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
              batchName={selectedBatch.name}
              cycleInfo={cycleInfo}
              settings={settings}
              restDays={restDays}
              allMembers={allUsers}
              recitations={recitations}
              revisions={revisions}
              peerTests={peerTests}
              peerTestAttempts={peerTestAttempts}
              onRecordRecitation={handleRecordRecitation}
              onRecordRevision={handleRecordRevision}
              onRefresh={loadAppData}
              loading={dataLoading}
            />
          )
        ) : !initError ? (
          <div className="py-24 text-center space-y-3">
            <RefreshCw className="w-6 h-6 text-pink-600 animate-spin mx-auto" />
            <p className="text-xs text-stone-500">جاري تحميل بيانات الدورة...</p>
          </div>
        ) : null}
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

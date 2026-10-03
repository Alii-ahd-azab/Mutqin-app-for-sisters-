import React, { useState, useMemo, useEffect } from 'react';
import { User, GroupSettings, RestDay, RecitationLog, RevisionLog, CycleInfo } from '../types';
import { getQuarterInfo } from '../data/quranData';
import {
  calculateMemberRequiredQuarter,
  getCurrentWeekRange,
  getHijriDate,
  getActiveCycleDates,
  calculateMemberRevisionStatus,
  formatArabicDateWithDayName,
  getPreLaunchMessage,
  calculateListenersLeaderboard,
} from '../lib/calculations';
import { api } from '../api/client';
import {
  Users,
  CheckCircle2,
  Clock,
  Settings,
  BarChart3,
  Calendar,
  CalendarRange,
  RotateCcw,
  Shield,
  UserCheck,
  UserX,
  UserMinus,
  Phone,
  BookOpen,
  BookmarkCheck,
  Search,
  AlertCircle,
  AlertOctagon,
  PauseCircle,
  PlayCircle,
  Key,
  Trash2,
  Plus,
  RefreshCw,
  Award,
  Headphones,
} from 'lucide-react';
import { AdminMemberModal } from './AdminMemberModal';
import { CelebrationBanner, RestDayBanner, PauseBanner } from './Banners';
import { DailyThoughtEditor } from './DailyThoughtEditor';

interface AdminDashboardProps {
  currentUser: User;
  cycleInfo: CycleInfo;
  settings: GroupSettings;
  users: User[];
  restDays: RestDay[];
  recitations: RecitationLog[];
  revisions: RevisionLog[];
  onAddMember: (payload: {
    name: string;
    phone: string;
    password: string;
    role: 'member' | 'admin';
  }) => Promise<void>;
  onUpdateMember: (
    id: string,
    payload: { role?: 'member' | 'admin'; is_active?: boolean; password?: string; name?: string; phone?: string }
  ) => Promise<void>;
  onAddRestDay: (payload: { date: string; note: string }) => Promise<void>;
  onDeleteRestDay: (id: string) => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onUpdateSettings: (payload: {
    start_date?: string;
  }) => Promise<void>;
  onUpdateDailyThought: (payload: { daily_thought: string }) => Promise<void>;
  onDeleteDailyThought: () => Promise<void>;
  onFactoryReset: () => Promise<void>;
  onRefresh: () => void;
  loading: boolean;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  cycleInfo,
  settings,
  users,
  restDays,
  recitations,
  revisions,
  onAddMember,
  onUpdateMember,
  onAddRestDay,
  onDeleteRestDay,
  onPause,
  onResume,
  onUpdateSettings,
  onUpdateDailyThought,
  onDeleteDailyThought,
  onFactoryReset,
  onRefresh,
  loading,
}) => {
  const [activeTab, setActiveTab] = useState<'today' | 'members' | 'stats' | 'settings'>('today');
  const [membersSubTab, setMembersSubTab] = useState<'active' | 'excluded'>('active');
  const [memberToDeleteCompletely, setMemberToDeleteCompletely] = useState<User | null>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [isDeletingMember, setIsDeletingMember] = useState(false);
  const [actionFeedbackMsg, setActionFeedbackMsg] = useState('');

  // Confirmation Modals State
  const [memberToExclude, setMemberToExclude] = useState<User | null>(null);
  const [isExcluding, setIsExcluding] = useState(false);

  const [memberToReactivate, setMemberToReactivate] = useState<User | null>(null);
  const [isReactivating, setIsReactivating] = useState(false);

  const [showPauseModal, setShowPauseModal] = useState(false);
  const [isPausing, setIsPausing] = useState(false);

  const [showResumeModal, setShowResumeModal] = useState(false);
  const [isResuming, setIsResuming] = useState(false);

  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmationText, setResetConfirmationText] = useState('');

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [todayFilter, setTodayFilter] = useState<'all' | 'unrecited' | 'unreviewed' | 'behind' | 'severely_behind'>('all');

  // Stats Sub-tab
  const [statsPeriodTab, setStatsPeriodTab] = useState<'current_week' | 'all_time'>('current_week');

  // Rest Day Form
  const [newRestDate, setNewRestDate] = useState('');
  const [newRestNote, setNewRestNote] = useState('');
  const [restDayError, setRestDayError] = useState('');

  // Settings: Start Date
  const [startDateInput, setStartDateInput] = useState(settings.start_date || '');
  const [settingsMsg, setSettingsMsg] = useState('');

  // Password reset inline state
  const [editingPasswordUserId, setEditingPasswordUserId] = useState<string | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');

  // Active program cycle calendar dates (excluding rest days and pauses)
  const activeCycleDates = useMemo(() => {
    return getActiveCycleDates(
      settings.start_date || cycleInfo.start_date,
      cycleInfo.today_date,
      restDays,
      settings
    );
  }, [settings.start_date, cycleInfo.start_date, cycleInfo.today_date, restDays, settings]);

  // Members filtering:
  // 1) Active members only (for daily recitation/revision obligations, leaderboard, and today's status)
  const activeMemberUsers = useMemo(
    () => users.filter((u) => u.role === 'member' && u.is_active),
    [users]
  );
  // 2) Excluded / Suspended members
  const excludedMemberUsers = useMemo(
    () => users.filter((u) => u.role === 'member' && !u.is_active),
    [users]
  );
  // 3) Active accounts (admins + active members)
  const activeUsers = useMemo(
    () => users.filter((u) => u.role === 'admin' || u.is_active),
    [users]
  );

  // Status for each active member today
  const membersTodayStatus = useMemo(() => {
    return activeMemberUsers.map((m) => {
      const todayRecs = recitations.filter(
        (r) => (r.member_id === m.id || r.reciter_id === m.id) && r.date === cycleInfo.today_date
      );

      const todayRev = revisions.find(
        (r) => r.member_id === m.id && r.date === cycleInfo.today_date
      );

      const quarterStatus = calculateMemberRequiredQuarter(
        m.id,
        cycleInfo.quarter_of_day,
        recitations
      );

      const revStatus = calculateMemberRevisionStatus(
        m.id,
        activeCycleDates,
        revisions,
        cycleInfo.today_date
      );

      const missedQuartersCount = quarterStatus.pastMissedQuartersCount;
      const missedRevisionDaysCount = revStatus.pastMissedRevisionDaysCount;
      const isSeverelyBehindRecitation = missedQuartersCount >= 3;
      const isSeverelyBehindRevision = missedRevisionDaysCount >= 3;
      const isSeverelyBehind = isSeverelyBehindRecitation || isSeverelyBehindRevision;
      const severeReasons: ('recitation' | 'revision')[] = [];
      if (isSeverelyBehindRecitation) severeReasons.push('recitation');
      if (isSeverelyBehindRevision) severeReasons.push('revision');

      const totalRecitations = recitations.filter(
        (r) => r.member_id === m.id || r.reciter_id === m.id
      ).length;
      const totalRevisions = revisions.filter((r) => r.member_id === m.id).length;
      const totalTimesListened = recitations.filter(
        (r) => r.listener_id === m.id && (r.member_id || r.reciter_id) !== m.id
      ).length;

      return {
        user: m,
        hasRecited: todayRecs.length > 0,
        todayRecsCount: todayRecs.length,
        todayRecs,
        recitedQuarter: todayRecs.length > 0 ? todayRecs[todayRecs.length - 1].quarter_number : undefined,
        listenerName: Array.from(new Set(todayRecs.map((r) => r.listener_name).filter(Boolean))).join('، '),
        recitationNotes: todayRecs.map((r) => r.notes).filter(Boolean).join(' | '),
        hasReviewed: !!todayRev,
        revisionNotes: todayRev?.notes,
        requiredQuarter: quarterStatus.requiredQuarter,
        isBehind: quarterStatus.isBehind,
        isAllCaughtUp: quarterStatus.allCompletedUpToToday,
        missedQuartersCount,
        missedQuarters: quarterStatus.pastMissedQuarters,
        missedRevisionDaysCount,
        isSeverelyBehindRecitation,
        isSeverelyBehindRevision,
        isSeverelyBehind,
        severeReasons,
        totalRecitations,
        totalRevisions,
        totalTimesListened,
      };
    });
  }, [activeMemberUsers, recitations, revisions, cycleInfo.today_date, cycleInfo.quarter_of_day, activeCycleDates]);

  // Aggregate metrics (active members only)
  const totalMembersCount = activeMemberUsers.length;
  const recitedTodayCount = membersTodayStatus.filter((s) => s.hasRecited).length;
  const reviewedTodayCount = membersTodayStatus.filter((s) => s.hasReviewed).length;
  const behindMembersCount = membersTodayStatus.filter((s) => s.isBehind).length;
  const severelyBehindMembersCount = membersTodayStatus.filter((s) => s.isSeverelyBehind).length;

  // Filtered members for today view
  const filteredTodayMembers = useMemo(() => {
    return membersTodayStatus.filter((s) => {
      const matchSearch =
        s.user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.user.phone.includes(searchQuery);

      if (!matchSearch) return false;

      if (todayFilter === 'unrecited') return !s.hasRecited;
      if (todayFilter === 'unreviewed') return !s.hasReviewed;
      if (todayFilter === 'behind') return s.isBehind;
      if (todayFilter === 'severely_behind') return s.isSeverelyBehind;
      return true;
    });
  }, [membersTodayStatus, searchQuery, todayFilter]);

  // Weekly Stats calculation (active members only)
  const currentWeek = useMemo(() => {
    return getCurrentWeekRange(cycleInfo.today_date, settings.start_date, restDays);
  }, [cycleInfo.today_date, settings.start_date, restDays]);

  const membersWeeklyStatus = useMemo(() => {
    const activeDaysCount = currentWeek.activeRecitationDaysThisWeek.length;

    return activeMemberUsers.map((m) => {
      const weeklyRecitations = recitations.filter(
        (r) =>
          (r.member_id === m.id || r.reciter_id === m.id) &&
          r.date >= currentWeek.startDate &&
          r.date <= currentWeek.endDate
      );

      const weeklyRevisions = revisions.filter(
        (r) =>
          r.member_id === m.id &&
          r.date >= currentWeek.startDate &&
          r.date <= currentWeek.endDate
      );

      const weeklyTimesListened = recitations.filter(
        (r) =>
          r.listener_id === m.id &&
          (r.member_id || r.reciter_id) !== m.id &&
          r.date >= currentWeek.startDate &&
          r.date <= currentWeek.endDate
      ).length;

      const quarterStatus = calculateMemberRequiredQuarter(
        m.id,
        cycleInfo.quarter_of_day,
        recitations
      );

      const commitmentRate =
        activeDaysCount > 0
          ? Math.min(100, Math.round((weeklyRecitations.length / activeDaysCount) * 100))
          : 100;

      const todayStatus = membersTodayStatus.find((t) => t.user.id === m.id);

      return {
        user: m,
        requiredQuarter: quarterStatus.requiredQuarter,
        isBehind: quarterStatus.isBehind,
        missedQuartersCount: quarterStatus.pastMissedQuartersCount,
        missedRevisionDaysCount: todayStatus?.missedRevisionDaysCount ?? 0,
        isSeverelyBehindRecitation: todayStatus?.isSeverelyBehindRecitation ?? false,
        isSeverelyBehindRevision: todayStatus?.isSeverelyBehindRevision ?? false,
        isSeverelyBehind: todayStatus?.isSeverelyBehind ?? false,
        severeReasons: todayStatus?.severeReasons ?? [],
        weeklyRecitationsCount: weeklyRecitations.length,
        weeklyRevisionsCount: weeklyRevisions.length,
        weeklyTimesListened,
        commitmentRate,
        hasRecitedToday: todayStatus?.hasRecited ?? false,
        hasReviewedToday: todayStatus?.hasReviewed ?? false,
      };
    });
  }, [activeMemberUsers, recitations, revisions, currentWeek, cycleInfo.quarter_of_day, membersTodayStatus]);

  // Leaderboard of members chosen as listening peers for the current week (active members only)
  const listenersWeeklyLeaderboard = useMemo(() => {
    return calculateListenersLeaderboard(
      activeMemberUsers,
      recitations,
      currentWeek.startDate,
      currentWeek.endDate
    );
  }, [activeMemberUsers, recitations, currentWeek.startDate, currentWeek.endDate]);

  // Leaderboard of members chosen as listening peers since the start of the course (all-time, active members only)
  const listenersAllTimeLeaderboard = useMemo(() => {
    return calculateListenersLeaderboard(activeMemberUsers, recitations);
  }, [activeMemberUsers, recitations]);

  // Add rest day handler
  const handleAddRestDaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRestDayError('');
    if (!newRestDate) {
      setRestDayError('يرجى تحديد التاريخ');
      return;
    }
    try {
      await onAddRestDay({ date: newRestDate, note: newRestNote });
      setNewRestDate('');
      setNewRestNote('');
    } catch (err: any) {
      setRestDayError(err?.message || 'فشلت إضافة يوم الاستدراك');
    }
  };

  // Update start date handler
  const handleSaveStartDate = async () => {
    setSettingsMsg('');
    try {
      await onUpdateSettings({ start_date: startDateInput });
      setSettingsMsg('تم حفظ تاريخ بداية الدورة بنجاح');
      setTimeout(() => setSettingsMsg(''), 4000);
    } catch (err: any) {
      setSettingsMsg('فشل حفظ تاريخ البداية');
    }
  };

  // Toggle member active status
  const handleToggleActive = async (user: User) => {
    await onUpdateMember(user.id, { is_active: !user.is_active });
  };

  // Exclude member from group (sets is_active to false)
  const handleExcludeMember = async (user: User) => {
    if (user.role === 'admin') return;
    try {
      await onUpdateMember(user.id, { is_active: false });
      setActionFeedbackMsg(`تم إقصاء العضو "${user.name}" ونقله إلى قائمة الأعضاء المُقصَين.`);
      setTimeout(() => setActionFeedbackMsg(''), 4000);
    } catch (err: any) {
      alert(err?.message || 'فشل إقصاء العضو');
    }
  };

  // Reactivate excluded member (sets is_active to true)
  const handleReactivateMember = async (user: User) => {
    try {
      await onUpdateMember(user.id, { is_active: true });
      setActionFeedbackMsg(`تمت إعادة تفعيل العضو "${user.name}" بنجاح وعاد لقائمة الأعضاء النشطين.`);
      setTimeout(() => setActionFeedbackMsg(''), 4000);
    } catch (err: any) {
      alert(err?.message || 'فشلت إعادة تفعيل العضو');
    }
  };

  // Confirm complete deletion of member and all their logs
  const handleConfirmDeleteMemberCompletely = async () => {
    if (!memberToDeleteCompletely) return;
    if (
      deleteConfirmationText.trim() !== 'حذف نهائي' &&
      deleteConfirmationText.trim() !== 'نعم، أؤكد الحذف'
    ) {
      alert('يرجى كتابة "حذف نهائي" للتأكيد.');
      return;
    }
    setIsDeletingMember(true);
    try {
      const res = await api.adminDeleteMemberCompletely(memberToDeleteCompletely.id);
      setMemberToDeleteCompletely(null);
      setDeleteConfirmationText('');
      setActionFeedbackMsg(res.message || 'تم حذف العضو وكافة سجلاته نهائيًا بنجاح.');
      setTimeout(() => setActionFeedbackMsg(''), 5000);
      onRefresh();
    } catch (err: any) {
      alert(err?.message || 'فشل حذف العضو نهائيًا');
    } finally {
      setIsDeletingMember(false);
    }
  };

  // Reset password
  const handleSavePassword = async (userId: string) => {
    if (!newPasswordInput.trim()) return;
    await onUpdateMember(userId, { password: newPasswordInput.trim() });
    setEditingPasswordUserId(null);
    setNewPasswordInput('');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Bar Header (المستطيل الوردي في أول الصفحة دائماً) */}
      <div className="bg-gradient-to-l from-rose-900 via-rose-800 to-pink-900 text-white rounded-3xl p-6 sm:p-7 shadow-md border border-pink-400/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-pink-950/40 text-pink-100 text-xs font-semibold border border-pink-400/30">
                <Shield className="w-3.5 h-3.5 text-pink-300" />
                <span>لوحة تحكم المشرفة</span>
              </span>

              {!cycleInfo.has_started ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-pink-400/20 text-pink-200 border border-pink-400/40 text-xs font-semibold">
                  <Clock className="w-3.5 h-3.5 text-pink-300" />
                  <span>لم تبدأ بعد (بانتظار الانطلاق)</span>
                </span>
              ) : cycleInfo.is_paused ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-orange-500/30 text-orange-200 border border-orange-400/40 text-xs font-bold">
                  <PauseCircle className="w-3.5 h-3.5 text-orange-300" />
                  <span>البرنامج متوقف مؤقتًا</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-pink-500/20 text-pink-200 border border-pink-400/30 text-xs font-semibold">
                  <PlayCircle className="w-3.5 h-3.5 text-pink-300" />
                  <span>البرنامج نشط ومستمر</span>
                </span>
              )}
            </div>

            {cycleInfo.has_started ? (
              <>
                <h2 className="text-2xl sm:text-3xl font-bold font-quran text-pink-100 tracking-tight">
                  اليوم رقم {cycleInfo.cycle_day}
                </h2>
                <p className="text-pink-100/90 text-xs sm:text-sm">
                  الربع المطلوب اليوم: <strong>الربع {cycleInfo.quarter_of_day}</strong> • التاريخ: {getHijriDate(cycleInfo.today_date)} (الموافق {cycleInfo.today_date}م)
                  {cycleInfo.paused_days_count > 0 && ` • (أيام إيقاف مؤقت سابقة: ${cycleInfo.paused_days_count} يوم)`}
                </p>
              </>
            ) : (
              <>
                <h2 className="text-2xl sm:text-3xl font-bold font-quran text-pink-100 tracking-tight">
                  لم تبدأ بعد
                </h2>
                <p className="text-pink-100/90 text-xs sm:text-sm">
                  الانطلاق المقرر: <strong>{formatArabicDateWithDayName(cycleInfo.start_date)}</strong> (الساعة 12:00 صباحًا) • {getPreLaunchMessage(cycleInfo.days_until_start, cycleInfo.start_date)}
                </p>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition flex items-center gap-1.5 text-xs font-bold backdrop-blur-xs cursor-pointer"
              title="تحديث البيانات"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Celebration banner if complete */}
      {cycleInfo.is_completed && (
        <CelebrationBanner
          currentCycle={cycleInfo.current_cycle_number}
          isAdmin={true}
          onFactoryResetClick={() => {
            setActiveTab('settings');
            setShowResetModal(true);
          }}
        />
      )}

      {/* Program Pause Banner */}
      {cycleInfo.is_paused && <PauseBanner pausedAt={cycleInfo.paused_at} />}

      {/* Rest day banner if today is rest day */}
      {cycleInfo.is_rest_day && <RestDayBanner note={cycleInfo.rest_day_note} />}

      {/* Main Tabs Navigation */}
      <div className="flex bg-pink-50/60 p-1.5 rounded-2xl gap-1 text-xs font-bold border border-pink-100">
        <button
          onClick={() => setActiveTab('today')}
          className={`flex-1 py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 transition ${
            activeTab === 'today'
              ? 'bg-white text-rose-950 shadow-sm border border-pink-200'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <Calendar className="w-4 h-4 text-rose-600" />
          <span>متابعة اليوم ({recitedTodayCount}/{totalMembersCount})</span>
        </button>

        <button
          onClick={() => setActiveTab('members')}
          className={`flex-1 py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 transition ${
            activeTab === 'members'
              ? 'bg-white text-rose-950 shadow-sm border border-pink-200'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <Users className="w-4 h-4 text-rose-600" />
          <span>إدارة الأخوات ({users.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('stats')}
          className={`flex-1 py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 transition ${
            activeTab === 'stats'
              ? 'bg-white text-rose-950 shadow-sm border border-pink-200'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <BarChart3 className="w-4 h-4 text-rose-600" />
          <span>الإحصائيات الميدانية</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex-1 py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 transition ${
            activeTab === 'settings'
              ? 'bg-white text-rose-950 shadow-sm border border-pink-200'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <Settings className="w-4 h-4 text-rose-600" />
          <span>الإعدادات والإيقاف</span>
        </button>
      </div>

      {/* =================================================================== */}
      {/* TAB 1: متابعة اليوم (TODAY'S TRACKING) */}
      {/* =================================================================== */}
      {activeTab === 'today' && (
        <div className="space-y-5">
          {/* Pre-launch notification banner for admin */}
          {!cycleInfo.has_started && (
            <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5 text-amber-700" />
                </div>
                <div>
                  <h4 className="font-bold text-sm">
                    البرنامج في مرحلة ما قبل الانطلاق (لم يبدأ بعد)
                  </h4>
                  <p className="text-xs text-amber-800">
                    {getPreLaunchMessage(cycleInfo.days_until_start, cycleInfo.start_date)} — سيبدأ اليوم الأول والربع الأول رسميًا يوم {formatArabicDateWithDayName(cycleInfo.start_date)} في تمام 12:00 صباحًا.
                  </p>
                </div>
              </div>
              <div className="text-xs font-bold text-amber-900 bg-white/90 border border-amber-300 px-3 py-1.5 rounded-xl text-center shrink-0">
                موعد الانطلاق: {formatArabicDateWithDayName(cycleInfo.start_date)}
              </div>
            </div>
          )}

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="p-4 rounded-2xl bg-white border border-stone-200 shadow-2xs flex items-center justify-between">
              <div>
                <span className="text-xs text-stone-500 font-medium">أتموا تسميع اليوم</span>
                <div className="text-2xl font-bold text-emerald-800 mt-0.5">
                  {recitedTodayCount}{' '}
                  <span className="text-xs text-stone-400 font-normal">من {totalMembersCount}</span>
                </div>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
                <BookOpen className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white border border-stone-200 shadow-2xs flex items-center justify-between">
              <div>
                <span className="text-xs text-stone-500 font-medium">أتموا مراجعة اليوم</span>
                <div className="text-2xl font-bold text-emerald-800 mt-0.5">
                  {reviewedTodayCount}{' '}
                  <span className="text-xs text-stone-400 font-normal">من {totalMembersCount}</span>
                </div>
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
                <BookmarkCheck className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white border border-stone-200 shadow-2xs flex items-center justify-between">
              <div>
                <span className="text-xs text-stone-500 font-medium">متأخرون عن ربع اليوم</span>
                <div className="text-2xl font-bold text-amber-700 mt-0.5">
                  {behindMembersCount}{' '}
                  <span className="text-xs text-stone-400 font-normal">عضو متأخر</span>
                </div>
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
                <Clock className="w-5 h-5" />
              </div>
            </div>

            <div className={`p-4 rounded-2xl border shadow-2xs flex items-center justify-between transition ${
              severelyBehindMembersCount > 0
                ? 'bg-rose-50/80 border-rose-300'
                : 'bg-white border-stone-200'
            }`}>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-stone-500 font-medium">مؤهلون للإقصاء</span>
                  <span className="text-[10px] text-rose-700 font-bold bg-rose-100/80 px-1.5 py-0.2 rounded-sm">3+ فائت</span>
                </div>
                <div className={`text-2xl font-bold mt-0.5 ${
                  severelyBehindMembersCount > 0 ? 'text-rose-700' : 'text-stone-800'
                }`}>
                  {severelyBehindMembersCount}{' '}
                  <span className="text-xs text-stone-400 font-normal">عضو</span>
                </div>
              </div>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                severelyBehindMembersCount > 0 ? 'bg-rose-100 text-rose-700' : 'bg-stone-100 text-stone-500'
              }`}>
                <AlertOctagon className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="p-3 bg-white rounded-2xl border border-stone-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <input
                type="text"
                placeholder="بحث باسم العضو أو الهاتف..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3.5 py-2 text-xs rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-emerald-600 transition outline-hidden"
              />
              <Search className="w-4 h-4 text-stone-400 absolute left-2.5 top-2.5" />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
              <button
                onClick={() => setTodayFilter('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                  todayFilter === 'all'
                    ? 'bg-emerald-800 text-white'
                    : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
                }`}
              >
                الكل ({totalMembersCount})
              </button>
              <button
                onClick={() => setTodayFilter('unrecited')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                  todayFilter === 'unrecited'
                    ? 'bg-amber-700 text-white'
                    : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
                }`}
              >
                لم يُسمّعوا ({totalMembersCount - recitedTodayCount})
              </button>
              <button
                onClick={() => setTodayFilter('unreviewed')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                  todayFilter === 'unreviewed'
                    ? 'bg-amber-700 text-white'
                    : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
                }`}
              >
                لم يُراجعوا ({totalMembersCount - reviewedTodayCount})
              </button>
              <button
                onClick={() => setTodayFilter('behind')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                  todayFilter === 'behind'
                    ? 'bg-rose-700 text-white'
                    : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
                }`}
              >
                متأخرون ({behindMembersCount})
              </button>
              {severelyBehindMembersCount > 0 && (
                <button
                  onClick={() => setTodayFilter('severely_behind')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1 ${
                    todayFilter === 'severely_behind'
                      ? 'bg-rose-800 text-white'
                      : 'bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-300'
                  }`}
                >
                  <AlertOctagon className="w-3.5 h-3.5 text-rose-600" />
                  <span>مؤهل للإقصاء ({severelyBehindMembersCount})</span>
                </button>
              )}
            </div>
          </div>

          {/* Members Table */}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-stone-50/80 border-b border-stone-200 text-stone-600 font-bold">
                    <th className="py-3 px-4">العضو</th>
                    <th className="py-3 px-4">الربع المطلوب</th>
                    <th className="py-3 px-4">تسميع اليوم</th>
                    <th className="py-3 px-4">مراجعة اليوم</th>
                    <th className="py-3 px-4">ملاحظات / المستمع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-stone-800">
                  {filteredTodayMembers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-stone-400 text-xs">
                        لا يوجد أعضاء مطابقين لمعايير التصفية الحالية
                      </td>
                    </tr>
                  ) : (
                    filteredTodayMembers.map((m) => {
                      const qInfo = getQuarterInfo(m.requiredQuarter);
                      return (
                        <tr key={m.user.id} className="hover:bg-stone-50/50 transition">
                          <td className="py-3 px-4">
                            <div className="font-bold text-stone-900">{m.user.name}</div>
                            <div className="text-[11px] text-stone-400 font-mono">{m.user.phone}</div>
                            {/* 🚨 Warning Badge for Severe Delay (> 3 missed quarters or > 3 missed revision days) */}
                            {m.isSeverelyBehind && (
                              <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-300">
                                <AlertOctagon className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                <span>
                                  {m.isSeverelyBehindRecitation && m.isSeverelyBehindRevision
                                    ? `متأخر بشدة: ${m.missedQuartersCount} أرباع و ${m.missedRevisionDaysCount} مراجعة — مؤهل للإقصاء`
                                    : m.isSeverelyBehindRecitation
                                    ? `متأخر بشدة: ${m.missedQuartersCount} أرباع فائتة — مؤهل للإقصاء`
                                    : `متأخر بشدة: ${m.missedRevisionDaysCount} أيام مراجعة فائتة — مؤهل للإقصاء`}
                                </span>
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            {m.isAllCaughtUp ? (
                              <div>
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  مواكب للخطة (الربع {cycleInfo.quarter_of_day})
                                </span>
                              </div>
                            ) : (
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-stone-900">الربع {m.requiredQuarter}</span>
                                  {m.missedQuartersCount > 0 && (
                                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${
                                      m.isSeverelyBehindRecitation
                                        ? 'bg-rose-50 text-rose-800 border-rose-300'
                                        : 'bg-amber-50 text-amber-800 border-amber-200'
                                    }`}>
                                      {m.missedQuartersCount} أرباع فائتة
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-stone-500 font-quran">{qInfo.surahName}</div>
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            {m.hasRecited ? (
                              <div className="space-y-1">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-200">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                  {m.todayRecsCount === 1
                                    ? `تم التسميع (الربع ${m.todayRecs[0].quarter_number})`
                                    : `تم تسميع (${m.todayRecsCount}) أرباع اليوم`}
                                </span>
                                {m.todayRecsCount > 1 && (
                                  <div className="text-[10px] text-emerald-700 font-medium">
                                    الأرباع: {m.todayRecs.map((r) => r.quarter_number).join('، ')}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-semibold text-[11px] bg-stone-100 text-stone-500">
                                <Clock className="w-3.5 h-3.5 text-stone-400" />
                                لم يُسمّع اليوم
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            <div className="space-y-1">
                              {m.hasReviewed ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-200">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                  تمت المراجعة
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-semibold text-[11px] bg-stone-100 text-stone-500">
                                  <Clock className="w-3.5 h-3.5 text-stone-400" />
                                  لم تُؤكَّد اليوم
                                </span>
                              )}
                              {m.missedRevisionDaysCount > 0 && (
                                <div>
                                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${
                                    m.isSeverelyBehindRevision
                                      ? 'bg-rose-50 text-rose-800 border-rose-300'
                                      : 'bg-amber-50 text-amber-800 border-amber-200'
                                  }`}>
                                    {m.missedRevisionDaysCount} مراجعات فائتة
                                  </span>
                                </div>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4 text-[11px] text-stone-600 max-w-[200px]">
                            {m.listenerName ? (
                              <div>المستمع: <strong>{m.listenerName}</strong></div>
                            ) : (
                              <span className="text-stone-400">-</span>
                            )}
                            {m.recitationNotes && (
                              <div className="text-stone-500 truncate" title={m.recitationNotes}>
                                "{m.recitationNotes}"
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: إدارة الأعضاء (MEMBERS MANAGEMENT) */}
      {/* =================================================================== */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-base text-stone-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-700" />
                <span>إدارة أعضاء المقرأة</span>
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                إدارة حسابات الحفاظ، وإقصاء الأعضاء مؤقتًا، وإعادة تفعيلهم أو حذفهم نهائيًا
              </p>
            </div>

            <button
              onClick={() => setIsMemberModalOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition flex items-center justify-center gap-1.5 shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة عضو جديد</span>
            </button>
          </div>

          {/* Sub-tabs: Active Members vs Excluded Members */}
          <div className="flex items-center gap-2 border-b border-stone-200 pb-2">
            <button
              onClick={() => setMembersSubTab('active')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                membersSubTab === 'active'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>الأعضاء النشطون ({activeUsers.length})</span>
            </button>

            <button
              onClick={() => setMembersSubTab('excluded')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                membersSubTab === 'excluded'
                  ? 'bg-rose-700 text-white shadow-xs'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              <UserX className="w-4 h-4" />
              <span>الأعضاء المُقصَون</span>
              {excludedMemberUsers.length > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                    membersSubTab === 'excluded'
                      ? 'bg-rose-900 text-rose-100'
                      : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  {excludedMemberUsers.length}
                </span>
              )}
            </button>
          </div>

          {/* Feedback banner */}
          {actionFeedbackMsg && (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3.5 flex items-center gap-2.5 text-xs text-emerald-900 font-semibold animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{actionFeedbackMsg}</span>
            </div>
          )}

          {/* SUB-TAB 1: الأعضاء النشطون */}
          {membersSubTab === 'active' && (
            <div className="bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-stone-50/80 border-b border-stone-200 text-stone-600 font-bold">
                      <th className="py-3 px-4">الاسم</th>
                      <th className="py-3 px-4">رقم الهاتف</th>
                      <th className="py-3 px-4">الدور</th>
                      <th className="py-3 px-4">الحالة</th>
                      <th className="py-3 px-4">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 text-stone-800">
                    {activeUsers.map((u) => {
                      const isEditingPw = editingPasswordUserId === u.id;
                      const memberStatus = membersTodayStatus.find((s) => s.user.id === u.id);
                      return (
                        <tr key={u.id} className="hover:bg-stone-50/50 transition">
                          <td className="py-3 px-4">
                            <div className="font-bold text-stone-900">{u.name}</div>
                            {memberStatus?.isSeverelyBehind && (
                              <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-300">
                                <AlertOctagon className="w-3 h-3 text-rose-600 shrink-0" />
                                <span>
                                  {memberStatus.isSeverelyBehindRecitation && memberStatus.isSeverelyBehindRevision
                                    ? `مؤهل للإقصاء (${memberStatus.missedQuartersCount} أرباع + ${memberStatus.missedRevisionDaysCount} مراجعة)`
                                    : memberStatus.isSeverelyBehindRecitation
                                    ? `مؤهل للإقصاء (${memberStatus.missedQuartersCount} أرباع فائتة)`
                                    : `مؤهل للإقصاء (${memberStatus.missedRevisionDaysCount} مراجعات فائتة)`}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-stone-600">
  {u.role === 'admin' ? '—' : u.phone}
</td>
                          <td className="py-3 px-4">
                            {u.role === 'admin' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md font-bold text-[10px] bg-amber-50 text-amber-900 border border-amber-200">
                                <Shield className="w-3 h-3 text-amber-600" />
                                مشرف
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md font-medium text-[10px] bg-stone-100 text-stone-700">
                                عضو حافظ
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                                <UserCheck className="w-3.5 h-3.5" />
                                نشط
                              </span>
                              {u.role === 'member' && memberStatus && (
                                <div className="text-[10px] space-y-0.5">
                                  <div className={memberStatus.isSeverelyBehindRecitation ? 'text-rose-700 font-bold' : memberStatus.missedQuartersCount > 0 ? 'text-amber-700 font-medium' : 'text-stone-400'}>
                                    الأرباع الفائتة: {memberStatus.missedQuartersCount}
                                  </div>
                                  <div className={memberStatus.isSeverelyBehindRevision ? 'text-rose-700 font-bold' : memberStatus.missedRevisionDaysCount > 0 ? 'text-amber-700 font-medium' : 'text-stone-400'}>
                                    المراجعات الفائتة: {memberStatus.missedRevisionDaysCount}
                                  </div>
                                  <div className="text-emerald-700 font-semibold">
                                    جلسات الاستماع للزملاء: {memberStatus.totalTimesListened}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              {/* Exclude member button (for non-admin members) */}
                              {u.id !== currentUser.id && u.role === 'member' && (
                                <button
                                  onClick={() => setMemberToExclude(u)}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1 transition cursor-pointer"
                                  title="إقصاء العضو مؤقتًا من المجموعة ونقله لقائمة الأعضاء المُقصَين"
                                >
                                  <UserMinus className="w-3.5 h-3.5 text-amber-700" />
                                  <span>إقصاء</span>
                                </button>
                              )}

                              {/* Reset password — members only */}
                              {u.role === 'member' && (
                                <>
                                  {isEditingPw ? (
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="text"
                                        placeholder="كلمة مرور جديدة..."
                                        value={newPasswordInput}
                                        onChange={(e) => setNewPasswordInput(e.target.value)}
                                        className="w-28 px-2 py-1 text-[11px] border border-stone-300 rounded-lg outline-hidden"
                                      />
                                      <button
                                        onClick={() => handleSavePassword(u.id)}
                                        className="px-2 py-1 rounded-lg bg-emerald-700 text-white text-[10px] font-bold"
                                      >
                                        حفظ
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEditingPasswordUserId(null);
                                          setNewPasswordInput('');
                                        }}
                                        className="px-1.5 py-1 rounded-lg bg-stone-200 text-stone-600 text-[10px]"
                                      >
                                        إلغاء
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setEditingPasswordUserId(u.id);
                                        setNewPasswordInput('');
                                      }}
                                      className="px-2 py-1 rounded-lg text-[11px] bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center gap-1 transition"
                                      title="تغيير كلمة مرور العضو"
                                    >
                                      <Key className="w-3 h-3" />
                                      <span>كلمة المرور</span>
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SUB-TAB 2: الأعضاء المُقصَون */}
          {membersSubTab === 'excluded' && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-amber-50/80 border border-amber-200/90 p-4 text-xs text-amber-900 leading-relaxed flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">ملاحظات فترة إقصاء العضو:</p>
                  <p>
                    • العضو المُقصَى لا يستطيع تسجيل تسميع أو تأكيد مراجعة إطلاقًا.
                    <br />
                    • يستمر جدول المجموعة وربع اليوم في التقدّم طبيعيًا ولا يتوقف لأجل أي عضو.
                    <br />
                    • تُحفظ جميع سجلات وتسميعات العضو القديمة كما هي. وعند إعادة تفعيله يعود مباشرة لقائمة الأعضاء النشطين لمواصلة التسميع واستدراك الأرباع الفائتة.
                    <br />
                    • اختيار "حذف نهائي" يحذف مستند العضو وسجلاته السابقة بالكامل وبلا رجعة.
                  </p>
                </div>
              </div>

              {excludedMemberUsers.length === 0 ? (
                <div className="bg-white rounded-2xl border border-stone-200 p-10 text-center space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h4 className="font-bold text-stone-800 text-sm">لا يوجد أعضاء مُقصَون حاليًا</h4>
                  <p className="text-xs text-stone-500 max-w-md mx-auto">
                    جميع أعضاء المقرأة في حالة نشاط ومشاركون في خطة التسميع والمراجعة اليومية.
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead>
                        <tr className="bg-rose-50/60 border-b border-rose-100 text-rose-900 font-bold">
                          <th className="py-3 px-4">الاسم</th>
                          <th className="py-3 px-4">رقم الهاتف</th>
                          <th className="py-3 px-4">السجلات السابقة المحفوظة</th>
                          <th className="py-3 px-4">الحالة</th>
                          <th className="py-3 px-4">الإجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100 text-stone-800">
                        {excludedMemberUsers.map((u) => {
                          const userRecsCount = recitations.filter(
                            (r) => r.member_id === u.id || r.reciter_id === u.id
                          ).length;
                          const userRevsCount = revisions.filter(
                            (r) => r.member_id === u.id
                          ).length;
                          const userListenedCount = recitations.filter(
                            (r) => r.listener_id === u.id && (r.member_id || r.reciter_id) !== u.id
                          ).length;

                          return (
                            <tr key={u.id} className="hover:bg-stone-50/50 transition">
                              <td className="py-3 px-4 font-bold text-stone-900">{u.name}</td>
                              <td className="py-3 px-4 font-mono text-stone-600">{u.phone}</td>
                              <td className="py-3 px-4">
                                <span className="inline-flex items-center gap-1 text-[11px] text-stone-600 font-semibold bg-stone-100 px-2 py-0.5 rounded-md">
                                  {userRecsCount} تسميع • {userRevsCount} مراجعة • {userListenedCount} استماع
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-md border border-rose-200">
                                  <UserX className="w-3.5 h-3.5" />
                                  مُقصَى (مُعلّق)
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2">
                                  {/* Reactivate Button */}
                                  <button
                                    onClick={() => setMemberToReactivate(u)}
                                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
                                    title="إعادة تفعيل العضو وإعادته للمقرأة"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5 text-emerald-700" />
                                    <span>إعادة التفعيل</span>
                                  </button>

                                  {/* Delete Completely Button */}
                                  <button
                                    onClick={() => {
                                      setMemberToDeleteCompletely(u);
                                      setDeleteConfirmationText('');
                                    }}
                                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-1.5 transition shadow-2xs"
                                    title="حذف نهائي للعضو وسجلاته بلا رجعة"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                                    <span>حذف نهائي</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: الإحصائيات الميدانية (STATISTICS) */}
      {/* =================================================================== */}
      {activeTab === 'stats' && (
        <div className="space-y-4">
          {/* Sub tabs: Weekly vs Lifetime */}
          <div className="flex border-b border-stone-200 bg-stone-50/70 p-1 rounded-2xl gap-1 text-xs font-bold">
            <button
              onClick={() => setStatsPeriodTab('current_week')}
              className={`flex-1 py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition ${
                statsPeriodTab === 'current_week'
                  ? 'bg-white text-emerald-900 shadow-sm border border-stone-200'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <CalendarRange className="w-4 h-4 text-emerald-700" />
              <span>إحصائيات الأسبوع الحالي ({currentWeek.startDate} إلى {currentWeek.endDate})</span>
            </button>

            <button
              onClick={() => setStatsPeriodTab('all_time')}
              className={`flex-1 py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition ${
                statsPeriodTab === 'all_time'
                  ? 'bg-white text-emerald-900 shadow-sm border border-stone-200'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <BarChart3 className="w-4 h-4 text-emerald-700" />
              <span>الإحصائيات الإجمالية (منذ بداية الدورة)</span>
            </button>
          </div>

          {/* Stats Table */}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-stone-50/80 border-b border-stone-200 text-stone-600 font-bold">
                    <th className="py-3 px-4">العضو</th>
                    <th className="py-3 px-4">الربع المطلوب الحالي</th>
                    <th className="py-3 px-4">
                      {statsPeriodTab === 'current_week' ? 'تسميعات هذا الأسبوع' : 'إجمالي التسميعات'}
                    </th>
                    <th className="py-3 px-4">
                      {statsPeriodTab === 'current_week' ? 'مراجعات هذا الأسبوع' : 'إجمالي المراجعات'}
                    </th>
                    <th className="py-3 px-4">
                      {statsPeriodTab === 'current_week' ? 'استماع هذا الأسبوع' : 'إجمالي الاستماع للزملاء'}
                    </th>
                    <th className="py-3 px-4">حالة الالتزام</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-stone-800">
                  {statsPeriodTab === 'current_week' ? (
                    membersWeeklyStatus.map((m) => (
                      <tr key={m.user.id} className="hover:bg-stone-50/50 transition">
                        <td className="py-3 px-4">
                          <div className="font-bold text-stone-900">{m.user.name}</div>
                          {m.isSeverelyBehind && (
                            <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-300">
                              <AlertOctagon className="w-3 h-3 text-rose-600 shrink-0" />
                              <span>مؤهل للإقصاء</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold">الربع {m.requiredQuarter}</span>
                          {m.missedQuartersCount > 0 && (
                            <div className="text-[10px] text-amber-700 font-medium">
                              فائت: {m.missedQuartersCount} أرباع
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-emerald-800">{m.weeklyRecitationsCount}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-emerald-800">{m.weeklyRevisionsCount}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-block font-bold text-xs px-2.5 py-0.5 rounded-md ${
                              m.weeklyTimesListened > 0
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'text-stone-400 bg-stone-100'
                            }`}
                          >
                            {m.weeklyTimesListened}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-stone-100 rounded-full h-2 overflow-hidden">
                              <div
                                className="bg-emerald-700 h-2 rounded-full"
                                style={{ width: `${m.commitmentRate}%` }}
                              />
                            </div>
                            <span className="font-bold text-[11px] text-stone-700">{m.commitmentRate}%</span>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    membersTodayStatus.map((m) => (
                      <tr key={m.user.id} className="hover:bg-stone-50/50 transition">
                        <td className="py-3 px-4">
                          <div className="font-bold text-stone-900">{m.user.name}</div>
                          {m.isSeverelyBehind && (
                            <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-300">
                              <AlertOctagon className="w-3 h-3 text-rose-600 shrink-0" />
                              <span>
                                {m.isSeverelyBehindRecitation && m.isSeverelyBehindRevision
                                  ? `مؤهل للإقصاء (${m.missedQuartersCount} أرباع + ${m.missedRevisionDaysCount} مراجعة)`
                                  : m.isSeverelyBehindRecitation
                                  ? `مؤهل للإقصاء (${m.missedQuartersCount} أرباع)`
                                  : `مؤهل للإقصاء (${m.missedRevisionDaysCount} مراجعة)`}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold">الربع {m.requiredQuarter}</span>
                          {m.missedQuartersCount > 0 && (
                            <div className="text-[10px] text-amber-700 font-medium">
                              فائت: {m.missedQuartersCount} أرباع
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-emerald-800">{m.totalRecitations}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-emerald-800">{m.totalRevisions}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-block font-bold text-xs px-2.5 py-0.5 rounded-md ${
                              m.totalTimesListened > 0
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'text-stone-400 bg-stone-100'
                            }`}
                          >
                            {m.totalTimesListened}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {m.isSeverelyBehind ? (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-300">
                              تأخر شديد (مؤهل للإقصاء)
                            </span>
                          ) : m.isBehind ? (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                              متأخر ({m.missedQuartersCount} أرباع)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              مواكب للخطة تمامًا
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Listening peer leaderboard for selected period (Weekly or All-time since beginning of course) */}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-emerald-700" />
                <h4 className="text-xs font-bold text-stone-900">
                  {statsPeriodTab === 'current_week'
                    ? 'ترتيب الزملاء الأكثر استماعًا (هذا الأسبوع)'
                    : 'ترتيب الزملاء الأكثر استماعًا (منذ بداية الدورة)'}
                </h4>
              </div>
              <span className="text-[11px] text-stone-500 font-mono">
                {statsPeriodTab === 'current_week'
                  ? `${currentWeek.startDate} إلى ${currentWeek.endDate}`
                  : `منذ بداية الدورة (${formatArabicDateWithDayName(cycleInfo.start_date)}) حتى اليوم (${formatArabicDateWithDayName(cycleInfo.today_date)})`}
              </span>
            </div>

            {/* Summary statistics strip for all-time listening */}
            {statsPeriodTab === 'all_time' && (
              <div className="bg-stone-50/70 border-b border-stone-100 px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-stone-500 block text-[11px]">إجمالي جلسات الاستماع بالدورة</span>
                  <span className="font-bold text-emerald-900 text-sm font-mono">
                    {recitations.filter((r) => r.listener_id && (r.member_id || r.reciter_id) !== r.listener_id).length} جلسة
                  </span>
                </div>
                <div>
                  <span className="text-stone-500 block text-[11px]">أعلى مساهمة بالاستماع</span>
                  <span className="font-bold text-emerald-900 text-sm">
                    {listenersAllTimeLeaderboard[0]?.timesListened > 0
                      ? `${listenersAllTimeLeaderboard[0]?.user.name} (${listenersAllTimeLeaderboard[0]?.timesListened} مرة)`
                      : 'لا توجد جلسات بعد'}
                  </span>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <span className="text-stone-500 block text-[11px]">أعضاء شاركوا بالاستماع</span>
                  <span className="font-bold text-stone-900 text-sm font-mono">
                    {listenersAllTimeLeaderboard.filter((l) => l.timesListened > 0).length} / {activeMemberUsers.length} عضو
                  </span>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-stone-50/80 border-b border-stone-200 text-stone-600 font-bold">
                    <th className="py-3 px-4 w-14 text-center">#</th>
                    <th className="py-3 px-4">الاسم</th>
                    <th className="py-3 px-4 text-left">
                      {statsPeriodTab === 'current_week' ? 'عدد مرات الاستماع' : 'إجمالي مرات الاستماع'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-stone-800">
                  {(statsPeriodTab === 'current_week' ? listenersWeeklyLeaderboard : listenersAllTimeLeaderboard).map(
                    (item, index) => (
                      <tr key={item.user.id} className="hover:bg-stone-50/50 transition">
                        <td className="py-3 px-4 text-center font-bold text-stone-500 font-mono">
                          {index === 0 && item.timesListened > 0 ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">
                              🥇
                            </span>
                          ) : index === 1 && item.timesListened > 0 ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-slate-800 text-[11px] font-bold">
                              🥈
                            </span>
                          ) : index === 2 && item.timesListened > 0 ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-700/20 text-amber-900 text-[11px] font-bold">
                              🥉
                            </span>
                          ) : (
                            index + 1
                          )}
                        </td>
                        <td className="py-3 px-4 font-bold text-stone-900">{item.user.name}</td>
                        <td className="py-3 px-4 text-left">
                          <span
                            className={`inline-block font-bold text-xs px-2.5 py-0.5 rounded-md ${
                              item.timesListened > 0
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'text-stone-400 bg-stone-100'
                            }`}
                          >
                            {item.timesListened}
                          </span>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 4: الإعدادات والإيقاف (SETTINGS & PAUSE) */}
      {/* =================================================================== */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          {/* Section: خاطرة اليوم (Daily Thought Editor) */}
          <DailyThoughtEditor
            currentThought={settings.daily_thought}
            updatedAt={settings.daily_thought_updated_at}
            updatedBy={settings.daily_thought_updated_by}
            onSave={(htmlContent) => onUpdateDailyThought({ daily_thought: htmlContent })}
            onDelete={onDeleteDailyThought}
            loading={loading}
          />

          {/* Section 1: Pause / Resume the entire program */}
          <div className="bg-white rounded-3xl border border-stone-200 p-6 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h3 className="font-bold text-base text-stone-900 flex items-center gap-2">
                  <PauseCircle className="w-5 h-5 text-emerald-700" />
                  <span>التحكم في سريان البرنامج (إيقاف مؤقت / استئناف)</span>
                </h3>
                <p className="text-xs text-stone-500">
                  تجميد احتساب أيام الدورة للجميع عند وجود إجازات عامة أو ظروف استثنائية
                </p>
              </div>

              {cycleInfo.is_paused ? (
                <span className="px-3 py-1 rounded-full bg-orange-100 text-orange-800 text-xs font-bold border border-orange-200 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-orange-600 animate-pulse" />
                  متوقف مؤقتًا حاليًا
                </span>
              ) : (
                <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-200 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-600" />
                  نشط ومستمر
                </span>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200/80 space-y-3">
              <p className="text-xs text-stone-700 leading-relaxed">
                • <strong>كيف يعمل الإيقاف المؤقت؟</strong> عند تفعيل الإيقاف، يتجمد احتساب اليوم الحالي ولا تتقدم أيام الدورة الـ 240 إطلاقًا لجميع الأعضاء حتى تقوم بالاستئناف.
              </p>
              <p className="text-xs text-stone-600 leading-relaxed">
                • إجمالي أيام الإيقاف المؤقت المحسوبة سابقًا: <strong>{cycleInfo.paused_days_count} يومًا</strong>.
              </p>

              <div className="pt-2">
                {cycleInfo.is_paused ? (
                  <button
                    onClick={() => setShowResumeModal(true)}
                    disabled={loading}
                    className="px-6 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-sm transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <PlayCircle className="w-4 h-4" />
                    <span>استئناف سير البرنامج ومواصلة الدورة</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setShowPauseModal(true)}
                    disabled={loading}
                    className="px-6 py-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs shadow-sm transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <PauseCircle className="w-4 h-4" />
                    <span>تفعيل الإيقاف المؤقت للبرنامج</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Rest / Catch-up Days */}
          <div className="bg-white rounded-3xl border border-stone-200 p-6 shadow-2xs space-y-4">
            <div>
              <h3 className="font-bold text-base text-stone-900 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-emerald-700" />
                <span>أيام الاستدراك والراحة المحددة مسبقًا</span>
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                أيام توقف محددة بالتواريخ لا تحتسب ضمن الـ 240 يومًا
              </p>
            </div>

            <form onSubmit={handleAddRestDaySubmit} className="flex flex-col sm:flex-row items-end gap-3">
              <div className="w-full sm:w-48">
                <label className="block text-xs font-bold text-stone-700 mb-1">تاريخ اليوم *</label>
                <input
                  type="date"
                  value={newRestDate}
                  onChange={(e) => setNewRestDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-stone-200 rounded-xl bg-stone-50 outline-hidden"
                  required
                />
              </div>

              <div className="flex-1 w-full">
                <label className="block text-xs font-bold text-stone-700 mb-1">المناسبة / ملاحظة</label>
                <input
                  type="text"
                  value={newRestNote}
                  onChange={(e) => setNewRestNote(e.target.value)}
                  placeholder="مثال: يوم عيد الفطر المبارك..."
                  className="w-full px-3 py-2 text-xs border border-stone-200 rounded-xl bg-stone-50 outline-hidden"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة يوم</span>
              </button>
            </form>

            {restDayError && <p className="text-xs text-rose-600 font-medium">{restDayError}</p>}

            {/* List of rest days */}
            <div className="divide-y divide-stone-100 border-t border-stone-100 pt-2">
              {restDays.length === 0 ? (
                <p className="text-xs text-stone-400 py-4 text-center">
                  لم تتم إضافة أي أيام استدراك محددة بعد
                </p>
              ) : (
                restDays.map((rd) => (
                  <div key={rd.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <span className="font-bold text-stone-900 font-mono">{rd.date}</span>
                      <span className="text-stone-300 mx-2">•</span>
                      <span className="text-stone-600">{rd.note}</span>
                    </div>
                    <button
                      onClick={() => onDeleteRestDay(rd.id)}
                      className="p-1.5 text-stone-400 hover:text-rose-600 rounded-lg transition"
                      title="حذف اليوم"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Section 3: Start Date Setting */}
          <div className="bg-white rounded-3xl border border-stone-200 p-6 shadow-2xs space-y-4">
            <div>
              <h3 className="font-bold text-base text-stone-900 flex items-center gap-2">
                <CalendarRange className="w-5 h-5 text-emerald-700" />
                <span>تاريخ بداية الدورة</span>
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                التاريخ الذي انطلقت فيه الدورة الحالية (يُستخدم لحساب اليوم الحالي)
              </p>
            </div>

            <div className="flex items-center gap-3 max-w-sm">
              <input
                type="date"
                value={startDateInput}
                onChange={(e) => setStartDateInput(e.target.value)}
                className="px-3.5 py-2 text-xs border border-stone-200 rounded-xl bg-stone-50 outline-hidden flex-1"
              />
              <button
                onClick={handleSaveStartDate}
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-900 text-white text-xs font-bold transition"
              >
                حفظ
              </button>
            </div>

            {settingsMsg && <p className="text-xs text-emerald-700 font-medium">{settingsMsg}</p>}
          </div>

          {/* Section 4: Factory Reset */}
          <div className="bg-rose-50/50 rounded-3xl border border-rose-200 p-6 shadow-2xs space-y-3">
            <h3 className="font-bold text-base text-rose-950 flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-rose-700" />
              <span>إعادة ضبط المصنع وبدء دورة ختمة جديدة</span>
            </h3>
            <p className="text-xs text-rose-800 leading-relaxed">
              إعادة عداد الخطة إلى اليوم رقم 1، وتصفير أيام الإيقاف والاستدراك، ومسح جميع سجلات التسميع والمراجعة. يُستخدم عند إتمام الختمة (اليوم 240) أو إعادة تأسيس المقرأة.
            </p>

            <button
              onClick={() => setShowResetModal(true)}
              className="px-5 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-bold text-xs shadow-xs transition flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              <span>إعادة الضبط الشامل للمقرأة</span>
            </button>
          </div>
        </div>
      )}

      {/* Admin Member Modal */}
      <AdminMemberModal
        isOpen={isMemberModalOpen}
        onClose={() => setIsMemberModalOpen(false)}
        onSubmit={onAddMember}
        loading={loading}
      />

      {/* Factory Reset Confirmation Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-rose-200 overflow-hidden text-stone-900 p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-700">
              <div className="p-2.5 bg-rose-100 rounded-xl">
                <AlertCircle className="w-6 h-6 text-rose-700" />
              </div>
              <div>
                <h3 className="font-bold text-base text-rose-950">تأكيد إعادة الضبط الشامل</h3>
                <p className="text-xs text-stone-500">هذا الإجراء نهائي ولا يمكن التراجع عنه</p>
              </div>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed">
              سيتم مسح جميع سجلات التسميع والمراجعة السابقة لجميع الأعضاء، وتعيين بداية الدورة لتاريخ اليوم، والعودة إلى اليوم رقم 1 ورقم الدورة 1.
            </p>

            <div>
              <label className="block text-xs font-bold text-stone-700 mb-1.5">
                لتأكيد الإجراء، اكتب: <span className="font-mono text-rose-700">نعم، أؤكد إعادة الضبط</span>
              </label>
              <input
                type="text"
                value={resetConfirmationText}
                onChange={(e) => setResetConfirmationText(e.target.value)}
                placeholder="نعم، أؤكد إعادة الضبط"
                className="w-full px-3.5 py-2 rounded-xl border border-stone-300 text-xs outline-hidden"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => {
                  setShowResetModal(false);
                  setResetConfirmationText('');
                }}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={resetConfirmationText !== 'نعم، أؤكد إعادة الضبط' || loading}
                onClick={async () => {
                  await onFactoryReset();
                  setShowResetModal(false);
                  setResetConfirmationText('');
                }}
                className="px-5 py-2 text-xs font-bold rounded-xl text-white bg-rose-700 hover:bg-rose-800 shadow-xs transition disabled:opacity-40"
              >
                {loading ? 'جاري التنفيذ...' : 'تأكيد المسح والبدء من جديد'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Excluded Member Completely Confirmation Modal */}
      {memberToDeleteCompletely && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-rose-200 overflow-hidden text-stone-900 p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-700">
              <div className="p-2.5 bg-rose-100 rounded-xl">
                <AlertCircle className="w-6 h-6 text-rose-700" />
              </div>
              <div>
                <h3 className="font-bold text-base text-rose-950">تأكيد الحذف النهائي للعضو</h3>
                <p className="text-xs text-stone-500 font-semibold">
                  {memberToDeleteCompletely.name} ({memberToDeleteCompletely.phone})
                </p>
              </div>
            </div>

            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 leading-relaxed space-y-1">
              <p className="font-bold">⚠️ تحذير: هذا الإجراء نهائي ولا يمكن التراجع عنه مطلقاً!</p>
              <p>
                سيتم مسح مستند هذا العضو نهائياً من قاعدة البيانات (users)، بالإضافة لمسح كافة سجلات التسميع (recitations) وسجلات المراجعة (revisions) الخاصة به، وسيفقد حسابه إمكانية الدخول تماماً.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-700 mb-1.5">
                لتأكيد الحذف النهائي، اكتب في المربع: <span className="font-mono text-rose-700 font-bold">حذف نهائي</span>
              </label>
              <input
                type="text"
                value={deleteConfirmationText}
                onChange={(e) => setDeleteConfirmationText(e.target.value)}
                placeholder="حذف نهائي"
                className="w-full px-3.5 py-2 rounded-xl border border-stone-300 text-xs outline-hidden focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                disabled={isDeletingMember}
                onClick={() => {
                  setMemberToDeleteCompletely(null);
                  setDeleteConfirmationText('');
                }}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={
                  (deleteConfirmationText.trim() !== 'حذف نهائي' &&
                    deleteConfirmationText.trim() !== 'نعم، أؤكد الحذف') ||
                  isDeletingMember
                }
                onClick={handleConfirmDeleteMemberCompletely}
                className="px-5 py-2 text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-xs transition flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingMember ? 'جاري الحذف...' : 'تأكيد الحذف النهائي الآن'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1. Exclude Member Confirmation Modal */}
      {memberToExclude && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-amber-200 overflow-hidden text-stone-900 p-6 space-y-4">
            <div className="flex items-center gap-3 text-amber-800">
              <div className="p-2.5 bg-amber-100 rounded-xl">
                <UserMinus className="w-6 h-6 text-amber-700" />
              </div>
              <div>
                <h3 className="font-bold text-base text-stone-900">تأكيد إقصاء العضو من المقرأة</h3>
                <p className="text-xs text-stone-500 font-semibold">
                  {memberToExclude.name} ({memberToExclude.phone})
                </p>
              </div>
            </div>

            {(() => {
              const s = membersTodayStatus.find((st) => st.user.id === memberToExclude.id);
              if (!s) return null;
              return (
                <div className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                  s.isSeverelyBehind ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-stone-50 border-stone-200 text-stone-700'
                }`}>
                  <div>
                    <div className="font-bold flex items-center gap-1.5">
                      {s.isSeverelyBehind && <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0" />}
                      <span>حالة تأخر العضو الحالية:</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px]">
                      <span>الأرباع الفائتة: <strong>{s.missedQuartersCount}</strong></span>
                      <span>المراجعات الفائتة: <strong>{s.missedRevisionDaysCount}</strong></span>
                    </div>
                  </div>
                  {s.isSeverelyBehind && (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-200/80 text-rose-900">
                      تأخر شديد (3+)
                    </span>
                  )}
                </div>
              );
            })()}

            <div className="p-3 bg-amber-50/90 border border-amber-200 rounded-xl text-xs text-amber-950 leading-relaxed space-y-2">
              <p className="font-bold text-amber-900">ماذا سيحدث بالضبط نتيجة هذا الإجراء؟</p>
              <ul className="list-disc list-inside space-y-1 text-stone-700">
                <li>
                  سيتم إقصاء <strong className="text-stone-900">{memberToExclude.name}</strong> ونقله تلقائيًا إلى تبويب <strong>«الأعضاء المُقصَون»</strong>.
                </li>
                <li>
                  <strong>لن يستطيع العضو</strong> تسجيل أي تسميع أو تأكيد مراجعة إطلاقًا طوال فترة الإقصاء حتى تقوم بإعادة تفعيله.
                </li>
                <li>
                  يختفي العضو من متابعة اليوم وقوائم الاستماع المشتركة.
                </li>
                <li>
                  <strong>تُحفظ كافة سجلات التسميع والمراجعة السابقة</strong> للعضو دون أي حذف، ويستمر تقدم خطة الدورة وأرباع المقرأة كالمعتاد.
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                disabled={isExcluding}
                onClick={() => setMemberToExclude(null)}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isExcluding}
                onClick={async () => {
                  setIsExcluding(true);
                  try {
                    await handleExcludeMember(memberToExclude);
                    setMemberToExclude(null);
                  } finally {
                    setIsExcluding(false);
                  }
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-50 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <UserMinus className="w-3.5 h-3.5" />
                <span>{isExcluding ? 'جاري الإقصاء...' : 'تأكيد إقصاء العضو'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Reactivate Member Confirmation Modal */}
      {memberToReactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-emerald-200 overflow-hidden text-stone-900 p-6 space-y-4">
            <div className="flex items-center gap-3 text-emerald-800">
              <div className="p-2.5 bg-emerald-100 rounded-xl">
                <RotateCcw className="w-6 h-6 text-emerald-700" />
              </div>
              <div>
                <h3 className="font-bold text-base text-stone-900">تأكيد إعادة تفعيل العضو</h3>
                <p className="text-xs text-stone-500 font-semibold">
                  {memberToReactivate.name} ({memberToReactivate.phone})
                </p>
              </div>
            </div>

            <div className="p-3 bg-emerald-50/90 border border-emerald-200 rounded-xl text-xs text-emerald-950 leading-relaxed space-y-2">
              <p className="font-bold text-emerald-900">ماذا سيحدث بالضبط نتيجة هذا الإجراء؟</p>
              <ul className="list-disc list-inside space-y-1 text-stone-700">
                <li>
                  سيتم إعادة تفعيل <strong className="text-stone-900">{memberToReactivate.name}</strong> وإرجاعه مباشرة إلى قائمة <strong>«الأعضاء النشطين»</strong>.
                </li>
                <li>
                  يستعيد العضو فورًا إمكانية الدخول وتسجيل التسميع اليومي والمراجعة ومتابعة الدورة واستدراك ما فاته.
                </li>
                <li>
                  يعود للظهور مجددًا في قائمة متابعة اليوم، جدول الأرباع، وقائمة الزملاء المستمعين.
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                disabled={isReactivating}
                onClick={() => setMemberToReactivate(null)}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isReactivating}
                onClick={async () => {
                  setIsReactivating(true);
                  try {
                    await handleReactivateMember(memberToReactivate);
                    setMemberToReactivate(null);
                  } finally {
                    setIsReactivating(false);
                  }
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{isReactivating ? 'جاري إعادة التفعيل...' : 'تأكيد إعادة التفعيل'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Pause Program Confirmation Modal */}
      {showPauseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-orange-200 overflow-hidden text-stone-900 p-6 space-y-4">
            <div className="flex items-center gap-3 text-orange-800">
              <div className="p-2.5 bg-orange-100 rounded-xl">
                <PauseCircle className="w-6 h-6 text-orange-700" />
              </div>
              <div>
                <h3 className="font-bold text-base text-stone-900">تأكيد تفعيل الإيقاف المؤقت للبرنامج</h3>
                <p className="text-xs text-stone-500 font-semibold">تجميد تقدم أيام الدورة لجميع الأعضاء</p>
              </div>
            </div>

            <div className="p-3 bg-orange-50/90 border border-orange-200 rounded-xl text-xs text-orange-950 leading-relaxed space-y-2">
              <p className="font-bold text-orange-900">ماذا سيحدث بالضبط نتيجة هذا الإجراء؟</p>
              <ul className="list-disc list-inside space-y-1 text-stone-700">
                <li>
                  سيتم تجميد احتساب اليوم الحالي (اليوم {cycleInfo.cycle_day}) ولن تتقدم أيام الدورة نهائيًا حتى تقوم بالاستئناف.
                </li>
                <li>
                  سيظهر تنبيه علوي مميز لجميع الأعضاء والمشرف يفيد بأن برنامج المقرأة في حالة إيقاف مؤقت.
                </li>
                <li>
                  تُحسب جميع أيام التوقف تلقائيًا وتُستبعد من احتساب تقدم خطة الـ 240 يومًا لضمان عدم تأثر أرباع الأعضاء.
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                disabled={isPausing}
                onClick={() => setShowPauseModal(false)}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isPausing}
                onClick={async () => {
                  setIsPausing(true);
                  try {
                    await onPause();
                    setShowPauseModal(false);
                    setActionFeedbackMsg('تم تفعيل الإيقاف المؤقت للبرنامج بنجاح.');
                    setTimeout(() => setActionFeedbackMsg(''), 4000);
                  } finally {
                    setIsPausing(false);
                  }
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <PauseCircle className="w-3.5 h-3.5" />
                <span>{isPausing ? 'جاري الإيقاف...' : 'تأكيد تفعيل الإيقاف المؤقت'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Resume Program Confirmation Modal */}
      {showResumeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-emerald-200 overflow-hidden text-stone-900 p-6 space-y-4">
            <div className="flex items-center gap-3 text-emerald-800">
              <div className="p-2.5 bg-emerald-100 rounded-xl">
                <PlayCircle className="w-6 h-6 text-emerald-700" />
              </div>
              <div>
                <h3 className="font-bold text-base text-stone-900">تأكيد استئناف سير البرنامج</h3>
                <p className="text-xs text-stone-500 font-semibold">مواصلة دورة الحفظ والمراجعة لجميع الأعضاء</p>
              </div>
            </div>

            <div className="p-3 bg-emerald-50/90 border border-emerald-200 rounded-xl text-xs text-emerald-950 leading-relaxed space-y-2">
              <p className="font-bold text-emerald-900">ماذا سيحدث بالضبط نتيجة هذا الإجراء؟</p>
              <ul className="list-disc list-inside space-y-1 text-stone-700">
                <li>
                  سيتم استئناف البرنامج فورًا وإعادة تشغيل عداد الأيام ومتابعة خطة التسميع اليومية لجميع الأعضاء.
                </li>
                <li>
                  تُسجل وتُختم فترة التوقف السابقة وتُضاف لإجمالي أيام الإيقاف المؤقت المحسوبة، ويستأنف جدول الأرباع سيره المنتظم.
                </li>
                <li>
                  يختفي شريط التوقف وتعود لوحات المتابعة للوضع النشط التفاعلي.
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                disabled={isResuming}
                onClick={() => setShowResumeModal(false)}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isResuming}
                onClick={async () => {
                  setIsResuming(true);
                  try {
                    await onResume();
                    setShowResumeModal(false);
                    setActionFeedbackMsg('تم استئناف البرنامج بنجاح ومواصلة الدورة.');
                    setTimeout(() => setActionFeedbackMsg(''), 4000);
                  } finally {
                    setIsResuming(false);
                  }
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <PlayCircle className="w-3.5 h-3.5" />
                <span>{isResuming ? 'جاري الاستئناف...' : 'تأكيد استئناف البرنامج الآن'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

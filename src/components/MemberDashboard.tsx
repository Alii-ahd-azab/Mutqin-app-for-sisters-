import React, { useState, useMemo, useEffect } from 'react';
import {
  User,
  CycleInfo,
  RecitationLog,
  RevisionLog,
  GroupSettings,
  RestDay,
  PeerTest,
  PeerTestAttempt,
  DistantReviewAssignment,
  DistantReviewCompletion,
} from '../types';
import { isPeerTestLive } from '../lib/peerTests';
import { PeerTestCard } from './PeerTestCard';
import { PeerTestingModal } from './PeerTestingModal';
import { getQuarterInfo, getQuarterBounds, getRangeBounds } from '../data/quranData';
import {
  calculateMemberRequiredQuarter,
  getHijriDate,
  getActiveCycleDates,
  calculateMemberRevisionStatus,
  formatArabicDateWithDayName,
  getPreLaunchMessage,
  calculateCycleInfo,
  joinedOnDateFromTimestamp,
  calculateMemberDistantReviewStatus,
  SEVERE_DELAY_THRESHOLD,
  addDays,
  isPausedDate,
} from '../lib/calculations';
import { buildMemberNotifications, type MemberNotification, type MemberNotificationTarget } from '../lib/notifications';
import {
  BookOpen,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  BookmarkCheck,
  Calendar,
  Layers,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  UserX,
  Sparkles,
  CalendarClock,
  Compass,
  Lock,
  Headphones,
} from 'lucide-react';
import { RecitationModal, RevisionModal } from './Modals';
import { MemberHistoryView } from './MemberHistoryView';
import { CelebrationBanner, RestDayBanner, PauseBanner, DistantReviewBanner } from './Banners';
import { DistantReviewMemberCard } from './DistantReviewMemberCard';
import { DailyThoughtCard } from './DailyThoughtCard';

interface RevisionDayItem {
  date: string;
  isToday: boolean;
  isMissed: boolean;
  isReviewed: boolean;
  reviewStart: number;
  reviewEnd: number;
  reviewCount: number;
  dateLabel: string;
  surahStart: string;
  surahEnd: string;
  bounds: ReturnType<typeof getRangeBounds>;
  cycleInfoForDay: CycleInfo;
  // Rest / pause day with nothing owed: no new revision obligation today
  isNoObligationDay?: boolean;
}

interface MemberDashboardProps {
  currentUser: User;
  batchName?: string;
  // Scopes the notification keys.
  batchId?: string;
  cycleInfo: CycleInfo;
  settings?: GroupSettings;
  restDays?: RestDay[];
  allMembers: User[];
  recitations: RecitationLog[];
  revisions: RevisionLog[];
  // Live peer test(s) of her batch and her own peer-test attempts
  peerTests?: PeerTest[];
  peerTestAttempts?: PeerTestAttempt[];
  // «المراجعة البعيدة»: active cycle id, the batch's scheduled days and her completions
  cycleId?: string;
  distantReviews?: DistantReviewAssignment[];
  distantCompletions?: DistantReviewCompletion[];
  onCompleteDistantReview?: (assignmentId: string) => Promise<string>;
  onRecordRecitation: (payload: {
    quarter_number: number;
    listener_id: string;
    notes?: string;
  }) => Promise<void>;
  onCorrectListener: (submissionId: string, newListenerId: string) => Promise<void>;
  onRecordRevision: (payload: { notes?: string; date?: string }) => Promise<void>;
  onRefresh: () => void;
  loading: boolean;
  // Header bell: this dashboard's current notifications (derived from the statuses below).
  onNotificationsChange?: (items: MemberNotification[]) => void;
  // A notification was opened: bring its card into view (nonce: each click counts).
  focusRequest?: { target: MemberNotificationTarget; nonce: number } | null;
}

export const MemberDashboard: React.FC<MemberDashboardProps> = ({
  currentUser,
  batchName,
  batchId = '',
  cycleInfo,
  settings,
  restDays = [],
  allMembers,
  recitations,
  revisions,
  peerTests = [],
  peerTestAttempts = [],
  cycleId,
  distantReviews = [],
  distantCompletions = [],
  onCompleteDistantReview,
  onRecordRecitation,
  onCorrectListener,
  onRecordRevision,
  onRefresh,
  loading,
  onNotificationsChange,
  focusRequest,
}) => {
  const [isRecitationModalOpen, setIsRecitationModalOpen] = useState(false);
  const [isPeerTestOpen, setIsPeerTestOpen] = useState(false);
  const [isRevisionModalOpen, setIsRevisionModalOpen] = useState(false);
  const [activeRevisionIndex, setActiveRevisionIndex] = useState<number>(0);
  const [selectedRevisionTarget, setSelectedRevisionTarget] = useState<RevisionDayItem | null>(null);
  const [showHistory, setShowHistory] = useState(true);

  // Eligible peers for listener selection (exclude self and admins)
  const peerMembers = allMembers.filter(
    (m) => m.id !== currentUser.id && m.role === 'member' && m.is_active
  );

  // Today's revision status for current user
  const todayRevision = revisions.find(
    (r) => r.member_id === currentUser.id && r.date === cycleInfo.today_date
  );
  const hasReviewedToday = Boolean(todayRevision);

  // Calculate personal required quarter for current user
  const userQuarterStatus = calculateMemberRequiredQuarter(
    currentUser.id,
    cycleInfo.quarter_of_day,
    recitations
  );

  // Active program cycle dates (excluding rest days and pauses)
  const activeCycleDates = useMemo(() => {
    return getActiveCycleDates(
      cycleInfo.start_date,
      cycleInfo.today_date,
      restDays,
      settings
    );
  }, [cycleInfo.start_date, cycleInfo.today_date, restDays, settings]);

  // When she joined her current batch (from the batch's member list,
  // since the auth profile does not carry membership data).
  const joinedOnDate = useMemo(
    () =>
      joinedOnDateFromTimestamp(
        allMembers.find((m) => m.id === currentUser.id)?.batch_joined_at
      ),
    [allMembers, currentUser.id]
  );

  // Personal revision status for current user
  // (revision days before she joined this batch are not owed)
  const userRevisionStatus = useMemo(() => {
    return calculateMemberRevisionStatus(
      currentUser.id,
      activeCycleDates,
      revisions,
      cycleInfo.today_date,
      joinedOnDate
    );
  }, [currentUser.id, activeCycleDates, revisions, cycleInfo.today_date, joinedOnDate]);

  // «المراجعة البعيدة»: each scheduled day of the active cycle is its own obligation.
  const cycleDistantReviews = useMemo(
    () => distantReviews.filter((a) => a.cycle_id === cycleId),
    [distantReviews, cycleId]
  );
  const distantStatus = useMemo(
    () =>
      calculateMemberDistantReviewStatus(
        currentUser.id,
        settings && cycleInfo.has_started ? cycleDistantReviews : [],
        distantCompletions,
        settings || ({ start_date: cycleInfo.start_date } as GroupSettings),
        restDays,
        cycleInfo.today_date,
        joinedOnDate
      ),
    [currentUser.id, cycleDistantReviews, distantCompletions, settings, restDays, cycleInfo.today_date, cycleInfo.start_date, cycleInfo.has_started, joinedOnDate]
  );
  const todayDistant = cycleInfo.is_distant_review_day
    ? cycleDistantReviews.find((a) => a.review_date === cycleInfo.today_date)
    : undefined;
  // Her permanent distant-review log: completed ones (any cycle) and those still owed, newest first.
  const distantHistory = useMemo(() => {
    const items = new Map<string, { assignment: DistantReviewAssignment; completion?: DistantReviewCompletion }>();
    for (const c of distantCompletions) {
      if (c.member_id !== currentUser.id) continue;
      const a = distantReviews.find((x) => x.id === c.assignment_id);
      if (a) items.set(a.id, { assignment: a, completion: c });
    }
    for (const a of distantStatus.outstanding) if (!items.has(a.id)) items.set(a.id, { assignment: a });
    return [...items.values()].sort((x, y) => y.assignment.review_date.localeCompare(x.assignment.review_date));
  }, [distantCompletions, distantReviews, distantStatus.outstanding, currentUser.id]);
  // No new normal Tasmi'a/review today: rest day, pause, or a distant-review day.
  const isNonProgressDay = cycleInfo.is_rest_day || cycleInfo.is_paused || cycleInfo.is_distant_review_day;

  const pastMissedQuartersCount = userQuarterStatus.pastMissedQuartersCount;
  const pastMissedRevisionDaysCount = userRevisionStatus.pastMissedRevisionDaysCount;

  const isAllCaughtUp = userQuarterStatus.allCompletedUpToToday;

  // Peer testing: the batch's live test, her pass, and the mandatory block
  // (mirrors the database rule that rejects Tasmi'a beyond the range).
  const liveTest = peerTests.find((t) => isPeerTestLive(t)) || null;
  const hasPassedLiveTest = Boolean(
    liveTest &&
      peerTestAttempts.some(
        (a) => a.test_id === liveTest.id && a.candidate_id === currentUser.id && a.status === 'passed'
      )
  );
  const nextQuarterToRecite = isAllCaughtUp ? cycleInfo.quarter_of_day + 1 : userQuarterStatus.requiredQuarter;
  const isBlockedByPeerTest = Boolean(
    liveTest &&
      liveTest.test_type === 'mandatory' &&
      !hasPassedLiveTest &&
      cycleInfo.has_started &&
      nextQuarterToRecite > liveTest.range_end
  );
  const currentRecitationQuarterNum = isAllCaughtUp
    ? cycleInfo.quarter_of_day
    : userQuarterStatus.requiredQuarter;
  const requiredQuarterInfo = getQuarterInfo(userQuarterStatus.requiredQuarter);
  const groupQuarterInfo = getQuarterInfo(cycleInfo.quarter_of_day);
  const currentRecitationQuarterInfo = isAllCaughtUp ? groupQuarterInfo : requiredQuarterInfo;
  const recitationBounds = getQuarterBounds(currentRecitationQuarterNum);

  const reviewStartInfo = getQuarterInfo(cycleInfo.review_start);
  const reviewEndInfo = getQuarterInfo(cycleInfo.review_end);
  const revisionBounds = getRangeBounds(cycleInfo.review_start, cycleInfo.review_end);

  // Construct list of active revision days (past missed days in chronological order + today)
  const revisionDays: RevisionDayItem[] = useMemo(() => {
    if (!cycleInfo.has_started) return [];

    const items: RevisionDayItem[] = [];

    // 1. Past missed dates (active cycle dates before today without a revision log)
    for (const dStr of userRevisionStatus.pastMissedDates) {
      const dayCycle = calculateCycleInfo(
        settings || {
          id: '',
          start_date: cycleInfo.start_date,
          total_quarters: 240,
          review_window: 8,
          current_cycle_number: cycleInfo.current_cycle_number,
          is_paused: cycleInfo.is_paused,
          paused_at: cycleInfo.paused_at ?? null,
          total_paused_days: cycleInfo.paused_days_count,
        },
        restDays,
        dStr
      );

      const sInfo = getQuarterInfo(dayCycle.review_start);
      const eInfo = getQuarterInfo(dayCycle.review_end);
      const bounds = getRangeBounds(dayCycle.review_start, dayCycle.review_end);

      items.push({
        date: dStr,
        isToday: false,
        isMissed: true,
        isReviewed: false,
        reviewStart: dayCycle.review_start,
        reviewEnd: dayCycle.review_end,
        reviewCount: dayCycle.review_count,
        dateLabel: formatArabicDateWithDayName(dStr),
        surahStart: sInfo.surahName,
        surahEnd: eInfo.surahName,
        bounds,
        cycleInfoForDay: dayCycle,
      });
    }

    // 2. Today — only when today is an ACTIVE program day. Rest days and
    //    pause days create no new revision obligation.
    if (!userRevisionStatus.isTodayProgramDay) return items;

    const todayReviewBounds = getRangeBounds(cycleInfo.review_start, cycleInfo.review_end);
    items.push({
      date: cycleInfo.today_date,
      isToday: true,
      isMissed: false,
      isReviewed: hasReviewedToday,
      reviewStart: cycleInfo.review_start,
      reviewEnd: cycleInfo.review_end,
      reviewCount: cycleInfo.review_count,
      dateLabel: formatArabicDateWithDayName(cycleInfo.today_date),
      surahStart: reviewStartInfo.surahName,
      surahEnd: reviewEndInfo.surahName,
      bounds: todayReviewBounds,
      cycleInfoForDay: cycleInfo,
    });

    return items;
  }, [
    cycleInfo,
    settings,
    restDays,
    userRevisionStatus.pastMissedDates,
    userRevisionStatus.isTodayProgramDay,
    hasReviewedToday,
    reviewStartInfo.surahName,
    reviewEndInfo.surahName,
  ]);

  const clampedRevisionIndex = revisionDays.length === 0
    ? 0
    : Math.min(Math.max(0, activeRevisionIndex), revisionDays.length - 1);

  // Nothing in the list happens only on a rest/pause day with no past debt:
  // the last active day's revision is done and there is no new obligation.
  const isNoObligationDay = revisionDays.length === 0 && !userRevisionStatus.isTodayProgramDay;
  const currentRevisionItem: RevisionDayItem = revisionDays[clampedRevisionIndex] || {
    date: cycleInfo.today_date,
    isToday: true,
    isMissed: false,
    isReviewed: isNoObligationDay || hasReviewedToday,
    isNoObligationDay,
    reviewStart: cycleInfo.review_start,
    reviewEnd: cycleInfo.review_end,
    reviewCount: cycleInfo.review_count,
    dateLabel: 'اليوم',
    surahStart: reviewStartInfo.surahName,
    surahEnd: reviewEndInfo.surahName,
    bounds: revisionBounds,
    cycleInfoForDay: cycleInfo,
  };

  // Member's all-time statistics across the course
  const memberCourseStats = useMemo(() => {
    const totalRecitations = recitations.filter(
      (r) => r.member_id === currentUser.id || r.reciter_id === currentUser.id
    ).length;
    const totalRevisions = revisions.filter((r) => r.member_id === currentUser.id).length;
    const totalTimesListened = recitations.filter(
      (r) => r.listener_id === currentUser.id && (r.member_id || r.reciter_id) !== currentUser.id
    ).length;
    return {
      totalRecitations,
      totalRevisions,
      totalTimesListened,
    };
  }, [recitations, revisions, currentUser.id]);

  // The alert banner should ONLY appear if there is an ACTUAL delay from past days:
  // i.e., user is behind on quarters before today (userQuarterStatus.isBehind) OR missed revision on a previous day.
  // Today's ongoing recitation or today's revision are NOT considered overdue/delayed during the day.
  const hasActualPastDelay =
    userQuarterStatus.isBehind || pastMissedRevisionDaysCount > 0 || distantStatus.overdueCount > 0;

  // Tomorrow = the next program date (starts at 05:00 Cairo): its scheduled rest day or distant review.
  const tomorrowDate = addDays(cycleInfo.today_date, 1);
  const tomorrowInCycle = !!settings && tomorrowDate >= cycleInfo.start_date && !(joinedOnDate && tomorrowDate < joinedOnDate);
  // A scheduled distant review takes priority and is not cancelled by a pause or a rest day.
  const tomorrowDistant =
    tomorrowInCycle && currentUser.is_active ? cycleDistantReviews.find((a) => a.review_date === tomorrowDate) : undefined;
  const tomorrowRest =
    tomorrowInCycle && !tomorrowDistant && !isPausedDate(settings, tomorrowDate) ? restDays.find((r) => r.date === tomorrowDate) : undefined;

  // Header notifications: read from the statuses above (the same numbers this dashboard shows).
  const notifications = useMemo(
    () =>
      buildMemberNotifications({
        batchId,
        today: cycleInfo.today_date,
        isActive: currentUser.is_active,
        hasStarted: cycleInfo.has_started,
        isCompleted: cycleInfo.is_completed,
        isRestDay: cycleInfo.is_rest_day,
        restDayNote: cycleInfo.rest_day_note,
        tasmia: { pastMissedCount: pastMissedQuartersCount, requiredQuarter: userQuarterStatus.requiredQuarter },
        revision: { pastMissedDates: userRevisionStatus.pastMissedDates },
        distant: {
          overdue: distantStatus.overdue,
          todayAssignment: distantStatus.todayAssignment,
          hasCompletedToday: distantStatus.hasCompletedToday,
        },
        tomorrow: { restDay: tomorrowRest ? { note: tomorrowRest.note } : null, distant: tomorrowDistant ?? null },
      }),
    [
      batchId,
      tomorrowRest,
      tomorrowDistant,
      cycleInfo.today_date,
      cycleInfo.has_started,
      cycleInfo.is_completed,
      cycleInfo.is_rest_day,
      cycleInfo.rest_day_note,
      currentUser.is_active,
      pastMissedQuartersCount,
      userQuarterStatus.requiredQuarter,
      userRevisionStatus.pastMissedDates,
      distantStatus,
    ]
  );
  useEffect(() => {
    onNotificationsChange?.(notifications);
  }, [notifications, onNotificationsChange]);

  // Opening a notification: select its day and bring its card into view, briefly highlighted.
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!focusRequest) return;
    const t = focusRequest.target;
    let elementId = 'tasmia-card';
    if (t.kind === 'revision') {
      const at = revisionDays.findIndex((d) => d.date === t.date);
      if (at >= 0) setActiveRevisionIndex(at);
      elementId = 'revision-card';
    } else if (t.kind === 'distant') {
      elementId = 'distant-review-card';
    } else if (t.kind === 'rest-day') {
      elementId = 'rest-day-banner';
    } else if (t.kind === 'overview') {
      elementId = 'day-overview';
    }
    setFlash(elementId);
    const frame = window.requestAnimationFrame(() =>
      document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    );
    const timer = window.setTimeout(() => setFlash(null), 2600);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce]);

  return (
    <div className="space-y-6 pb-12">
      {/* Day Overview Top Card (المستطيل الوردي الأنيق في أول الصفحة دائماً) */}
      <div id="day-overview" className={`${flash === 'day-overview' ? 'notification-focus ' : ''}bg-gradient-to-l from-rose-900 via-rose-800 to-pink-900 text-white rounded-3xl p-6 sm:p-8 shadow-md border border-pink-400/20`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-pink-950/40 text-pink-100 text-xs font-semibold border border-pink-400/30">
                <Sparkles className="w-3.5 h-3.5 text-pink-300 shrink-0" />
                <span>أهلًا بكِ يا {currentUser.name.trim().split(/\s+/)[0]}، بارك الله في وقتكِ مع كتاب الله</span>
              </div>
              {batchName && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-white text-xs font-bold border border-white/20">
                  <Layers className="w-3.5 h-3.5 text-pink-200 shrink-0" />
                  <span>{batchName}</span>
                </span>
              )}
            </div>
            {cycleInfo.has_started ? (
              <>
                <h2 className="text-2xl sm:text-3xl font-bold font-quran text-pink-100 tracking-tight">
                  اليوم رقم {cycleInfo.cycle_day}
                </h2>
                <p className="text-pink-100/90 text-xs sm:text-sm">
                  التاريخ: {getHijriDate(cycleInfo.today_date)} (الموافق {cycleInfo.today_date}م)
                </p>
              </>
            ) : (
              <>
                <h2 className="text-2xl sm:text-3xl font-bold font-quran text-pink-100 tracking-tight">
                  البرنامج لم يبدأ بعد
                </h2>
                <p className="text-pink-100/90 text-xs sm:text-sm">
                  الانطلاق المقرر: <strong>{formatArabicDateWithDayName(cycleInfo.start_date)}</strong> (الساعة 5:00 صباحًا بتوقيت القاهرة) • التاريخ اليوم: {getHijriDate(cycleInfo.today_date)} (الموافق {cycleInfo.today_date}م)
                </p>
              </>
            )}
          </div>
        </div>

        {/* Member Course Stats Ribbon since beginning of cycle */}
        {cycleInfo.has_started && (
          <div className="mt-5 pt-4 border-t border-pink-500/30 grid grid-cols-3 gap-2 sm:gap-3 text-center">
            <div className="bg-pink-950/40 rounded-2xl p-2.5 sm:p-3 border border-pink-400/20">
              <span className="text-[11px] text-pink-200 block">التسميع المنجز</span>
              <span className="text-base sm:text-lg font-bold font-mono text-pink-100">
                {memberCourseStats.totalRecitations} <span className="text-[10px] text-pink-300 font-sans font-normal">ربع</span>
              </span>
            </div>
            <div className="bg-pink-950/40 rounded-2xl p-2.5 sm:p-3 border border-pink-400/20">
              <span className="text-[11px] text-pink-200 block">المراجعة المؤكدة</span>
              <span className="text-base sm:text-lg font-bold font-mono text-pink-100">
                {memberCourseStats.totalRevisions} <span className="text-[10px] text-pink-300 font-sans font-normal">يوم</span>
              </span>
            </div>
            <div className="bg-pink-950/40 rounded-2xl p-2.5 sm:p-3 border border-pink-400/20">
              <span className="text-[11px] text-pink-200 flex items-center justify-center gap-1">
                <Headphones className="w-3 h-3 text-pink-300 shrink-0" />
                <span>الاستماع للأخوات</span>
              </span>
              <span className="text-base sm:text-lg font-bold font-mono text-pink-100">
                {memberCourseStats.totalTimesListened} <span className="text-[10px] text-pink-300 font-sans font-normal">جلسة</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Daily Thought from Admin (خاطرة اليوم) - Automatically hides completely if empty */}
      <DailyThoughtCard
        thoughtHtml={settings?.daily_thought}
        updatedAt={settings?.daily_thought_updated_at}
        updatedBy={settings?.daily_thought_updated_by}
      />

      {/* Peer Testing (اختبار الزميلات): live test of her batch */}
      {liveTest && currentUser.is_active && (
        <PeerTestCard
          test={liveTest}
          hasPassed={hasPassedLiveTest}
          isBlocked={isBlockedByPeerTest}
          onStart={() => setIsPeerTestOpen(true)}
        />
      )}

      {/* Celebration banner if day >= 240 */}
      {cycleInfo.is_completed && (
        <CelebrationBanner currentCycle={cycleInfo.current_cycle_number} isAdmin={false} />
      )}

      {/* Program Pause Banner */}
      {cycleInfo.is_paused && <PauseBanner pausedAt={cycleInfo.paused_at} />}

      {/* Rest Day banner */}
      {cycleInfo.is_rest_day && <RestDayBanner note={cycleInfo.rest_day_note} highlight={flash === 'rest-day-banner'} />}

      {/* «المراجعة البعيدة» banner: normal progression is paused today */}
      {cycleInfo.is_distant_review_day && (
        <DistantReviewBanner start={todayDistant?.start_quarter} end={todayDistant?.end_quarter} note={todayDistant?.note} />
      )}

      {/* Exclusion / Suspension Notice Banner */}
      {!currentUser.is_active && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-5 flex items-start gap-3.5 shadow-xs">
          <div className="p-2.5 bg-rose-100 rounded-xl text-rose-700 shrink-0 mt-0.5">
            <UserX className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-sm text-rose-950">
              حسابك مُعلّق (مُقصَى) حاليًا بقرار من المشرف
            </h3>
            <p className="text-xs text-rose-800 leading-relaxed">
              أنت في فترة إقصاء مؤقتة، ولا يمكنك تسجيل التسميع أو تأكيد المراجعة حتى يقوم المشرف بإعادة تفعيل حسابك. يستمر جدول المجموعة وربع اليوم في التقدّم بشكل طبيعي، وعند تفعيلك مجددًا ستتمكن من مواصلة التسميع واستدراك جميع الأرباع الفائتة تباعًا.
            </p>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* UNIFIED DELAY ALERT (مستطيل التنبيه بالتأخر الفعلي عن أيام سابقة) */}
      {/* Appears ONLY if the member is actually behind on past days (recitation or revision) */}
      {/* =================================================================== */}
      {currentUser.is_active && cycleInfo.has_started && !cycleInfo.is_completed && hasActualPastDelay && (
        <div
          id="member-unified-delay-alert"
          className="rounded-2xl bg-amber-500/10 border-2 border-amber-500/40 p-4 sm:p-5 flex items-start gap-3.5 shadow-xs animate-in fade-in duration-200"
        >
          <div className="p-2.5 bg-amber-500/20 text-amber-900 rounded-xl shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5 text-amber-800" />
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-sm text-amber-950">
                تنبيه بوجود أوراد متأخرة يلزم استدراكها
              </h3>
              {(pastMissedQuartersCount >= SEVERE_DELAY_THRESHOLD || pastMissedRevisionDaysCount >= SEVERE_DELAY_THRESHOLD) ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-200 text-rose-900 border border-rose-300">
                  تأخر حرج (يلزم الاستدراك لتجنب الإقصاء)
                </span>
              ) : (pastMissedQuartersCount >= 1 || pastMissedRevisionDaysCount >= 1) ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 text-amber-900 border border-amber-300">
                  يلزم الاستدراك
                </span>
              ) : null}
            </div>

            <div className="text-xs text-amber-900 space-y-1.5 leading-relaxed font-medium">
              {/* Recitation Delay: only if user is actually behind quarters before today */}
              {userQuarterStatus.isBehind && (
                <p className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-700 mt-1.5 shrink-0" />
                  <span>
                    لديك <strong>{pastMissedQuartersCount} {pastMissedQuartersCount === 1 ? 'ربع تسميع فائت' : pastMissedQuartersCount === 2 ? 'ربعين تسميع فائتين' : 'أرباع تسميع فائتة'}</strong> من أيام سابقة — الربع المطلوب منك استدراكه الآن: <strong>الربع {userQuarterStatus.requiredQuarter}</strong>
                    {userQuarterStatus.requiredQuarter !== cycleInfo.quarter_of_day && (
                      <span className="text-amber-800/80"> (ربع المقرأة لليوم الحالي: الربع {cycleInfo.quarter_of_day})</span>
                    )}
                  </span>
                </p>
              )}

              {/* «المراجعة البعيدة» debt: counted separately from the daily review */}
              {distantStatus.overdueCount > 0 && (
                <p id="distant-overdue-alert" className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-700 mt-1.5 shrink-0" />
                  <span>
                    مراجعات بعيدة متأخرة: <strong>{distantStatus.overdueCount}</strong> — يلزم تأكيدها من بطاقة «المراجعة البعيدة».
                  </span>
                </p>
              )}

              {/* Revision Delay: only if past days of revision were missed */}
              {pastMissedRevisionDaysCount > 0 && (
                <p className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-700 mt-1.5 shrink-0" />
                  <span>
                    فاتتك مراجعة <strong>{pastMissedRevisionDaysCount} {pastMissedRevisionDaysCount === 1 ? 'يوم سابق' : pastMissedRevisionDaysCount === 2 ? 'يومين سابقين' : 'أيام سابقة'}</strong> لم يتم تأكيدها.
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The 2 Primary Action Cards (Memorization & Revision) OR Pre-launch Readiness Card */}
      {!cycleInfo.has_started ? (
        /* Pre-launch Readiness Card (يظهر في مكان ربع اليوم قبل موعد انطلاق البرنامج) */
        <div className="bg-white rounded-3xl border border-stone-200 shadow-sm p-6 sm:p-8 space-y-6 relative overflow-hidden transition hover:shadow-md">
          {/* Header & Dynamic Message */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-100 pb-5">
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-800 flex items-center justify-center shrink-0 mt-0.5 border border-amber-200/60">
                <CalendarClock className="w-6 h-6 text-amber-700" />
              </div>
              <div className="space-y-1.5">
                <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-900 border border-amber-200">
                  <Clock className="w-3.5 h-3.5 text-amber-700" />
                  <span>مرحلة الاستعداد والترقب</span>
                </span>
                <h3 className="text-xl sm:text-2xl font-bold font-quran text-stone-900 leading-snug">
                  {getPreLaunchMessage(cycleInfo.days_until_start, cycleInfo.start_date)}
                </h3>
              </div>
            </div>
          </div>

          {/* Details & Explanation */}
          <div className="space-y-4">
            <div className="p-4 sm:p-5 rounded-2xl bg-stone-50 border border-stone-200/80 space-y-2.5">
              <div className="flex items-center gap-2 text-stone-900 font-bold text-sm">
                <Compass className="w-4 h-4 text-emerald-700" />
                <span>تفاصيل وموعد الانطلاق الرسمي:</span>
              </div>
              <p className="text-xs sm:text-sm text-stone-700 leading-relaxed">
                يبدأ احتساب <strong>اليوم الأول (الربع رقم 1)</strong> تلقائيًا يوم <strong>{formatArabicDateWithDayName(cycleInfo.start_date)}</strong> في تمام الساعة <strong>5:00 صباحًا بتوقيت القاهرة</strong>. عند حلول هذا التاريخ، سيظهر ربع اليوم وتُفعَّل خيارات تسجيل التسميع وتأكيد المراجعة اليومية لكافة أعضاء المقرأة دون الحاجة لأي تدخل يدوي.
              </p>
            </div>

            {/* Preparation Guidance */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-2xl bg-emerald-50/60 border border-emerald-100 text-right space-y-1">
                <div className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>1. مراجعة الربع الأول</span>
                </div>
                <p className="text-[11px] text-emerald-800/90 leading-relaxed">
                  استذكار الربع الأول من سورة البقرة لتكون على أتم الجاهزية للتسميع فور بدء البرنامج.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-emerald-50/60 border border-emerald-100 text-right space-y-1">
                <div className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>2. التنسيق مع الزميل</span>
                </div>
                <p className="text-[11px] text-emerald-800/90 leading-relaxed">
                  التواصل المسبق مع أحد الزملاء في المقرأة للاتفاق على طريقة ووقت جلسة التسميع.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-emerald-50/60 border border-emerald-100 text-right space-y-1">
                <div className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                  <BookmarkCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>3. استحضار النية</span>
                </div>
                <p className="text-[11px] text-emerald-800/90 leading-relaxed">
                  تجديد العهد وسؤال الله التوفيق والبركة والاستمرار في هذه الختمة المباركة.
                </p>
              </div>
            </div>

            {/* Waiting State Notice */}
            <div className="p-3.5 sm:p-4 rounded-2xl bg-stone-100 border border-stone-200 text-stone-600 text-xs sm:text-sm font-medium flex items-center justify-center gap-2 text-center">
              <Clock className="w-4 h-4 text-amber-700 shrink-0" />
              <span>أزرار تسجيل التسميع والمراجعة معطلة ومحجوبة حاليًا — ستتاح تلقائيًا بمجرد حلول موعد البداية ({formatArabicDateWithDayName(cycleInfo.start_date)})</span>
            </div>
          </div>
        </div>
      ) : (
        <>
        {/* «المراجعة البعيدة»: today's assigned range and every missed one (separate from the daily review) */}
        {onCompleteDistantReview && (distantStatus.outstanding.length > 0 || distantStatus.todayAssignment) && (
          <DistantReviewMemberCard
            status={distantStatus}
            today={cycleInfo.today_date}
            isActive={currentUser.is_active}
            onComplete={onCompleteDistantReview}
            focus={
              focusRequest?.target.kind === 'distant'
                ? { assignmentId: focusRequest.target.assignmentId, nonce: focusRequest.nonce }
                : null
            }
            highlight={flash === 'distant-review-card'}
          />
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* CARD 1: ورد المراجعة اليومي (يظهر على اليمين في تخطيط RTL) */}
        <div id="revision-card" className={`${flash === 'revision-card' ? 'notification-focus ' : ''}bg-white rounded-3xl border ${currentRevisionItem.isMissed ? 'border-amber-200 ring-1 ring-amber-200/50' : 'border-stone-200'} shadow-sm p-6 flex flex-col justify-between relative overflow-hidden transition hover:shadow-md`}>
          <div className="space-y-4">
            {/* Header / Carousel Navigation */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <div className={`w-10 h-10 rounded-2xl ${currentRevisionItem.isMissed ? 'bg-amber-100 text-amber-900' : 'bg-amber-50 text-amber-800'} flex items-center justify-center font-bold`}>
                  {currentRevisionItem.isMissed ? (
                    <Clock className="w-5 h-5 text-amber-700" />
                  ) : (
                    <BookmarkCheck className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-stone-900 text-base">
                    {currentRevisionItem.isMissed
                      ? `مراجعة متأخرة — ${currentRevisionItem.dateLabel}`
                      : 'ورد المراجعة اليومي'}
                  </h3>
                  <p className="text-xs text-stone-500">
                    {currentRevisionItem.isMissed
                      ? 'استدراك ورد فائت لم يُؤكَّد في موعده'
                      : 'مراجعة فردية للأرباع السابقة'}
                  </p>
                </div>
              </div>

              {/* Status Badge */}
              {currentRevisionItem.isNoObligationDay ? (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-stone-100 text-stone-700 border border-stone-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-stone-500" />
                  لا مراجعة جديدة اليوم
                </span>
              ) : currentRevisionItem.isReviewed ? (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  تمت المراجعة
                </span>
              ) : currentRevisionItem.isMissed ? (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                  <Clock className="w-3.5 h-3.5 text-amber-700" />
                  متأخر
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-stone-100 text-stone-700 border border-stone-200">
                  <Clock className="w-3.5 h-3.5 text-stone-600" />
                  لم تُؤكَّد بعد اليوم
                </span>
              )}
            </div>

            {/* Carousel Controls when multiple days exist */}
            {revisionDays.length > 1 && (
              <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs text-amber-950 font-bold">
                  <span className="px-2 py-0.5 rounded-md bg-white border border-amber-200 shadow-2xs">
                    {clampedRevisionIndex + 1} من {revisionDays.length}
                  </span>
                  <span className="text-[11px] text-amber-800 font-normal">
                    {currentRevisionItem.isMissed ? `(استدراك ${currentRevisionItem.dateLabel})` : '(ورد اليوم)'}
                  </span>
                </div>

                {/* Navigation arrows (◀ ▶) */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveRevisionIndex((prev) => Math.max(0, prev - 1))}
                    disabled={clampedRevisionIndex === 0}
                    title="اليوم السابق"
                    className="p-1.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:hover:bg-white text-stone-700 transition cursor-pointer disabled:cursor-not-allowed shadow-2xs"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-1 px-1">
                    {revisionDays.map((d, idx) => (
                      <button
                        key={d.date}
                        type="button"
                        onClick={() => setActiveRevisionIndex(idx)}
                        className={`h-2 rounded-full transition-all ${
                          idx === clampedRevisionIndex
                            ? 'w-4 bg-amber-700'
                            : 'w-2 bg-amber-300 hover:bg-amber-400'
                        }`}
                        title={d.isMissed ? `متأخر: ${d.dateLabel}` : 'اليوم'}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveRevisionIndex((prev) => Math.min(revisionDays.length - 1, prev + 1))}
                    disabled={clampedRevisionIndex === revisionDays.length - 1}
                    title="اليوم التالي"
                    className="p-1.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:hover:bg-white text-stone-700 transition cursor-pointer disabled:cursor-not-allowed shadow-2xs"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Review Range Box */}
            <div className="p-4 rounded-2xl bg-stone-50 border border-stone-100 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-stone-500">
                <span>
                  {currentRevisionItem.isMissed
                    ? `مدى المراجعة ليوم ${currentRevisionItem.dateLabel}:`
                    : 'مدى المراجعة لليوم:'}
                </span>
                <span className="text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                  {currentRevisionItem.reviewCount} {currentRevisionItem.reviewCount === 1 ? 'ربع واحد' : 'أرباع'}
                </span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-stone-200/60 flex items-center justify-between text-center">
                <div className="flex-1">
                  <div className="text-[10px] text-stone-400">من الربع</div>
                  <div className="text-lg font-bold text-stone-900">{currentRevisionItem.reviewStart}</div>
                  <div className="text-[11px] text-stone-500 font-quran">{currentRevisionItem.surahStart}</div>
                </div>

                <div className="text-stone-300 text-sm">◀ ◀</div>

                <div className="flex-1">
                  <div className="text-[10px] text-stone-400">إلى الربع</div>
                  <div className="text-lg font-bold text-stone-900">{currentRevisionItem.reviewEnd}</div>
                  <div className="text-[11px] text-stone-500 font-quran">{currentRevisionItem.surahEnd}</div>
                </div>
              </div>

              {/* بداية ونهاية مدى المراجعة (ابدأ من / توقف عند مع نص الآيات) */}
              <div className="text-xs bg-white p-3 rounded-2xl border border-stone-200/80 space-y-2">
                <div className="space-y-1">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-bold text-emerald-800 shrink-0">ابدأي من:</span>
                    <span className="font-bold text-stone-900">{currentRevisionItem.bounds.start.label}</span>
                    <span className="font-quran text-xs sm:text-sm text-emerald-900 font-medium">
                      ﴿ {currentRevisionItem.bounds.start.ayahText}... ﴾
                    </span>
                  </div>
                </div>
                <div className="border-t border-stone-100 pt-2 space-y-1">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-bold text-rose-700 shrink-0">توقفي عند:</span>
                    <span className="font-bold text-stone-900">{currentRevisionItem.bounds.stop.label}</span>
                    <span className="font-quran text-xs sm:text-sm text-rose-700 font-medium">
                      ﴿ {currentRevisionItem.bounds.stop.ayahText}{currentRevisionItem.bounds.stop.isEndNotice ? '' : '...'} ﴾
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-stone-500 text-center">
                {currentRevisionItem.isMissed
                  ? `💡 هذا الورد يخص يوم ${currentRevisionItem.dateLabel}. عند تأكيده سيتم تسجيل مراجعتك لهذا اليوم المتأخر.`
                  : 'تبدأ المراجعة بربع واحد في اليوم الأول وتتسع حتى 8 أرباع ثم تنزلق يوميًا'}
              </p>
            </div>
          </div>

          {/* Action Button: Member logs revision for himself */}
          <div className="pt-5">
            {!currentUser.is_active ? (
              <button
                id="open-revision-modal-btn"
                disabled
                className="w-full py-3.5 px-4 rounded-2xl font-bold text-sm shadow-xs transition flex items-center justify-center gap-2 bg-rose-50 text-rose-700 border border-rose-200 cursor-not-allowed"
              >
                <UserX className="w-4 h-4" />
                <span>حسابك مُقصَى حاليًا — لا يمكن تأكيد المراجعة</span>
              </button>
            ) : currentRevisionItem.isNoObligationDay ? (
              <div
                id="revision-no-obligation-status"
                className="w-full py-3.5 px-4 rounded-2xl font-bold text-sm transition flex items-center justify-center gap-2 bg-stone-50 text-stone-700 border border-stone-200 shadow-2xs text-center"
              >
                <CheckCircle2 className="w-4 h-4 text-stone-500 shrink-0" />
                <span>
                  {cycleInfo.is_distant_review_day
                    ? 'اليوم يوم مراجعة بعيدة'
                    : cycleInfo.is_paused
                    ? 'البرنامج متوقف مؤقتًا'
                    : 'اليوم يوم راحة'}{' '}
                  — لا توجد مراجعة يومية جديدة، وأنتِ مواكِبة لورد آخر يوم نشط
                </span>
              </div>
            ) : currentRevisionItem.isReviewed ? (
              <div
                id="revision-completed-status"
                className="w-full py-3.5 px-4 rounded-2xl font-bold text-sm transition flex items-center justify-center gap-2 bg-pink-50 text-pink-800 border border-pink-200 shadow-2xs"
              >
                <CheckCircle2 className="w-4 h-4 text-pink-600" />
                <span>تم تأكيد مراجعة اليوم بفضل الله</span>
              </div>
            ) : currentRevisionItem.isMissed ? (
              <button
                id="open-revision-modal-btn"
                onClick={() => {
                  setSelectedRevisionTarget(currentRevisionItem);
                  setIsRevisionModalOpen(true);
                }}
                className="w-full py-3.5 px-4 rounded-2xl font-bold text-sm shadow-xs transition flex items-center justify-center gap-2 bg-rose-700 hover:bg-rose-800 text-white cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>تأكيد مراجعة {currentRevisionItem.dateLabel} (متأخر)</span>
              </button>
            ) : (
              <button
                id="open-revision-modal-btn"
                onClick={() => {
                  setSelectedRevisionTarget(currentRevisionItem);
                  setIsRevisionModalOpen(true);
                }}
                className="w-full py-3.5 px-4 rounded-2xl font-bold text-sm shadow-xs transition flex items-center justify-center gap-2 bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 text-white cursor-pointer active:scale-98"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>تأكيد إتمام المراجعة اليومية</span>
              </button>
            )}
          </div>
        </div>

        {/* CARD 2: ورد الحفظ والتسميع (يظهر على اليسار في تخطيط RTL) */}
        <div id="tasmia-card" className={`${flash === 'tasmia-card' ? 'notification-focus ' : ''}bg-white rounded-3xl border border-stone-200/90 shadow-sm p-6 flex flex-col justify-between relative overflow-hidden transition hover:shadow-md`}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-2xl bg-pink-50 text-pink-700 flex items-center justify-center font-bold">
                  <BookOpen className="w-5 h-5 text-pink-600" />
                </div>
                <div>
                  <h3 className="font-bold text-stone-900 text-base">ورد التسميع</h3>
                  <p className="text-xs text-stone-500">
                    {isAllCaughtUp
                      ? isNonProgressDay
                        ? 'مواكبة لجميع الأرباع حتى ربع آخر نشاط'
                        : 'أتممتِ جميع الأرباع حتى اليوم'
                      : isNonProgressDay
                      ? 'يمكنكِ استدراك الأرباع الفائتة الآن'
                      : 'سجّلي إتمامكِ للربع المطلوب'}
                  </p>
                </div>
              </div>

              {/* Status Badge */}
              {isAllCaughtUp ? (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-pink-50 text-pink-700 border border-pink-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-pink-600" />
                  {isNonProgressDay
                    ? `مواكبة لآخر نشاط (الربع ${cycleInfo.quarter_of_day})`
                    : `مواكبة للخطة (الربع ${cycleInfo.quarter_of_day})`}
                </span>
              ) : userQuarterStatus.isBehind ? (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  متأخر ({pastMissedQuartersCount} {pastMissedQuartersCount === 1 ? 'ربع' : 'أرباع'})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-stone-100 text-stone-700 border border-stone-200">
                  <Clock className="w-3.5 h-3.5 text-stone-600" />
                  {isNonProgressDay
                    ? `مطلوب استدراك الربع ${cycleInfo.quarter_of_day}`
                    : 'ورد اليوم بانتظار التسميع'}
                </span>
              )}
            </div>

            {/* Quarter Info Box */}
            <div className="p-4 rounded-2xl bg-stone-50/80 border border-stone-100 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold text-stone-500">
                  {isAllCaughtUp
                    ? isNonProgressDay
                      ? 'ربع آخر يوم نشاط للمجموعة:'
                      : 'آخر ربع مقرر للمجموعة اليوم:'
                    : userQuarterStatus.isBehind
                    ? 'الربع المطلوب منكِ تسميعه الآن (تعويض سابق):'
                    : isNonProgressDay
                    ? 'الربع المطلوب تسميعه (استدراك):'
                    : 'الربع المطلوب تسميعه اليوم:'}
                </span>
                <span
                  className={`text-sm font-bold ${
                    isAllCaughtUp
                      ? 'text-pink-700'
                      : userQuarterStatus.isBehind
                      ? 'text-amber-800'
                      : 'text-pink-700'
                  }`}
                >
                  الربع رقم {isAllCaughtUp ? cycleInfo.quarter_of_day : userQuarterStatus.requiredQuarter}
                </span>
              </div>

              {userQuarterStatus.isBehind && !isAllCaughtUp && (
                <div className="text-[11px] bg-amber-50 text-amber-900 border border-amber-200 rounded-lg p-2 font-medium">
                  ⚠️ ربع المجموعة الحالي لليوم هو <strong>{cycleInfo.quarter_of_day}</strong>. نظرًا لعدم تسجيل أرباع سابقة، يلزمك تسميع الربع <strong>{userQuarterStatus.requiredQuarter}</strong> أولاً.
                </div>
              )}

              <div className="font-quran text-lg text-stone-900 font-bold">
                سورة {currentRecitationQuarterInfo.surahName} (الجزء {currentRecitationQuarterInfo.juz})
              </div>

              {/* بداية ونهاية الربع (ابدأ من / توقف عند مع نص الآيات) */}
              <div className="text-xs bg-white p-3 rounded-2xl border border-stone-200/80 space-y-2">
                <div className="space-y-1">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-bold text-emerald-800 shrink-0">ابدأي من:</span>
                    <span className="font-bold text-stone-900">{recitationBounds.start.label}</span>
                    <span className="font-quran text-xs sm:text-sm text-emerald-800 font-medium">
                      ﴿ {recitationBounds.start.ayahText}... ﴾
                    </span>
                  </div>
                </div>
                <div className="border-t border-stone-100 pt-2 space-y-1">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-bold text-rose-700 shrink-0">توقفي عند:</span>
                    <span className="font-bold text-stone-900">{recitationBounds.stop.label}</span>
                    <span className="font-quran text-xs sm:text-sm text-rose-700 font-medium">
                      ﴿ {recitationBounds.stop.ayahText}{recitationBounds.stop.isEndNotice ? '' : '...'} ﴾
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Button: Member registers for themselves */}
          <div className="pt-5 space-y-2">
            <button
              id="open-recitation-modal-btn"
              onClick={() => {
                if (!currentUser.is_active || isBlockedByPeerTest) return;
                setIsRecitationModalOpen(true);
              }}
              disabled={isAllCaughtUp || !currentUser.is_active || isBlockedByPeerTest}
              className={`w-full py-3.5 px-4 rounded-2xl font-bold text-sm shadow-sm transition flex items-center justify-center gap-2 ${
                !currentUser.is_active
                  ? 'bg-rose-50 text-rose-700 border border-rose-200 cursor-not-allowed'
                  : isBlockedByPeerTest
                  ? 'bg-rose-50 text-rose-700 border border-rose-200 cursor-not-allowed'
                  : isAllCaughtUp
                  ? 'bg-stone-100 text-stone-400 border border-stone-200 cursor-not-allowed'
                  : userQuarterStatus.isBehind
                  ? 'bg-amber-600 hover:bg-amber-700 text-white cursor-pointer'
                  : 'bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 text-white cursor-pointer active:scale-98'
              }`}
            >
              {!currentUser.is_active ? (
                <>
                  <UserX className="w-4 h-4" />
                  <span>حسابك مُقصَى حاليًا — لا يمكن تسجيل التسميع</span>
                </>
              ) : isBlockedByPeerTest ? (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  <span>مطلوب اجتياز الاختبار الإلزامي أولاً لمواصلة التسميع</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {isAllCaughtUp
                      ? isNonProgressDay
                        ? `مواكبة لجميع الأرباع حتى ربع آخر نشاط (${cycleInfo.quarter_of_day})`
                        : 'أتممتِ ربع اليوم'
                      : userQuarterStatus.isBehind
                      ? `استدراك تسميع الربع ${userQuarterStatus.requiredQuarter} (سابق)`
                      : isNonProgressDay
                      ? `تسجيل تسميع الربع ${cycleInfo.quarter_of_day} (استدراك)`
                      : `تسجيل تسميع الربع ${userQuarterStatus.requiredQuarter}`}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
        </>
      )}

      {/* History section - Clean collapsible */}
      <div className="pt-2">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full py-3 px-4 rounded-2xl bg-white hover:bg-stone-50 border border-stone-200/80 text-stone-700 text-xs font-bold flex items-center justify-between transition shadow-2xs"
        >
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-700" />
            <span>سجل نشاطاتي السابقة (التسميعات والمراجعات)</span>
          </div>
          <div className="flex items-center gap-1 text-stone-500">
            <span>{showHistory ? 'إخفاء' : 'عرض السجل'}</span>
            {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {showHistory && (
          <div className="mt-3 animate-in fade-in duration-150">
            <MemberHistoryView
              currentUser={currentUser}
              recitations={recitations}
              revisions={revisions}
              peerMembers={peerMembers}
              onCorrectListener={onCorrectListener}
              distantHistory={distantHistory}
            />
          </div>
        )}
      </div>

      {/* Modals */}
      {liveTest && (
        <PeerTestingModal
          isOpen={isPeerTestOpen}
          onClose={() => setIsPeerTestOpen(false)}
          currentUser={currentUser}
          test={liveTest}
          onCompleted={onRefresh}
        />
      )}

      <RecitationModal
        isOpen={isRecitationModalOpen}
        onClose={() => setIsRecitationModalOpen(false)}
        onSubmit={onRecordRecitation}
        currentUser={currentUser}
        members={peerMembers}
        cycleInfo={cycleInfo}
        recitations={recitations}
        loading={loading}
      />

      <RevisionModal
        isOpen={isRevisionModalOpen}
        onClose={() => {
          setIsRevisionModalOpen(false);
          setSelectedRevisionTarget(null);
        }}
        onSubmit={onRecordRevision}
        cycleInfo={cycleInfo}
        loading={loading}
        targetDate={selectedRevisionTarget?.date}
        targetDateLabel={selectedRevisionTarget?.dateLabel}
        isMissedDay={selectedRevisionTarget?.isMissed}
        reviewStart={selectedRevisionTarget?.reviewStart}
        reviewEnd={selectedRevisionTarget?.reviewEnd}
        reviewCount={selectedRevisionTarget?.reviewCount}
      />
    </div>
  );
};

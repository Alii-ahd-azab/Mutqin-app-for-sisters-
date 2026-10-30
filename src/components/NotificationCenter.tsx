import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bell,
  BookMarked,
  CalendarCheck,
  CircleAlert,
  History,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  UserCog,
  UserMinus,
  X,
} from 'lucide-react';
import {
  adminAlertText,
  alertIssueText,
  dismissalKey,
  isUnread,
  panelSeenKeys,
  type BatchAdminAlert,
  type MemberNotification,
  type NotificationState,
  type NotificationTone,
} from '../lib/notifications';
import type { AlertDismissal, NotificationSnapshot } from '../api/client';

/*
 * Header bell for members, batch admins and master admins (same behaviour as Mutqin for Men). The notifications are DERIVED from the
 * current program status by the caller; this component shows them and reports the user's
 * interactions, which the app stores per notification key (public.notification_states):
 *   opening the panel   → the visible NON-urgent notifications become seen (badge drops); nothing
 *                         is archived and they stay in the list
 *   clicking an item    → its deep link opens and it is archived (leaves the active list, stays in
 *                         «عرض كل التنبيهات»). Exception: a member's own 3+ debt warning is only
 *                         marked seen and STAYS active until the debt falls below 3.
 * Admins see one card per member; X hides that member's card for this admin only
 * (admin_alert_dismissals) until he restores it from «المستبعدة».
 * The red control follows the CONDITION: it stays red while an urgent condition exists.
 */

const TONES: Record<NotificationTone, { box: string; title: string; icon: React.ReactNode; dot: string }> = {
  light: { box: 'bg-amber-50 border-amber-200', title: 'text-amber-950', icon: <AlertCircle className="w-4 h-4 text-amber-600" />, dot: 'bg-amber-400' },
  strong: { box: 'bg-orange-50 border-orange-300', title: 'text-orange-950', icon: <AlertTriangle className="w-4 h-4 text-orange-600" />, dot: 'bg-orange-500' },
  serious: { box: 'bg-rose-50 border-rose-300', title: 'text-rose-900', icon: <ShieldAlert className="w-4 h-4 text-rose-600" />, dot: 'bg-rose-600' },
  info: { box: 'bg-pink-50 border-pink-200', title: 'text-pink-950', icon: <CalendarCheck className="w-4 h-4 text-pink-600" />, dot: 'bg-pink-500' },
  distant: { box: 'bg-fuchsia-50 border-fuchsia-200', title: 'text-fuchsia-950', icon: <BookMarked className="w-4 h-4 text-fuchsia-700" />, dot: 'bg-fuchsia-600' },
};

const KIND_LABEL: Record<string, string> = {
  'tasmia-overdue': 'تسميع متأخر',
  'revision-overdue': 'مراجعة متأخرة',
  'distant-overdue': 'مراجعة بعيدة متأخرة',
  'rest-day': 'يوم راحة',
  'rest-tomorrow': 'يوم راحة غدًا',
  'distant-day': 'مراجعة بعيدة',
  'distant-tomorrow': 'مراجعة بعيدة غدًا',
  'admin-member': 'تأخر شديد لعضوة',
};

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });

export const memberSnapshot = (n: MemberNotification): NotificationSnapshot => ({
  key: n.key,
  kind: n.kind,
  tone: n.tone,
  urgent: n.urgent,
  title: n.title,
  body: n.note ? `${n.body} — ملاحظة المشرفة: ${n.note}` : n.body,
});

export const adminSnapshot = (a: BatchAdminAlert): NotificationSnapshot => ({
  key: a.key,
  kind: 'admin-member',
  tone: 'serious',
  urgent: true,
  ...adminAlertText(a),
});

interface FollowSettings {
  batches: { id: string; name: string }[];
  followed: Set<string>;
  onToggle: (batchId: string, enabled: boolean) => Promise<void>;
}

type Props = {
  states: Map<string, NotificationState>;
  onSeen: (items: NotificationSnapshot[]) => void;
  onArchive: (item: NotificationSnapshot) => void;
} & (
  | { mode: 'member'; items: MemberNotification[]; onOpen: (n: MemberNotification) => void }
  | {
      mode: 'admin';
      items: BatchAdminAlert[];
      onOpen: (a: BatchAdminAlert, action: 'manage' | 'exclude') => void;
      // This admin's own dismissed member alerts, keyed by dismissalKey(batch, member).
      dismissals: Map<string, AlertDismissal>;
      onDismiss: (a: BatchAdminAlert) => void;
      onRestore: (batchId: string, memberId: string) => void;
      // Master admins only: which batches she follows.
      follow?: FollowSettings;
    }
);

type Entry = { key: string; urgent: boolean; persistent: boolean; snapshot: NotificationSnapshot };
type HistoryTab = 'current' | 'archived' | 'dismissed';

export const NotificationCenter: React.FC<Props> = (props) => {
  const { states, onSeen, onArchive } = props;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'list' | 'settings'>('list');
  const [historyTab, setHistoryTab] = useState<HistoryTab | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dismissals = props.mode === 'admin' ? props.dismissals : null;

  const entries: Entry[] = useMemo(
    () =>
      props.mode === 'member'
        ? props.items.map((n) => ({ key: n.key, urgent: n.urgent, persistent: n.persistent, snapshot: memberSnapshot(n) }))
        : props.items
            // A dismissed member card is not shown, counted or kept red for this admin.
            .filter((a) => !dismissals?.has(dismissalKey(a.batchId, a.memberId)))
            .map((a) => ({ key: a.key, urgent: true, persistent: false, snapshot: adminSnapshot(a) })),
    [props.mode, props.items, dismissals]
  );
  const active = useMemo(() => entries.filter((e) => e.persistent || !states.get(e.key)?.archivedAt), [entries, states]);
  const unreadCount = useMemo(() => active.filter((e) => isUnread(e, states.get(e.key))).length, [active, states]);
  // The CONDITION decides the red state (archived or not).
  const urgentCondition = entries.some((e) => e.urgent);
  const activeKeys = new Set(active.map((e) => e.key));

  const close = useCallback(() => {
    setOpen(false);
    setView('list');
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open, close]);

  const toggle = () => {
    if (open) return close();
    setOpen(true);
    // Opening the panel: visible non-urgent notifications are seen (not archived).
    const keys = new Set(panelSeenKeys(active, states));
    const toSee = active.filter((e) => keys.has(e.key)).map((e) => e.snapshot);
    if (toSee.length) onSeen(toSee);
  };

  // Clicking a notification: archived — or, for a persistent warning, only seen (it stays active).
  const clicked = (key: string) => {
    const e = entries.find((x) => x.key === key);
    if (!e) return;
    const s = states.get(key);
    if (e.persistent) {
      if (!s?.seenAt) onSeen([e.snapshot]);
    } else if (!s?.archivedAt) {
      onArchive(e.snapshot);
    }
  };

  const follow = props.mode === 'admin' ? props.follow : undefined;
  const archivedHistory = useMemo(
    () =>
      [...states.values()]
        .filter((s) => s.archivedAt && !(props.mode === 'member' && entries.some((e) => e.persistent && e.key === s.key)))
        .sort((a, b) => (b.archivedAt! < a.archivedAt! ? -1 : 1)),
    [states, entries, props.mode]
  );
  const currentKeys = new Set(entries.map((e) => e.key));

  const renderMember = (n: MemberNotification) => {
    const t = TONES[n.tone];
    const unread = isUnread(n, states.get(n.key));
    return (
      <button
        key={n.key}
        id={`notification-${n.kind}`}
        data-tone={n.tone}
        data-unread={unread}
        data-urgent={n.urgent}
        type="button"
        onClick={() => {
          clicked(n.key);
          close();
          setHistoryTab(null);
          if (props.mode === 'member') props.onOpen(n);
        }}
        className={`w-full text-right rounded-xl border p-3 flex items-start gap-2.5 transition cursor-pointer hover:brightness-[0.98] ${t.box}`}
      >
        <span className="mt-0.5 shrink-0">{t.icon}</span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className={`block text-xs leading-relaxed ${unread ? 'font-bold' : 'font-semibold'} ${t.title}`}>{n.title}</span>
          <span className="block text-[11px] text-stone-700 leading-relaxed">{n.body}</span>
          {n.note && (
            <span className="block text-[11px] text-stone-600 leading-relaxed">
              <strong>ملاحظة المشرفة:</strong> {n.note}
            </span>
          )}
        </span>
        {unread && <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${t.dot}`} aria-label="غير مقروء" />}
      </button>
    );
  };

  const renderAdmin = (a: BatchAdminAlert) => {
    const unread = isUnread(a, states.get(a.key));
    const go = (action: 'manage' | 'exclude') => {
      clicked(a.key);
      close();
      setHistoryTab(null);
      if (props.mode === 'admin') props.onOpen(a, action);
    };
    return (
      <div
        key={a.key}
        id={`admin-alert-${a.memberId}`}
        data-tone="serious"
        data-unread={unread}
        data-urgent="true"
        className="relative rounded-xl border border-rose-300 bg-rose-50 p-3 space-y-2"
      >
        <button
          id={`dismiss-alert-${a.memberId}`}
          type="button"
          onClick={() => props.mode === 'admin' && props.onDismiss(a)}
          title="إخفاء تنبيه هذه العضوة (يمكن استعادته من «المستبعدة»)"
          aria-label={`إخفاء تنبيه ${a.memberName}`}
          className="absolute top-2 left-2 p-1 rounded-lg text-rose-400 hover:text-rose-700 hover:bg-rose-100 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={() => go('manage')} className="w-full text-right flex items-start gap-2.5 cursor-pointer pl-6">
          <ShieldAlert className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className={`block text-xs text-rose-950 ${unread ? 'font-bold' : 'font-semibold'}`}>{a.memberName}</span>
            <span className="block text-[11px] text-stone-600 font-mono" dir="ltr" style={{ textAlign: 'right' }}>
              {a.phone}
            </span>
            <span className="block text-[11px] text-stone-600">{a.batchName}</span>
            <ul className="mt-1 space-y-0.5">
              {a.issues.map((i) => (
                <li key={i.category} data-category={i.category} className="alert-issue flex items-start gap-1.5 text-[11px] text-rose-800 font-bold">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-rose-600 shrink-0" aria-hidden />
                  <span>{alertIssueText(i)}</span>
                </li>
              ))}
            </ul>
          </span>
          {unread && <span className="mt-1.5 w-2 h-2 rounded-full shrink-0 bg-rose-600" aria-label="غير مقروء" />}
        </button>
        <div className="flex items-center gap-2 justify-end">
          {a.eligibleForExclusion && (
            <button
              type="button"
              onClick={() => go('exclude')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-rose-300 text-rose-700 hover:bg-rose-100 cursor-pointer"
              title="يفتح نافذة تأكيد الإقصاء المعتادة"
            >
              <UserMinus className="w-3.5 h-3.5" />
              إقصاء مبدئي
            </button>
          )}
          <button
            type="button"
            onClick={() => go('manage')}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-rose-600 text-white hover:bg-rose-700 cursor-pointer"
          >
            <UserCog className="w-3.5 h-3.5" />
            إدارة العضوة
          </button>
        </div>
      </div>
    );
  };

  const renderActive = () =>
    props.mode === 'member'
      ? props.items.filter((n) => activeKeys.has(n.key)).map(renderMember)
      : props.items.filter((a) => activeKeys.has(a.key)).map(renderAdmin);

  const emptyText =
    props.mode === 'member'
      ? 'لا توجد تنبيهات جديدة. بارك الله فيكِ.'
      : follow && follow.followed.size === 0
      ? 'لا تتابعين أي دفعة بعد. اختاري الدفعات من «إعدادات التنبيهات».'
      : 'لا توجد عضوة جديدة بلغ تأخرها 3 أيام في التسميع أو المراجعة.';

  const dismissedList = dismissals ? [...dismissals.values()].sort((a, b) => (b.dismissedAt < a.dismissedAt ? -1 : 1)) : [];
  const activeAlertMembers = new Set(props.mode === 'admin' ? props.items.map((a) => dismissalKey(a.batchId, a.memberId)) : []);
  const tabs: [HistoryTab, string, number][] = [
    ['current', 'الحالية', active.length],
    ['archived', 'المؤرشفة', archivedHistory.length],
    ...(props.mode === 'admin' ? ([['dismissed', 'المستبعدة', dismissedList.length]] as [HistoryTab, string, number][]) : []),
  ];

  return (
    <div className="relative" ref={wrapRef}>
      <button
        id="notifications-button"
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="true"
        data-urgent={urgentCondition}
        aria-label={`التنبيهات${unreadCount ? ` (${unreadCount} غير مقروءة)` : ''}${urgentCondition ? ' — يوجد تنبيه عاجل' : ''}`}
        title="التنبيهات"
        className={`relative flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition cursor-pointer shadow-2xs ${
          urgentCondition
            ? 'bg-rose-600 hover:bg-rose-700 border-rose-700 text-white'
            : open
            ? 'bg-pink-100 border-pink-300 text-pink-900'
            : 'bg-pink-50/50 hover:bg-pink-50 border-pink-100 text-pink-800'
        }`}
      >
        {/* The badge is anchored to the bell icon itself, at its visual top-right (physical "right",
            so RTL does not flip it). */}
        <span id="notifications-bell" className="relative inline-flex">
          <Bell className={`w-4 h-4 ${urgentCondition ? 'text-white' : 'text-pink-600'}`} />
          {urgentCondition && (
            <span id="notifications-urgent-icon" className="absolute rounded-full bg-white" style={{ bottom: -5, right: -6 }} aria-hidden>
              <CircleAlert className="w-3 h-3 text-rose-600" strokeWidth={3} />
            </span>
          )}
          {unreadCount > 0 && (
            <span
              id="notifications-badge"
              className={`absolute min-w-4 h-4 px-1 rounded-full text-[10px] leading-none font-bold flex items-center justify-center border-2 ${
                urgentCondition ? 'bg-white text-rose-700 border-rose-600' : 'bg-rose-600 text-white border-white'
              }`}
              style={{ top: -9, right: -11 }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </span>
        <span className="hidden sm:inline">التنبيهات</span>
      </button>

      {open && (
        <div
          id="notifications-panel"
          role="region"
          aria-label="التنبيهات"
          className="fixed inset-x-3 top-[4.5rem] sm:absolute sm:inset-x-auto sm:top-auto sm:left-0 sm:mt-2 sm:w-[24rem] bg-white border border-pink-100 rounded-2xl shadow-xl z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between gap-2">
            {view === 'settings' ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setView('list')} title="رجوع" className="p-1 rounded-lg text-stone-500 hover:bg-stone-50 cursor-pointer">
                  <ArrowRight className="w-4 h-4" />
                </button>
                <div>
                  <h2 className="text-sm font-bold text-stone-900">متابعة تنبيهات الدفعات</h2>
                  <p className="text-[11px] text-stone-500">تصلكِ تنبيهات التأخر الشديد من الدفعات المفعّلة فقط</p>
                </div>
              </div>
            ) : (
              <div>
                <h2 className="text-sm font-bold text-stone-900">التنبيهات</h2>
                <p className="text-[11px] text-stone-500">
                  {props.mode === 'admin'
                    ? follow
                      ? 'العضوات اللواتي بلغ تأخرهن 3 أيام فأكثر في الدفعات التي تتابعينها'
                      : 'العضوات اللواتي بلغ تأخرهن 3 أيام فأكثر في دفعاتكِ'
                    : 'حالتكِ الحالية في البرنامج'}
                </p>
              </div>
            )}
            <div className="flex items-center gap-1">
              {follow && view === 'list' && (
                <button
                  id="notification-settings-btn"
                  type="button"
                  onClick={() => setView('settings')}
                  title="إعدادات التنبيهات"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-stone-600 hover:bg-stone-50 border border-stone-200 cursor-pointer"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  إعدادات التنبيهات
                </button>
              )}
              <button type="button" onClick={close} title="إغلاق" className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-50 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {view === 'settings' && follow ? (
            <div id="notification-follow-settings" className="max-h-[65vh] overflow-y-auto p-2 space-y-1">
              {follow.batches.map((b) => (
                <FollowSwitch key={b.id} batch={b} on={follow.followed.has(b.id)} onToggle={follow.onToggle} />
              ))}
            </div>
          ) : (
            <>
              <div className="max-h-[60vh] overflow-y-auto overscroll-contain p-2 space-y-2">
                {active.length === 0 && (
                  <p id="notifications-empty" className="px-3 py-6 text-xs text-stone-500 text-center leading-relaxed">
                    {emptyText}
                  </p>
                )}
                {renderActive()}
              </div>
              <div className="border-t border-stone-100 p-2">
                <button
                  id="notifications-view-all"
                  type="button"
                  onClick={() => {
                    close();
                    setHistoryTab('current');
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold text-pink-700 hover:bg-pink-50 cursor-pointer"
                >
                  <History className="w-4 h-4" />
                  عرض كل التنبيهات
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Rendered on document.body: the Sisters header has backdrop-blur, and a backdrop-filter
          ancestor would confine this fixed overlay to the header's box instead of the viewport. */}
      {historyTab &&
        createPortal(
        <div
          className="fixed inset-0 z-50 bg-stone-900/40 flex items-start sm:items-center justify-center p-3"
          onMouseDown={(e) => e.target === e.currentTarget && setHistoryTab(null)}
        >
          <div id="notifications-history" role="dialog" aria-label="كل التنبيهات" className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-stone-200 overflow-hidden mt-14 sm:mt-0">
            <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-stone-900">كل التنبيهات</h2>
              <button type="button" onClick={() => setHistoryTab(null)} title="إغلاق" className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-50 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div role="tablist" className="flex gap-1 px-3 pt-3">
              {tabs.map(([tab, label, count]) => (
                <button
                  key={tab}
                  id={`notifications-tab-${tab}`}
                  role="tab"
                  type="button"
                  aria-selected={historyTab === tab}
                  onClick={() => setHistoryTab(tab)}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${
                    historyTab === tab ? 'bg-pink-600 text-white border-pink-600' : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
                  }`}
                >
                  {label} ({count})
                </button>
              ))}
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-3 space-y-2">
              {historyTab === 'current' && (
                <section id="notifications-current" className="space-y-2">
                  {active.length === 0 ? <p className="text-[11px] text-stone-500">لا توجد تنبيهات حالية.</p> : renderActive()}
                </section>
              )}
              {historyTab === 'archived' && (
                <section id="notifications-archive" className="space-y-2">
                  {archivedHistory.length === 0 && <p className="text-[11px] text-stone-500">لم تفتحي أي تنبيه بعد.</p>}
                  {archivedHistory.map((s) => {
                    const tone = (s.tone in TONES ? s.tone : 'info') as NotificationTone;
                    const stillActive = currentKeys.has(s.key);
                    return (
                      <div key={s.key} data-kind={s.kind} className="archived-notification rounded-xl border border-stone-200 bg-stone-50 p-3 flex items-start gap-2.5">
                        <span className="mt-0.5 shrink-0 opacity-70">{TONES[tone].icon}</span>
                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white border border-stone-200 text-stone-600">{KIND_LABEL[s.kind] || 'تنبيه'}</span>
                            {stillActive && s.urgent && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-rose-100 border border-rose-200 text-rose-800 font-bold">الحالة ما زالت قائمة</span>
                            )}
                          </span>
                          <span className="block text-xs font-semibold text-stone-800">{s.title}</span>
                          <span className="block text-[11px] text-stone-600 leading-relaxed">{s.body}</span>
                          <span className="block text-[10px] text-stone-400">فُتح في {formatWhen(s.archivedAt!)}</span>
                        </span>
                      </div>
                    );
                  })}
                </section>
              )}
              {historyTab === 'dismissed' && props.mode === 'admin' && (
                <section id="notifications-dismissed" className="space-y-2">
                  {dismissedList.length === 0 && <p className="text-[11px] text-stone-500">لم تستبعدي أي تنبيه.</p>}
                  {dismissedList.map((d) => {
                    const k = dismissalKey(d.batchId, d.memberId);
                    const stillSerious = activeAlertMembers.has(k);
                    return (
                      <div key={k} id={`dismissed-alert-${d.memberId}`} className="rounded-xl border border-stone-200 bg-stone-50 p-3 flex items-start gap-2.5">
                        <ShieldAlert className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-stone-800">{d.memberName}</span>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-md border font-bold ${
                                stillSerious ? 'bg-rose-100 border-rose-200 text-rose-800' : 'bg-white border-stone-200 text-stone-500'
                              }`}
                            >
                              {stillSerious ? 'التأخر الشديد ما زال قائمًا' : 'لم تعد متأخرة تأخرًا شديدًا'}
                            </span>
                          </span>
                          <span className="block text-[11px] text-stone-600 leading-relaxed">{d.summary}</span>
                          <span className="block text-[10px] text-stone-400">استُبعد في {formatWhen(d.dismissedAt)}</span>
                        </span>
                        <button
                          id={`restore-alert-${d.memberId}`}
                          type="button"
                          onClick={() => props.onRestore(d.batchId, d.memberId)}
                          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-pink-300 text-pink-700 hover:bg-pink-50 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          إعادة إظهار التنبيه
                        </button>
                      </div>
                    );
                  })}
                </section>
              )}
            </div>
          </div>
        </div>,
          document.body
        )}
    </div>
  );
};

const FollowSwitch: React.FC<{ batch: { id: string; name: string }; on: boolean; onToggle: (id: string, on: boolean) => Promise<void> }> = ({
  batch,
  on,
  onToggle,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl hover:bg-stone-50">
      <span className="text-xs font-bold text-stone-800">{batch.name}</span>
      <span className="flex items-center gap-2">
        {error && <span className="text-[10px] text-rose-600">{error}</span>}
        <button
          id={`follow-batch-${batch.id}`}
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`متابعة تنبيهات ${batch.name}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await onToggle(batch.id, !on);
            } catch (e: any) {
              setError(e?.message || 'تعذر الحفظ');
            } finally {
              setBusy(false);
            }
          }}
          className={`relative w-10 h-6 rounded-full transition cursor-pointer disabled:opacity-60 ${on ? 'bg-pink-600' : 'bg-stone-300'}`}
        >
          <span className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ right: on ? 4 : 20 }} />
        </button>
      </span>
    </div>
  );
};

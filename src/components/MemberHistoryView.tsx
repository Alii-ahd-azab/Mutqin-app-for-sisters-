import React, { useState, useMemo } from 'react';
import { RecitationLog, RevisionLog, User } from '../types';
import { getQuarterInfo } from '../data/quranData';
import { CheckCircle2, Calendar, MessageSquare, BookMarked, Check, UserCheck, Headphones } from 'lucide-react';

interface MemberHistoryViewProps {
  currentUser: User;
  recitations: RecitationLog[];
  revisions: RevisionLog[];
}

export const MemberHistoryView: React.FC<MemberHistoryViewProps> = ({
  currentUser,
  recitations,
  revisions,
}) => {
  const [activeTab, setActiveTab] = useState<'recitations' | 'revisions' | 'listening'>('recitations');

  // Logs of the current user
  const myRecitations = recitations.filter(
    (r) => r.member_id === currentUser.id || r.reciter_id === currentUser.id
  );
  const myRevisions = revisions.filter((r) => r.member_id === currentUser.id);

  // Recitations where current user was the listening peer for colleagues
  const myListeningSessions = useMemo(() => {
    return recitations
      .filter(
        (r) => r.listener_id === currentUser.id && (r.member_id || r.reciter_id) !== currentUser.id
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [recitations, currentUser.id]);

  return (
    <div className="bg-white rounded-2xl border border-pink-100 shadow-2xs overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-pink-100 bg-pink-50/40 p-1.5 gap-1 text-xs font-bold">
        <button
          onClick={() => setActiveTab('recitations')}
          className={`flex-1 py-2 px-3 rounded-xl flex items-center justify-center gap-2 transition ${
            activeTab === 'recitations'
              ? 'bg-white text-rose-950 shadow-2xs border border-pink-200'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <BookMarked className="w-3.5 h-3.5 text-pink-600" />
          <span>سجل التسميع ({myRecitations.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('revisions')}
          className={`flex-1 py-2 px-3 rounded-xl flex items-center justify-center gap-2 transition ${
            activeTab === 'revisions'
              ? 'bg-white text-rose-950 shadow-2xs border border-pink-200'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <Check className="w-3.5 h-3.5 text-pink-600" />
          <span>سجل المراجعات ({myRevisions.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('listening')}
          className={`flex-1 py-2 px-3 rounded-xl flex items-center justify-center gap-2 transition ${
            activeTab === 'listening'
              ? 'bg-white text-rose-950 shadow-2xs border border-pink-200'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <Headphones className="w-3.5 h-3.5 text-pink-600" />
          <span>سجل الاستماع ({myListeningSessions.length})</span>
        </button>
      </div>

      {/* Content list */}
      <div className="p-4 divide-y divide-stone-100 max-h-[380px] overflow-y-auto">
        {activeTab === 'listening' ? (
          <div className="space-y-3">
            <div className="p-3 bg-emerald-50/80 border border-emerald-200/80 rounded-xl flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs font-mono">
                  {myListeningSessions.length}
                </div>
                <div>
                  <span className="font-bold text-emerald-950 block">
                    إجمالي جلسات الاستماع لزملائك منذ بداية الدورة
                  </span>
                  <span className="text-[11px] text-emerald-800">
                    شكر الله سعيك في إعانة إخوانك على التسميع والتثبيت
                  </span>
                </div>
              </div>
            </div>

            {myListeningSessions.length === 0 ? (
              <div className="text-center py-8 text-stone-400 text-xs">
                لم تسجل أي جلسة استماع لزملائك بعد. عندما يختارك زملاؤك كمستمع لهم عند تسجيل تسميعهم، ستظهر جميع الجلسات هنا.
              </div>
            ) : (
              <div className="divide-y divide-stone-100">
                {myListeningSessions.map((rec) => {
                  const qInfo = getQuarterInfo(rec.quarter_number);
                  const reciterName = rec.reciter_name || rec.member_name || 'أحد الزملاء';
                  return (
                    <div key={rec.id} className="py-3 flex items-start justify-between gap-3 text-xs">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-stone-900">
                            استمعت للزميل: <strong className="text-emerald-800">{reciterName}</strong>
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-stone-100 text-stone-700 border border-stone-200">
                            الربع {rec.quarter_number} ({qInfo.surahName} - الجزء {qInfo.juz})
                          </span>
                        </div>

                        {rec.notes && (
                          <p className="text-[11px] text-stone-500 flex items-center gap-1">
                            <MessageSquare className="w-3 h-3 text-stone-400 shrink-0" />
                            <span>{rec.notes}</span>
                          </p>
                        )}
                      </div>

                      <div className="text-left shrink-0 text-stone-400 text-[11px] flex items-center gap-1 font-mono">
                        <Calendar className="w-3 h-3" />
                        <span>{rec.date}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : activeTab === 'revisions' ? (
          myRevisions.length === 0 ? (
            <div className="text-center py-8 text-stone-400 text-xs">
              لم تسجل أي مراجعة بعد.
            </div>
          ) : (
            myRevisions.map((rev) => {
              const startInfo = getQuarterInfo(rev.review_start_quarter);
              const endInfo = getQuarterInfo(rev.review_end_quarter);
              return (
                <div key={rev.id} className="py-3 flex items-start justify-between gap-3 text-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-stone-900">
                        مراجعة من الربع {rev.review_start_quarter} إلى {rev.review_end_quarter}
                      </span>
                      <span className="text-stone-400">
                        ({startInfo.surahName} - {endInfo.surahName})
                      </span>
                    </div>
                    {rev.notes && (
                      <p className="text-stone-500 text-[11px] flex items-center gap-1">
                        <MessageSquare className="w-3 h-3 text-stone-400 shrink-0" />
                        <span>{rev.notes}</span>
                      </p>
                    )}
                  </div>
                  <div className="text-left shrink-0 text-stone-400 text-[11px] flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    <span>{rev.date}</span>
                  </div>
                </div>
              );
            })
          )
        ) : myRecitations.length === 0 ? (
          <div className="text-center py-8 text-stone-400 text-xs">
            لم تسجل أي تسميع بعد. يمكنك تسجيل تسميع اليوم من اللوحة الرئيسية أعلاه.
          </div>
        ) : (
          myRecitations.map((rec) => {
            const qInfo = getQuarterInfo(rec.quarter_number);
            return (
              <div key={rec.id} className="py-3 flex items-start justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-stone-900">
                      الربع رقم {rec.quarter_number}
                    </span>
                    <span className="text-stone-500">
                      ({qInfo.surahName} - الجزء {qInfo.juz})
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      تم الإتمام
                    </span>
                  </div>

                  {rec.listener_name && (
                    <p className="text-[11px] text-stone-600 flex items-center gap-1">
                      <UserCheck className="w-3 h-3 text-stone-400" />
                      <span>الزميل المستمع: <strong>{rec.listener_name}</strong></span>
                    </p>
                  )}

                  {rec.notes && (
                    <p className="text-[11px] text-stone-500 flex items-center gap-1">
                      <MessageSquare className="w-3 h-3 text-stone-400 shrink-0" />
                      <span>{rec.notes}</span>
                    </p>
                  )}
                </div>

                <div className="text-left shrink-0 text-stone-400 text-[11px] flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  <span>{rec.date}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

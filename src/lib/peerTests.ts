// Peer-testing rules shared with the peer-tests Edge Function, so the UI
// shows exactly what the server enforces.
export {
  isPeerTestLive,
  nextTasmiaQuarter,
} from '../../supabase/functions/_shared/peer-tests/eligibility.ts';

export const PEER_DIFFICULTY_LABELS: Record<string, { label: string; desc: string }> = {
  any: { label: 'تلقائي / عشوائي', desc: 'توزيع عشوائي متوازن لمواضع الآيات' },
  easy: { label: 'سهل', desc: 'بدايات واضحة ومواضع ميسّرة' },
  medium: { label: 'متوسط', desc: 'مواضع معتدلة وتفاوت في السياق' },
  hard: { label: 'صعب', desc: 'مواضع متشابهات وانتقالات دقيقة' },
  mixed: { label: 'متنوع', desc: 'مزيج متدرّج بين السهل والمتوسط والصعب' },
};

export const PEER_LEVEL_STYLES: Record<string, { label: string; className: string }> = {
  easy: { label: 'سهل', className: 'bg-green-50 text-green-700 border border-green-200' },
  medium: { label: 'متوسط', className: 'bg-amber-50 text-amber-800 border border-amber-200' },
  hard: { label: 'صعب', className: 'bg-rose-50 text-rose-700 border border-rose-200' },
};

// Color families for admin row actions (size/shape classes stay on each button).
// Each action's color reflects its meaning:
//   edit       → soft green
//   batches    → soft sky blue
//   move       → soft indigo
//   exclude    → strong site crimson (same as the «الأعضاء المُقصَون» tab)
//   reactivate → emerald
//   delete     → destructive deep red (outlined, distinct from exclude)

export const ACTION_TONE = {
  edit: 'bg-green-50 hover:bg-green-100 text-green-700 border border-green-200',
  batches: 'bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200',
  move: 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200',
  exclude: 'bg-rose-700 hover:bg-rose-800 text-white border border-rose-700',
  reactivate: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200',
  delete: 'bg-red-50 hover:bg-red-100 text-red-800 border border-red-300',
} as const;

export const ACTION_ICON = {
  edit: 'text-green-600',
  batches: 'text-sky-600',
  move: 'text-indigo-600',
  exclude: 'text-rose-100',
  reactivate: 'text-emerald-700',
  delete: 'text-red-700',
} as const;

// Solid confirm buttons inside the confirmation dialogs
export const CONFIRM_TONE = {
  exclude: 'bg-rose-700 hover:bg-rose-800',
  delete: 'bg-red-800 hover:bg-red-900',
} as const;

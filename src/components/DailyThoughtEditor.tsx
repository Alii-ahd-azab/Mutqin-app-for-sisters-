import React, { useState, useRef, useEffect } from 'react';
import { sanitizeThoughtHtml, isThoughtContentEmpty } from '../lib/sanitizeHtml';
import {
  Sparkles,
  Bold,
  Italic,
  Underline,
  AlignRight,
  AlignCenter,
  AlignLeft,
  Save,
  Trash2,
  Eye,
  Edit3,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
} from 'lucide-react';

interface DailyThoughtEditorProps {
  currentThought?: string;
  updatedAt?: string;
  updatedBy?: string;
  onSave: (htmlContent: string) => Promise<void>;
  onDelete: () => Promise<void>;
  loading?: boolean;
}

const PRESET_COLORS = [
  { name: 'افتراضي (داكن)', value: '#1c1917', bgClass: 'bg-stone-900' },
  { name: 'أخضر زمردي', value: '#065f46', bgClass: 'bg-emerald-800' },
  { name: 'ذهبي كهرماني', value: '#b45309', bgClass: 'bg-amber-700' },
  { name: 'أزرق وقور', value: '#1e40af', bgClass: 'bg-blue-800' },
  { name: 'عنابي وقور', value: '#9f1239', bgClass: 'bg-rose-800' },
  { name: 'بنفسجي هادئ', value: '#6b21a8', bgClass: 'bg-purple-800' },
];

const FONT_SIZES = [
  { label: 'صغير', size: '14px', cmdValue: '2' },
  { label: 'عادي', size: '16px', cmdValue: '3' },
  { label: 'متوسط', size: '18px', cmdValue: '4' },
  { label: 'كبير', size: '22px', cmdValue: '5' },
  { label: 'بارز', size: '26px', cmdValue: '6' },
];

export const DailyThoughtEditor: React.FC<DailyThoughtEditorProps> = ({
  currentThought = '',
  updatedAt,
  updatedBy,
  onSave,
  onDelete,
  loading = false,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [htmlContent, setHtmlContent] = useState<string>(currentThought || '');
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [currentColor, setCurrentColor] = useState<string>('#1c1917');
  const [selectedFontSize, setSelectedFontSize] = useState<string>('3');

  // Synchronize internal state with props when currentThought changes externally
  useEffect(() => {
    setHtmlContent(currentThought || '');
    if (editorRef.current && editorRef.current.innerHTML !== (currentThought || '')) {
      editorRef.current.innerHTML = currentThought || '';
    }
  }, [currentThought]);

  // Initial content insertion into editor element
  useEffect(() => {
    if (editorRef.current && currentThought && !editorRef.current.innerHTML) {
      editorRef.current.innerHTML = currentThought;
    }
  }, [currentThought]);

  const handleInput = () => {
    if (editorRef.current) {
      setHtmlContent(editorRef.current.innerHTML);
    }
  };

  const executeCommand = (command: string, value: string | undefined = undefined) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command, false, value);
    setHtmlContent(editorRef.current.innerHTML);
  };

  const applyColor = (color: string) => {
    setCurrentColor(color);
    executeCommand('foreColor', color);
  };

  const applyFontSize = (cmdValue: string) => {
    setSelectedFontSize(cmdValue);
    executeCommand('fontSize', cmdValue);
  };

  const handleClearFormatting = () => {
    executeCommand('removeFormat');
  };

  const handleSave = async () => {
    const rawHtml = editorRef.current ? editorRef.current.innerHTML : htmlContent;
    const sanitized = sanitizeThoughtHtml(rawHtml);

    if (isThoughtContentEmpty(sanitized)) {
      setFeedbackMsg({
        type: 'error',
        text: 'يرجى كتابة نص الخاطرة أولاً قبل الحفظ، أو استخدام زر الحذف إذا أردت إلغاءها.',
      });
      return;
    }

    try {
      await onSave(sanitized);
      setFeedbackMsg({
        type: 'success',
        text: 'تم حفظ ونشر خاطرة اليوم بنجاح وتظهر الآن لجميع الأعضاء.',
      });
      setTimeout(() => setFeedbackMsg(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر حفظ الخاطرة';
      setFeedbackMsg({ type: 'error', text: msg });
    }
  };

  const handleDelete = async () => {
    try {
      await onDelete();
      setHtmlContent('');
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
      }
      setShowDeleteConfirm(false);
      setFeedbackMsg({
        type: 'success',
        text: 'تم حذف خاطرة اليوم بالكامل، ولن تظهر في لوحة أي عضو.',
      });
      setTimeout(() => setFeedbackMsg(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر حذف الخاطرة';
      setFeedbackMsg({ type: 'error', text: msg });
    }
  };

  const hasActiveThought = !isThoughtContentEmpty(htmlContent);

  return (
    <div className="bg-white rounded-3xl border border-stone-200 p-6 shadow-2xs space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-stone-100">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-amber-100/70 text-amber-800 flex items-center justify-center font-bold">
              <Sparkles className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <h3 className="font-bold text-base text-stone-900 flex items-center gap-2">
                <span>خاطرة اليوم</span>
                {hasActiveThought ? (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                    منشورة حاليًا للأعضاء
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-stone-100 text-stone-600">
                    غير مفعلة (فارغة)
                  </span>
                )}
              </h3>
              <p className="text-xs text-stone-500">
                مشاركة موعظة إيمانية، أو آية كريمة، أو توجيه قرآني يظهر بارزًا في أعلى لوحة كل الأعضاء
              </p>
            </div>
          </div>
        </div>

        {/* Updated metadata if available */}
        {updatedAt && (
          <div className="flex items-center gap-1.5 text-[11px] text-stone-400 bg-stone-50 px-3 py-1.5 rounded-xl border border-stone-200/60 self-start sm:self-auto">
            <Clock className="w-3.5 h-3.5 text-stone-400" />
            <span>
              آخر تحديث: {new Date(updatedAt).toLocaleDateString('ar-EG', { dateStyle: 'medium' })}
              {updatedBy ? ` بواسطة ${updatedBy}` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Editor / Preview Tabs */}
      <div className="flex items-center justify-between">
        <div className="inline-flex p-1 rounded-xl bg-stone-100 border border-stone-200/60 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('editor')}
            className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'editor'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>صندوق التحرير والتنسيق</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('preview')}
            className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'preview'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>معاينة كما تظهر للعضو</span>
          </button>
        </div>

        <span className="text-[11px] text-stone-400 hidden sm:inline">
          آمن ومُنقّى تلقائيًا ضد الأكواد والسكريبتات الضارة (XSS Protection)
        </span>
      </div>

      {/* Mode 1: Editor */}
      {activeTab === 'editor' && (
        <div className="space-y-3">
          {/* Formatting Toolbar */}
          <div className="p-2.5 rounded-2xl bg-stone-50 border border-stone-200 flex flex-wrap items-center gap-2 text-stone-700">
            {/* Bold, Italic, Underline */}
            <div className="flex items-center bg-white rounded-xl border border-stone-200 p-0.5 shadow-2xs">
              <button
                type="button"
                onClick={() => executeCommand('bold')}
                className="p-2 rounded-lg hover:bg-stone-100 text-stone-700 hover:text-stone-900 transition cursor-pointer"
                title="خط عريض (Bold)"
              >
                <Bold className="w-4 h-4 font-bold" />
              </button>
              <button
                type="button"
                onClick={() => executeCommand('italic')}
                className="p-2 rounded-lg hover:bg-stone-100 text-stone-700 hover:text-stone-900 transition cursor-pointer"
                title="مائل (Italic)"
              >
                <Italic className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => executeCommand('underline')}
                className="p-2 rounded-lg hover:bg-stone-100 text-stone-700 hover:text-stone-900 transition cursor-pointer"
                title="تسطير (Underline)"
              >
                <Underline className="w-4 h-4" />
              </button>
            </div>

            <div className="h-6 w-px bg-stone-200 mx-1 hidden sm:block" />

            {/* Alignment */}
            <div className="flex items-center bg-white rounded-xl border border-stone-200 p-0.5 shadow-2xs">
              <button
                type="button"
                onClick={() => executeCommand('justifyRight')}
                className="p-2 rounded-lg hover:bg-stone-100 text-stone-700 hover:text-stone-900 transition cursor-pointer"
                title="محاذاة لليمين"
              >
                <AlignRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => executeCommand('justifyCenter')}
                className="p-2 rounded-lg hover:bg-stone-100 text-stone-700 hover:text-stone-900 transition cursor-pointer"
                title="محاذاة للوسط"
              >
                <AlignCenter className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => executeCommand('justifyLeft')}
                className="p-2 rounded-lg hover:bg-stone-100 text-stone-700 hover:text-stone-900 transition cursor-pointer"
                title="محاذاة لليسار"
              >
                <AlignLeft className="w-4 h-4" />
              </button>
            </div>

            <div className="h-6 w-px bg-stone-200 mx-1 hidden sm:block" />

            {/* Font Size Selector */}
            <div className="flex items-center gap-1 bg-white rounded-xl border border-stone-200 px-2 py-1 shadow-2xs">
              <span className="text-[11px] font-bold text-stone-500">الحجم:</span>
              <select
                value={selectedFontSize}
                onChange={(e) => applyFontSize(e.target.value)}
                className="text-xs bg-transparent font-medium text-stone-800 outline-hidden cursor-pointer"
                title="حجم الخط"
              >
                {FONT_SIZES.map((fs) => (
                  <option key={fs.cmdValue} value={fs.cmdValue}>
                    {fs.label} ({fs.size})
                  </option>
                ))}
              </select>
            </div>

            <div className="h-6 w-px bg-stone-200 mx-1 hidden sm:block" />

            {/* Color Presets */}
            <div className="flex items-center gap-1.5 bg-white rounded-xl border border-stone-200 px-2 py-1 shadow-2xs">
              <span className="text-[11px] font-bold text-stone-500">اللون:</span>
              <div className="flex items-center gap-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => applyColor(c.value)}
                    className={`w-5 h-5 rounded-full ${c.bgClass} border transition-transform ${
                      currentColor === c.value ? 'scale-125 ring-2 ring-amber-400' : 'hover:scale-110'
                    }`}
                    title={c.name}
                  />
                ))}
                {/* Native Custom Color Picker */}
                <label className="w-5 h-5 rounded-full border border-stone-300 relative overflow-hidden cursor-pointer hover:scale-110 flex items-center justify-center bg-gradient-to-tr from-rose-500 via-amber-400 to-emerald-500" title="لون مخصص">
                  <input
                    type="color"
                    value={currentColor}
                    onChange={(e) => applyColor(e.target.value)}
                    className="opacity-0 absolute inset-0 cursor-pointer w-full h-full"
                  />
                </label>
              </div>
            </div>

            {/* Clear formatting */}
            <button
              type="button"
              onClick={handleClearFormatting}
              className="p-2 rounded-xl bg-white border border-stone-200 hover:bg-stone-100 text-stone-600 hover:text-stone-900 transition cursor-pointer text-xs flex items-center gap-1 mr-auto"
              title="إزالة كافة التنسيقات عن النص المحدد"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="text-[11px] font-medium hidden md:inline">مسح التنسيق</span>
            </button>
          </div>

          {/* Editable Canvas Container */}
          <div className="relative">
            <div
              ref={editorRef}
              contentEditable
              dir="rtl"
              onInput={handleInput}
              className="min-h-[160px] max-h-[380px] overflow-y-auto p-4 sm:p-5 rounded-2xl border-2 border-dashed border-stone-200 bg-stone-50/50 hover:bg-white focus:bg-white focus:border-emerald-600 focus:ring-3 focus:ring-emerald-500/10 transition outline-hidden text-stone-900 font-sans text-base leading-relaxed"
              style={{ minHeight: '160px' }}
              data-placeholder="اكتب هنا خاطرة اليوم، أو آية كريمة، أو توجيهًا إيمانيًا ليظهر بارزًا في لوحة الأعضاء..."
            />
            {isThoughtContentEmpty(htmlContent) && (
              <div className="pointer-events-none absolute top-5 right-5 text-stone-400 text-sm">
                اكتب هنا خاطرة اليوم، أو آية كريمة، أو موعظة إيمانية لتظهر لجميع الأعضاء في لوحاتهم...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mode 2: Live Preview Card (Exactly as member will see it) */}
      {activeTab === 'preview' && (
        <div className="space-y-3">
          <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-2xl text-xs text-amber-900 flex items-center gap-2">
            <Eye className="w-4 h-4 text-amber-700 shrink-0" />
            <span>هكذا تظهر البطاقة تمامًا للأعضاء في أعلى صفحتهم الرئيسية:</span>
          </div>

          {isThoughtContentEmpty(htmlContent) ? (
            <div className="p-8 text-center bg-stone-50 rounded-2xl border border-dashed border-stone-300 space-y-2">
              <p className="text-xs text-stone-500 font-medium">
                لا توجد خاطرة مكتوبة حاليًا (البطاقة ستكون مخفية تمامًا ولن تظهر للأعضاء).
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('editor')}
                className="text-xs text-emerald-700 font-bold hover:underline"
              >
                انقر هنا لكتابة خاطرة وتنسيقها
              </button>
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-50/80 via-white to-stone-50 border-2 border-amber-200/90 p-5 sm:p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-3 pb-2.5 border-b border-amber-200/60">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-xl bg-amber-200/80 text-amber-900 flex items-center justify-center font-bold">
                    <Sparkles className="w-4 h-4 text-amber-800" />
                  </div>
                  <span className="font-bold text-xs sm:text-sm text-amber-950 font-quran">
                    خاطرة اليوم
                  </span>
                </div>
                <span className="text-[11px] text-amber-900/60 font-medium">
                  من إشراف المقرأة
                </span>
              </div>

              <div
                dir="rtl"
                className="text-stone-900 leading-relaxed break-words font-sans selection:bg-amber-200"
                dangerouslySetInnerHTML={{ __html: sanitizeThoughtHtml(htmlContent) }}
              />
            </div>
          )}
        </div>
      )}

      {/* Feedback Message */}
      {feedbackMsg && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center gap-2 font-medium ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {feedbackMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{loading ? 'جاري الحفظ...' : 'حفظ ونشر الخاطرة'}</span>
          </button>

          {hasActiveThought && (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={loading}
              className="px-4 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              <span>حذف الخاطرة</span>
            </button>
          )}
        </div>

        {hasActiveThought && (
          <p className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>الخاطرة مفعلة وظاهرة لجميع الأعضاء</span>
          </p>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-rose-200 overflow-hidden text-stone-900 p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-700">
              <div className="p-2.5 bg-rose-100 rounded-xl">
                <Trash2 className="w-6 h-6 text-rose-700" />
              </div>
              <div>
                <h3 className="font-bold text-base text-rose-950">تأكيد حذف الخاطرة</h3>
                <p className="text-xs text-stone-500">ستختفي البطاقة تمامًا من لوحة الأعضاء</p>
              </div>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed">
              هل أنت متأكد من رغبتك في حذف خاطرة اليوم؟ سيتم إفراغ النص بالكامل وإخفاء بطاقة الخاطرة من حسابات كافة الأعضاء.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={loading}
                className="px-4 py-2 rounded-xl text-stone-600 hover:bg-stone-100 text-xs font-bold transition"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold shadow-xs transition"
              >
                {loading ? 'جاري الحذف...' : 'نعم، حذف الخاطرة'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

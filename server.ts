import './src/lib/suppressFirestoreWarnings';
import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { createServer as createViteServer } from 'vite';
import { User, GroupSettings, RestDay, RecitationLog, RevisionLog, CycleInfo } from './src/types';
import { calculateCycleInfo, calculateMemberRequiredQuarter, formatDate, getCalendarDaysElapsed, getActiveCycleDates } from './src/lib/calculations';
import * as firestoreService from './src/server/firestoreService';
import firebaseConfig from './firebase-applet-config.json';

const app = express();
const PORT = 3000;

app.use(express.json());

// Database storage setup
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

// Default initial password hash using bcrypt
const DEFAULT_SAMPLE_PASSWORD_HASH = bcrypt.hashSync('password123', 10);

interface DatabaseSchema {
  users: (User & { password_hash: string })[];
  settings: GroupSettings;
  restDays: RestDay[];
  recitationLogs: RecitationLog[];
  revisionLogs: RevisionLog[];
}

function getInitialData(): DatabaseSchema {
  // Set start_date 8 calendar days ago so that today is Day 9 (matches sample timeline)
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 8);
  const startDateStr = formatDate(startDate);
  const todayStr = formatDate(today);

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = formatDate(yesterday);

  return {
    settings: {
      id: 'group_main',
      start_date: todayStr,
      total_quarters: 240,
      review_window: 8,
      current_cycle_number: 1,
      is_paused: false,
      paused_at: null,
      total_paused_days: 0,
      daily_thought: '<b>قال الضحاك ابن مزاحم:</b><div>ما من أحد تعلم القرآن ثم نسيه إلا <b>بذنب </b>يحدثه؛ لأن الله تعالى يقول " وما أصابكم من مصيبة فبما كسبت أيديكم " <b>وإن نسيان القرآن من أعظم المصائب.&nbsp;</b></div>',
      daily_thought_updated_by: 'علي عزب',
      daily_thought_updated_at: new Date().toISOString(),
    },
    users: [
      {
        id: 'user_1789671961832_9tr6z',
        name: 'علي عزب',
        phone: '01098091029',
        password_hash: '$2b$10$Nrp8p.yhLr6hQCkEDUYIvuY0Cq6B1JWrlCIQQYGXPa7bvXGj.Iudi',
        role: 'admin',
        is_active: true,
        created_at: '2026-09-17T19:06:01.832Z',
      },
      {
        id: 'user_admin_2',
        name: 'إبراهيم بهي الدين',
        phone: '01119162336',
        password_hash: '$2b$10$4VPk9dLJdd72s5BdWChx0e7d4fmV0MwGDeUJln6TN9Ev2XuFD8CD2',
        role: 'admin',
        is_active: true,
        created_at: '2026-09-17T12:00:00.000Z',
      },
    ],
    restDays: [],
    recitationLogs: [],
    revisionLogs: [],
  };
}

function loadDatabase(): DatabaseSchema {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      const initial = getInitialData();
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as any;

    if (parsed.settings) {
      parsed.settings.is_paused = !!parsed.settings.is_paused;
      parsed.settings.paused_at = parsed.settings.paused_at || null;
      parsed.settings.total_paused_days = parsed.settings.total_paused_days || 0;
      delete parsed.settings.max_errors_allowed;
      delete parsed.settings.fine_amount_per_missed_quarter;
    }

    if (Array.isArray(parsed.recitationLogs)) {
      parsed.recitationLogs.forEach((l: any) => {
        if (!l.member_id && l.reciter_id) l.member_id = l.reciter_id;
        if (!l.member_name && l.reciter_name) l.member_name = l.reciter_name;
        delete l.error_count;
        delete l.status;
      });
    }

    return parsed;
  } catch (err) {
    console.error('Error reading database, falling back to initial data:', err);
    return getInitialData();
  }
}

function saveDatabase(data: DatabaseSchema): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing database:', err);
  }
}

let db = loadDatabase();
const sessions = new Map<string, string>();

// Synchronization helper with live Firestore
async function syncFromFirestore(): Promise<void> {
  try {
    const [liveUsers, liveSettings, liveRestDays, liveRecitations, liveRevisions] =
      await Promise.all([
        firestoreService.getLiveUsers(),
        firestoreService.getLiveSettings(),
        firestoreService.getLiveRestDays(),
        firestoreService.getLiveRecitations(),
        firestoreService.getLiveRevisions(),
      ]);

    if (liveUsers && liveUsers.length > 0) {
      db.users = liveUsers;
    }
    if (liveSettings) {
      db.settings = liveSettings;
    }
    if (liveRestDays) {
      db.restDays = liveRestDays;
    }
    if (liveRecitations) {
      db.recitationLogs = liveRecitations;
    }
    if (liveRevisions) {
      db.revisionLogs = liveRevisions;
    }
    saveDatabase(db);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Firestore Sync Warning]', msg);
  }
}

// Perform initial connection check & seed if Firestore is empty
firestoreService.testFirestoreConnection().then(async (status) => {
  if (status.success) {
    console.log(`[Firestore LIVE] Successfully connected to project: ${firebaseConfig.projectId}`);
    await firestoreService.seedFirestoreIfEmpty(db);
    await syncFromFirestore();
  } else {
    console.warn(`[Firestore Status Warning] ${status.error}`);
  }
});

function getAuthUser(req: Request): (User & { password_hash: string }) | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '').trim();
  const userId = sessions.get(token);
  if (!userId) return null;
  return db.users.find((u) => u.id === userId) || null;
}

/**
 * Resolve today's date in YYYY-MM-DD format:
 * 1. Checks client's local date sent via X-Client-Date header
 * 2. Checks client_date query param
 * 3. Falls back to Makkah time (Asia/Riyadh, UTC+3)
 */
function getTodayDate(req?: Request): string {
  const headerDate = req?.headers?.['x-client-date'] as string | undefined;
  if (headerDate && /^\d{4}-\d{2}-\d{2}$/.test(headerDate)) {
    return headerDate;
  }
  const queryDate = (req?.query?.client_date || req?.query?.date) as string | undefined;
  if (queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
    return queryDate;
  }
  return formatDate(new Date(), 'Asia/Riyadh');
}

// ==================== API ROUTES ====================

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Firestore Live Status Diagnostic endpoint
app.get('/api/firestore/status', async (req: Request, res: Response) => {
  const result = await firestoreService.testFirestoreConnection();
  res.json({
    projectId: firebaseConfig.projectId,
    databaseId: (firebaseConfig as any).firestoreDatabaseId || '(default)',
    connected: result.success,
    error: result.error || null,
  });
});

// Authentication
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'يرجى إدخال رقم الهاتف وكلمة المرور' });
  }

  const normalizedPhone = String(phone).trim();
  let user = db.users.find((u) => u.phone === normalizedPhone);

  // If user is not found in local memory, sync only users from Firestore as a quick fallback
  if (!user) {
    try {
      const liveUsers = await firestoreService.getLiveUsers();
      if (liveUsers && liveUsers.length > 0) {
        db.users = liveUsers;
        saveDatabase(db);
        user = db.users.find((u) => u.phone === normalizedPhone);
      }
    } catch (uErr) {
      console.warn('[Login user lookup fallback warning]', uErr);
    }
  }

  if (!user) {
    return res.status(401).json({ error: 'رقم الهاتف أو كلمة المرور غير صحيحة' });
  }

  let isPasswordValid = false;
  const storedHash = user.password_hash || '';

  // Use bcrypt.compare if stored hash is a bcrypt hash ($2a$, $2b$, $2y$)
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
    isPasswordValid = await bcrypt.compare(String(password), storedHash);
  } else {
    // Backward compatibility for legacy plain-text passwords: verify and immediately upgrade to bcrypt
    if (storedHash === String(password)) {
      isPasswordValid = true;
      try {
        const upgradedHash = await bcrypt.hash(String(password), 10);
        user.password_hash = upgradedHash;
        saveDatabase(db);
        await firestoreService.updateLiveUser(user.id, { password_hash: upgradedHash });
        console.log(`[Auth] Automatically migrated legacy password for user ${user.id} to bcrypt hash.`);
      } catch (upgradeErr) {
        console.warn('[Auth] Legacy password migration error:', upgradeErr);
      }
    }
  }

  if (!isPasswordValid) {
    return res.status(401).json({ error: 'رقم الهاتف أو كلمة المرور غير صحيحة' });
  }

  // Note: Excluded members (!user.is_active) are permitted to log in to view their status,
  // but cannot record recitation or revision.

  const token = `tok_${user.id}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  sessions.set(token, user.id);

  const { password_hash, ...safeUser } = user;
  res.json({ user: safeUser, token });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'غير مسجل الدخول' });
  }
  const { password_hash, ...safeUser } = user;
  res.json({ user: safeUser });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '').trim();
    sessions.delete(token);
  }
  res.json({ success: true });
});

// Change Password (Authenticated User)
app.post('/api/auth/change-password', async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
  }

  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'يرجى إدخال كلمة المرور الحالية وكلمة المرور الجديدة' });
  }

  let isCurrentValid = false;
  const storedHash = user.password_hash || '';
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
    isCurrentValid = await bcrypt.compare(String(currentPassword), storedHash);
  } else {
    isCurrentValid = (storedHash === String(currentPassword));
  }

  if (!isCurrentValid) {
    return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  }

  const trimmedNewPassword = String(newPassword).trim();
  if (!trimmedNewPassword) {
    return res.status(400).json({ error: 'لا يمكن أن تكون كلمة المرور الجديدة فارغة' });
  }

  if (trimmedNewPassword.length < 4) {
    return res.status(400).json({ error: 'يجب ألا تقل كلمة المرور الجديدة عن 4 خانات' });
  }

  if (confirmPassword !== undefined && trimmedNewPassword !== String(confirmPassword).trim()) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة وتأكيدها غير متطابقين' });
  }

  const hashedNewPassword = await bcrypt.hash(trimmedNewPassword, 10);

  // Write to Firestore FIRST - do not save locally or return success if Firestore fails!
  try {
    await firestoreService.updateLiveUser(user.id, { password_hash: hashedNewPassword });
  } catch (fsErr: unknown) {
    const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
    console.error('[Firestore Change Password Error]', msg);
    return res.status(500).json({
      error: 'فشل حفظ كلمة المرور الجديدة في قاعدة البيانات السحابية (Firestore). لم يتم تطبيق التغيير، يرجى المحاولة ثانية.',
    });
  }

  user.password_hash = hashedNewPassword;
  saveDatabase(db);

  res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
});

// Bootstrap / Global State - Reads live from Firestore!
app.get('/api/bootstrap', async (req: Request, res: Response) => {
  // Sync live state from Firestore
  await syncFromFirestore();

  const todayStr = getTodayDate(req);
  const cycleInfo = calculateCycleInfo(db.settings, db.restDays, todayStr);

  const safeUsers = db.users
    .map(({ password_hash, ...u }) => u);

  const todayRecitations = db.recitationLogs.filter((r) => r.date === todayStr);
  const todayRevisions = db.revisionLogs.filter((r) => r.date === todayStr);

  res.json({
    cycleInfo,
    settings: db.settings,
    restDays: db.restDays,
    users: safeUsers,
    todayRecitations,
    todayRevisions,
  });
});

// Recitation logs list
app.get('/api/recitations', (req: Request, res: Response) => {
  const { member_id, reciter_id, date, limit } = req.query;
  let logs = [...db.recitationLogs];

  const targetMember = member_id || reciter_id;
  if (targetMember) {
    logs = logs.filter((l) => l.member_id === targetMember || l.reciter_id === targetMember);
  }
  if (date) {
    logs = logs.filter((l) => l.date === date);
  }

  logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (limit) {
    const num = parseInt(String(limit), 10);
    if (!isNaN(num)) logs = logs.slice(0, num);
  }

  res.json({ recitations: logs });
});

// Record a Recitation: Member registers for themselves!
app.post('/api/recitations', async (req: Request, res: Response) => {
  const currentUser = getAuthUser(req);
  if (!currentUser) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
  }

  if (currentUser.role === 'admin') {
    return res.status(403).json({ error: 'المشرف لا يسجل تسميعًا' });
  }

  if (!currentUser.is_active) {
    return res.status(403).json({
      error: 'حسابك مُعلّق (مُقصَى) حاليًا بقرار من المشرف، ولا يمكنك تسجيل التسميع حتى تتم إعادة تفعيلك.',
    });
  }

  const { quarter_number, listener_id, notes, date } = req.body;
  const logDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getTodayDate(req);

  // Rule: Sequential catch-up requirement (can recite multiple missed quarters in the same day)
  const currentCycleInfo = calculateCycleInfo(db.settings, db.restDays, logDate);

  if (!currentCycleInfo.has_started) {
    return res.status(400).json({
      error: 'برنامج المقرأة لم يبدأ بعد! سيبدأ البرنامج بإذن الله يوم الجمعة 18 سبتمبر 2026 الساعة 12:00 صباحًا، وسيتاح تسجيل التسميع حينها.',
    });
  }

  const memberQuarterStatus = calculateMemberRequiredQuarter(
    currentUser.id,
    currentCycleInfo.quarter_of_day,
    db.recitationLogs
  );

  // Check if member has already completed all quarters up to the group's current quarter of day
  if (memberQuarterStatus.allCompletedUpToToday) {
    return res.status(400).json({
      error: `لقد أتممت بالفعل جميع الأرباع حتى ربع اليوم الحالي للمجموعة (الربع ${currentCycleInfo.quarter_of_day}). لا يمكن تسجيل ربع أكبر من ربع اليوم للمجموعة (لا يمكن السبق على الجدول الزمني الجماعي).`,
    });
  }

  const quarter = parseInt(String(quarter_number), 10);
  if (isNaN(quarter) || quarter !== memberQuarterStatus.requiredQuarter) {
    return res.status(400).json({
      error: `لا يمكن تخطي الربع الفائت! الربع المطلوب منك تسميعه الآن هو الربع رقم (${memberQuarterStatus.requiredQuarter}). يجب تسميع الأرباع السابقة بالترتيب أولاً.`,
    });
  }

  // Rule: Cannot advance past the group's current quarter of day
  if (quarter > currentCycleInfo.quarter_of_day) {
    return res.status(400).json({
      error: `لا يمكن تسجيل ربع أكبر من ربع اليوم الحالي للمجموعة (الربع ${currentCycleInfo.quarter_of_day}). لا يمكن السبق على الخطة الجماعية.`,
    });
  }

  // Guard against duplicate records for the exact same quarter
  const alreadyCompletedQuarter = db.recitationLogs.some(
    (r) => (r.member_id === currentUser.id || r.reciter_id === currentUser.id) && r.quarter_number === quarter
  );
  if (alreadyCompletedQuarter) {
    return res.status(400).json({
      error: `الربع رقم (${quarter}) مسجل ومكتمل لديك بالفعل.`,
    });
  }

  // Required listener colleague (strictly from group members - cannot recite to outside person)
  if (!listener_id) {
    return res.status(400).json({
      error: 'يرجى اختيار الزميل المستمع من أعضاء المقرأة (لا يُسمح بالتسميع على شخص من الخارج).',
    });
  }

  const peer = db.users.find(
    (u) => u.id === listener_id && u.is_active && u.role === 'member' && u.id !== currentUser.id
  );
  if (!peer) {
    return res.status(400).json({
      error: 'الزميل المستمع المحدد غير صالح. يجب اختيار زميل نشط من أعضاء المقرأة.',
    });
  }

  const peerId = peer.id;
  const peerName = peer.name;

  const newLog: RecitationLog = {
    id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    member_id: currentUser.id,
    member_name: currentUser.name,
    listener_id: peerId,
    listener_name: peerName,
    quarter_number: quarter,
    cycle_number: db.settings.current_cycle_number,
    date: logDate,
    created_at: new Date().toISOString(),
    reciter_id: currentUser.id,
    reciter_name: currentUser.name,
    ...(notes && String(notes).trim() ? { notes: String(notes).trim() } : {}),
  };

  // Write to Firestore FIRST - do NOT save locally or return success if Firestore fails!
  try {
    await firestoreService.addLiveRecitation(newLog);
  } catch (fsErr: unknown) {
    const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
    console.error('[Firestore Recitation Write Error]', msg);
    return res.status(500).json({
      error: 'فشل حفظ سجل التسميع في قاعدة البيانات السحابية (Firestore). يرجى التحقق من اتصال الإنترنت والمحاولة مرة أخرى.',
    });
  }

  db.recitationLogs.push(newLog);
  saveDatabase(db);

  res.status(201).json({
    recitation: newLog,
    message: `تم تسجيل إتمام تسميع الربع ${quarter} بنجاح وتقبل الله منكم!`,
  });
});

// Revision logs list
app.get('/api/revisions', (req: Request, res: Response) => {
  const { member_id, date } = req.query;
  let logs = [...db.revisionLogs];

  if (member_id) {
    logs = logs.filter((l) => l.member_id === member_id);
  }
  if (date) {
    logs = logs.filter((l) => l.date === date);
  }

  logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  res.json({ revisions: logs });
});

// Record Daily Revision (Member for themselves)
app.post('/api/revisions', async (req: Request, res: Response) => {
  const currentUser = getAuthUser(req);
  if (!currentUser) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
  }

  if (currentUser.role === 'admin') {
    return res.status(403).json({ error: 'المشرف لا يسجل مراجعة' });
  }

  if (!currentUser.is_active) {
    return res.status(403).json({
      error: 'حسابك مُعلّق (مُقصَى) حاليًا بقرار من المشرف، ولا يمكنك تسجيل المراجعة حتى تتم إعادة تفعيلك.',
    });
  }

  const { notes, date } = req.body;
  const todayDate = getTodayDate(req);
  const logDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayDate;

  // Validate date: must be within valid active cycle dates from start date up to today
  const startDate = db.settings.start_date;
  if (!startDate || logDate < startDate) {
    return res.status(400).json({
      error: 'التاريخ المحدد غير صالح: لا يمكن تسجيل مراجعة لتاريخ يسبق بداية برنامج المقرأة.',
    });
  }

  if (logDate > todayDate) {
    return res.status(400).json({
      error: 'التاريخ المحدد غير صالح: لا يمكن تسجيل مراجعة لتاريخ مستقبلي بعد اليوم الحالي.',
    });
  }

  // Check if date was a rest day
  const isRestDay = db.restDays.some((rd) => rd.date === logDate);
  if (isRestDay) {
    return res.status(400).json({
      error: 'التاريخ المحدد كان يوم راحة/استدراك للمجموعة، ولا يتطلب تسجيل مراجعة رسمية.',
    });
  }

  // Check if active cycle date (handles paused days as well)
  const activeDates = getActiveCycleDates(startDate, todayDate, db.restDays, db.settings);
  if (!activeDates.includes(logDate)) {
    return res.status(400).json({
      error: 'التاريخ المحدد ليس يومًا نشطًا في دورة المقرأة الحالية.',
    });
  }

  const cycleInfo = calculateCycleInfo(db.settings, db.restDays, logDate);

  if (!cycleInfo.has_started) {
    return res.status(400).json({
      error: 'برنامج المقرأة لم يبدأ بعد في التاريخ المحدد.',
    });
  }

  const existingIndex = db.revisionLogs.findIndex(
    (r) => r.member_id === currentUser.id && r.date === logDate
  );

  if (existingIndex >= 0) {
    return res.status(400).json({
      error: 'تم تأكيد مراجعة هذا اليوم مسبقًا، وتأكيد المراجعة نهائي وغير قابل للتعديل.',
    });
  }

  const newRevision: RevisionLog = {
    id: `rev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    member_id: currentUser.id,
    member_name: currentUser.name,
    date: logDate,
    cycle_number: db.settings.current_cycle_number,
    review_start_quarter: cycleInfo.review_start,
    review_end_quarter: cycleInfo.review_end,
    created_at: new Date().toISOString(),
    ...(notes && String(notes).trim() ? { notes: String(notes).trim() } : {}),
  };

  // Write to Firestore FIRST - do NOT save locally or return success if Firestore fails!
  try {
    await firestoreService.addLiveRevision(newRevision);
  } catch (fsErr: unknown) {
    const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
    console.error('[Firestore Revision Write Error]', msg);
    return res.status(500).json({
      error: 'فشل حفظ سجل المراجعة في قاعدة البيانات السحابية (Firestore). يرجى التحقق من اتصال الإنترنت والمحاولة مرة أخرى.',
    });
  }

  db.revisionLogs.push(newRevision);
  saveDatabase(db);

  res.status(201).json({
    revision: newRevision,
    message: `تم تسجيل إتمام مراجعة ${logDate === todayDate ? 'اليوم' : `يوم ${logDate}`} (من الربع ${cycleInfo.review_start} إلى ${cycleInfo.review_end}) بنجاح`,
  });
});

// ==================== ADMIN ENDPOINTS ====================

function requireAdmin(req: Request, res: Response, next: () => void) {
  const user = getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'هذا الإجراء مخصص للمشرف فقط' });
  }
  next();
}

// Add member (Admin only)
app.post('/api/admin/members', requireAdmin, async (req: Request, res: Response) => {
  const { name, phone, password, role } = req.body;

  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'الاسم ورقم الهاتف وكلمة المرور مطلوبة' });
  }

  // Refresh from Firestore first to ensure phone uniqueness
  await syncFromFirestore();

  const normalizedPhone = String(phone).trim();
  const existingUser = db.users.find((u) => u.phone === normalizedPhone);
  if (existingUser) {
    return res.status(400).json({ error: 'رقم الهاتف هذا مسجل بالفعل لعضو آخر' });
  }

  const hashedPassword = await bcrypt.hash(String(password).trim(), 10);

  const newUser: User & { password_hash: string } = {
    id: `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: String(name).trim(),
    phone: normalizedPhone,
    password_hash: hashedPassword,
    role: role === 'admin' ? 'admin' : 'member',
    is_active: true,
    created_at: new Date().toISOString(),
  };

  // Write directly to Firestore 'users' collection FIRST - do NOT save locally if Firestore fails!
  try {
    await firestoreService.createLiveUser(newUser);
  } catch (fsErr: unknown) {
    const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
    console.error('[Firestore Member Write Error]', msg);
    return res.status(500).json({
      error: 'فشل حفظ بيانات العضو الجديد في قاعدة البيانات السحابية (Firestore). لم تتم إضافة العضو، يرجى المحاولة ثانية.',
    });
  }

  db.users.push(newUser);
  saveDatabase(db);

  const { password_hash, ...safeUser } = newUser;
  res.status(201).json({ user: safeUser, message: 'تمت إضافة العضو بنجاح' });
});

// Update member (Admin only)
app.patch('/api/admin/members/:id', requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, phone, password, role, is_active } = req.body;

  const user = db.users.find((u) => u.id === id);
  if (!user) {
    return res.status(404).json({ error: 'العضو غير موجود' });
  }

  const updates: Partial<User & { password_hash: string }> = {};

  if (name) {
    updates.name = String(name).trim();
  }
  if (phone) {
    const norm = String(phone).trim();
    const conflict = db.users.find((u) => u.phone === norm && u.id !== id);
    if (conflict) return res.status(400).json({ error: 'رقم الهاتف مستخدم لعضو آخر' });
    updates.phone = norm;
  }
  if (password) {
    const trimmedPassword = String(password).trim();
    if (trimmedPassword) {
      updates.password_hash = await bcrypt.hash(trimmedPassword, 10);
    }
  }
  if (role && (role === 'member' || role === 'admin')) {
    updates.role = role;
  }
  if (typeof is_active === 'boolean') {
    updates.is_active = is_active;
  }

  // Update directly in Firestore FIRST - do NOT save locally if Firestore fails!
  try {
    await firestoreService.updateLiveUser(id, updates);
  } catch (fsErr: unknown) {
    const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
    console.error('[Firestore Member Update Error]', msg);
    return res.status(500).json({
      error: 'فشل تحديث بيانات العضو في قاعدة البيانات السحابية (Firestore). لم يتم حفظ التعديلات، يرجى المحاولة مرة أخرى.',
    });
  }

  Object.assign(user, updates);
  saveDatabase(db);

  const { password_hash, ...safeUser } = user;
  res.json({ user: safeUser, message: 'تم تحديث بيانات العضو بنجاح' });
});

// Admin: Delete member completely and permanently with all their recitation and revision logs
app.delete('/api/admin/members/:id/completely', requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;

  const user = db.users.find((u) => u.id === id);
  if (!user) {
    return res.status(404).json({ error: 'العضو غير موجود' });
  }

  if (user.role === 'admin') {
    return res.status(400).json({ error: 'لا يمكن حذف حساب المشرف' });
  }

  const userName = user.name;

  // Delete permanently from Firestore FIRST - do NOT mutate local state if Firestore fails!
  try {
    await firestoreService.deleteLiveUser(id);
    await firestoreService.deleteLiveRecitationsForMember(id);
    await firestoreService.deleteLiveRevisionsForMember(id);
  } catch (fsErr: unknown) {
    const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
    console.error('[Firestore Member Complete Delete Error]', msg);
    return res.status(500).json({
      error: 'فشل حذف العضو وسجلاته من قاعدة البيانات السحابية (Firestore). لم يتم حذف العضو، يرجى المحاولة مرة أخرى.',
    });
  }

  // 1. Remove user from db.users
  db.users = db.users.filter((u) => u.id !== id);

  // 2. Remove all recitation logs for this member
  const initialRecCount = db.recitationLogs.length;
  db.recitationLogs = db.recitationLogs.filter(
    (r) => r.member_id !== id && r.reciter_id !== id
  );
  const deletedRecsCount = initialRecCount - db.recitationLogs.length;

  // 3. Remove all revision logs for this member
  const initialRevCount = db.revisionLogs.length;
  db.revisionLogs = db.revisionLogs.filter((r) => r.member_id !== id);
  const deletedRevsCount = initialRevCount - db.revisionLogs.length;

  // 4. Invalidate any active session for this user
  for (const [token, uid] of sessions.entries()) {
    if (uid === id) {
      sessions.delete(token);
    }
  }

  saveDatabase(db);

  res.json({
    success: true,
    message: `تم حذف العضو "${userName}" نهائيًا ومسح كافة سجلات التسميع (${deletedRecsCount}) وسجلات المراجعة (${deletedRevsCount}) الخاصة به.`,
  });
});

// Rest Days: Add (Admin only)
app.post('/api/admin/rest-days', requireAdmin, async (req: Request, res: Response) => {
  const admin = getAuthUser(req)!;
  const { date, note } = req.body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'يرجى تحديد تاريخ صحيح ليوم الاستدراك والراحة (YYYY-MM-DD)' });
  }

  const existing = db.restDays.find((rd) => rd.date === date);
  if (existing) {
    return res.status(400).json({ error: 'هذا التاريخ مسجل بالفعل كيوم استدراك وراحة' });
  }

  const newRestDay: RestDay = {
    id: `rest_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    date,
    note: note ? String(note).trim() : 'يوم استدراك وراحة للمجموعة',
    added_by_admin_id: admin.id,
    added_by_name: admin.name,
    created_at: new Date().toISOString(),
  };

  // Save to Firestore FIRST - do NOT mutate local state if Firestore fails!
  try {
    await firestoreService.addLiveRestDay(newRestDay);
  } catch (fsErr: unknown) {
    const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
    console.error('[Firestore Rest Day Write Error]', msg);
    return res.status(500).json({
      error: 'فشل حفظ يوم الاستدراك والراحة في قاعدة البيانات السحابية (Firestore). لم يتم الحفظ، يرجى المحاولة ثانية.',
    });
  }

  db.restDays.push(newRestDay);
  saveDatabase(db);

  res.status(201).json({ restDay: newRestDay, message: 'تمت إضافة يوم الاستدراك والراحة بنجاح' });
});

// Rest Days: Delete (Admin only)
app.delete('/api/admin/rest-days/:id', requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const target = db.restDays.find((rd) => rd.id === id);

  if (!target) {
    return res.status(404).json({ error: 'يوم الاستدراك غير موجود' });
  }

  // Delete from Firestore FIRST - do NOT mutate local state if Firestore fails!
  try {
    await firestoreService.deleteLiveRestDay(id);
  } catch (fsErr: unknown) {
    const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
    console.error('[Firestore Rest Day Delete Error]', msg);
    return res.status(500).json({
      error: 'فشل حذف يوم الاستدراك من قاعدة البيانات السحابية (Firestore). لم يتم الحذف، يرجى المحاولة ثانية.',
    });
  }

  db.restDays = db.restDays.filter((rd) => rd.id !== id);
  saveDatabase(db);

  res.json({ success: true, message: 'تم حذف يوم الاستدراك والراحة' });
});

// Pause the program (Admin only)
app.post('/api/admin/pause', requireAdmin, async (req: Request, res: Response) => {
  const todayStr = getTodayDate(req);
  if (db.settings.is_paused) {
    return res.json({ settings: db.settings, message: 'البرنامج متوقف مؤقتًا بالفعل.' });
  }

  const updatedSettings: GroupSettings = {
    ...db.settings,
    is_paused: true,
    paused_at: todayStr,
  };

  // Write to Firestore FIRST
  try {
    await firestoreService.saveLiveSettings(updatedSettings);
  } catch (fsErr: unknown) {
    const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
    console.error('[Firestore Settings Write Error]', msg);
    return res.status(500).json({
      error: 'فشل حفظ تفعيل الإيقاف المؤقت في قاعدة البيانات السحابية (Firestore). يرجى المحاولة ثانية.',
    });
  }

  db.settings = updatedSettings;
  saveDatabase(db);

  const cycleInfo = calculateCycleInfo(db.settings, db.restDays, todayStr);
  res.json({
    settings: db.settings,
    cycleInfo,
    message: 'تم تفعيل الإيقاف المؤقت للبرنامج وتجميد عداد الدورة لجميع الأعضاء بنجاح.',
  });
});

// Resume the program (Admin only)
app.post('/api/admin/resume', requireAdmin, async (req: Request, res: Response) => {
  const todayStr = getTodayDate(req);
  if (!db.settings.is_paused) {
    return res.json({ settings: db.settings, message: 'البرنامج غير متوقف حاليًا.' });
  }

  let additionalDays = 0;
  if (db.settings.paused_at) {
    additionalDays = getCalendarDaysElapsed(db.settings.paused_at, todayStr);
  }

  const updatedSettings: GroupSettings = {
    ...db.settings,
    total_paused_days: (db.settings.total_paused_days || 0) + additionalDays,
    is_paused: false,
    paused_at: null,
  };

  // Write to Firestore FIRST
  try {
    await firestoreService.saveLiveSettings(updatedSettings);
  } catch (fsErr: unknown) {
    const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
    console.error('[Firestore Settings Write Error]', msg);
    return res.status(500).json({
      error: 'فشل حفظ استئناف البرنامج في قاعدة البيانات السحابية (Firestore). يرجى المحاولة ثانية.',
    });
  }

  db.settings = updatedSettings;
  saveDatabase(db);

  const cycleInfo = calculateCycleInfo(db.settings, db.restDays, todayStr);
  res.json({
    settings: db.settings,
    cycleInfo,
    message: 'تم استئناف البرنامج بنجاح ومواصلة الدورة.',
  });
});

// Update Settings: start_date (Admin only)
app.put('/api/admin/settings', requireAdmin, async (req: Request, res: Response) => {
  const { start_date } = req.body;

  const updatedSettings: GroupSettings = {
    ...db.settings,
    ...(start_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date) ? { start_date } : {}),
  };

  // Write to Firestore FIRST
  try {
    await firestoreService.saveLiveSettings(updatedSettings);
  } catch (fsErr: unknown) {
    const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
    console.error('[Firestore Settings Write Error]', msg);
    return res.status(500).json({
      error: 'فشل حفظ إعدادات المجموعة في قاعدة البيانات السحابية (Firestore). يرجى المحاولة ثانية.',
    });
  }

  db.settings = updatedSettings;
  saveDatabase(db);

  res.json({ settings: db.settings, message: 'تم تحديث إعدادات المجموعة بنجاح' });
});

// Helper for server-side HTML sanitization (Defense in depth against XSS)
function sanitizeThoughtServer(input: string): string {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<\/?(iframe|object|embed|link|meta|style|form|input|button|applet|frame|frameset)\b[^>]*>/gi, '')
    .replace(/\s*on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:[^"'\s]*/gi, '')
    .trim();
}

// Update Daily Thought (Admin only)
app.put('/api/admin/daily-thought', requireAdmin, async (req: Request, res: Response) => {
  const admin = getAuthUser(req)!;
  const { daily_thought } = req.body;

  const clean = sanitizeThoughtServer(daily_thought || '');

  const updatedSettings: GroupSettings = {
    ...db.settings,
    daily_thought: clean,
    daily_thought_updated_at: new Date().toISOString(),
    daily_thought_updated_by: admin.name,
  };

  // Write to Firestore FIRST
  try {
    await firestoreService.saveLiveSettings(updatedSettings);
  } catch (fsErr: unknown) {
    const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
    console.error('[Firestore Daily Thought Write Error]', msg);
    return res.status(500).json({
      error: 'فشل حفظ ونشر خاطرة اليوم في قاعدة البيانات السحابية (Firestore). يرجى المحاولة ثانية.',
    });
  }

  db.settings = updatedSettings;
  saveDatabase(db);

  res.json({
    settings: db.settings,
    message: 'تم حفظ ونشر خاطرة اليوم بنجاح لجميع الأعضاء',
  });
});

// Delete Daily Thought (Admin only)
app.delete('/api/admin/daily-thought', requireAdmin, async (req: Request, res: Response) => {
  const updatedSettings: GroupSettings = {
    ...db.settings,
    daily_thought: '',
  };
  delete updatedSettings.daily_thought_updated_at;
  delete updatedSettings.daily_thought_updated_by;

  // Write to Firestore FIRST
  try {
    await firestoreService.saveLiveSettings(updatedSettings);
  } catch (fsErr: unknown) {
    const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
    console.error('[Firestore Daily Thought Delete Error]', msg);
    return res.status(500).json({
      error: 'فشل حذف خاطرة اليوم من قاعدة البيانات السحابية (Firestore). يرجى المحاولة ثانية.',
    });
  }

  db.settings = updatedSettings;
  saveDatabase(db);

  res.json({
    settings: db.settings,
    message: 'تم حذف خاطرة اليوم بالكامل ولن تظهر في لوحة الأعضاء',
  });
});

// Factory Reset (Admin only)
app.post('/api/admin/factory-reset', requireAdmin, async (req: Request, res: Response) => {
  const todayStr = getTodayDate(req);

  const resetSettings: GroupSettings = {
    ...db.settings,
    start_date: todayStr,
    current_cycle_number: 1,
    is_paused: false,
    paused_at: null,
    total_paused_days: 0,
  };

  // Clear Firestore collections and reset settings FIRST
  try {
    await firestoreService.saveLiveSettings(resetSettings);
    await firestoreService.clearAllLiveLogsAndRestDays();
  } catch (fsErr: unknown) {
    const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
    console.error('[Firestore Factory Reset Error]', msg);
    return res.status(500).json({
      error: 'فشل تنفيذ إعادة ضبط المصنع في قاعدة البيانات السحابية (Firestore). يرجى المحاولة ثانية.',
    });
  }

  db.settings = resetSettings;
  db.recitationLogs = [];
  db.revisionLogs = [];
  db.restDays = [];
  saveDatabase(db);

  const cycleInfo = calculateCycleInfo(db.settings, db.restDays, todayStr);

  res.json({
    success: true,
    message: 'تمت إعادة ضبط المصنع ومسح جميع السجلات نهائيًا بنجاح. عادت الدورة إلى اليوم الأول (الربع رقم 1) ورقم الدورة 1.',
    cycleInfo,
    settings: db.settings,
  });
});

// Simplified Admin Statistics
app.get('/api/admin/stats', requireAdmin, (req: Request, res: Response) => {
  const todayStr = getTodayDate(req);
  const cycleInfo = calculateCycleInfo(db.settings, db.restDays, todayStr);
  const members = db.users.filter((u) => u.role === 'member' && u.is_active);

  const memberStats = members.map((m) => {
    const todayRecitation = db.recitationLogs.find(
      (r) => (r.member_id === m.id || r.reciter_id === m.id) && r.date === todayStr
    );

    const todayRevision = db.revisionLogs.find(
      (r) => r.member_id === m.id && r.date === todayStr
    );

    const totalRecitations = db.recitationLogs.filter(
      (r) => r.member_id === m.id || r.reciter_id === m.id
    ).length;

    const totalRevisions = db.revisionLogs.filter((r) => r.member_id === m.id).length;

    const quarterStatus = calculateMemberRequiredQuarter(
      m.id,
      cycleInfo.quarter_of_day,
      db.recitationLogs
    );

    return {
      id: m.id,
      name: m.name,
      phone: m.phone,
      has_recited_today: !!todayRecitation,
      recited_quarter: todayRecitation?.quarter_number,
      listener_name: todayRecitation?.listener_name,
      has_reviewed_today: !!todayRevision,
      total_recitations: totalRecitations,
      total_revisions: totalRevisions,
      required_quarter: quarterStatus.requiredQuarter,
      is_behind: quarterStatus.isBehind,
      missed_quarters_count: quarterStatus.pastMissedQuartersCount,
      missed_quarters: quarterStatus.pastMissedQuarters,
    };
  });

  const pendingRecitationToday = memberStats.filter((m) => !m.has_recited_today);
  const pendingRevisionToday = memberStats.filter((m) => !m.has_reviewed_today);
  const behindMembers = memberStats.filter((m) => m.is_behind);

  res.json({
    total_members: members.length,
    completed_recitation_count: memberStats.filter((m) => m.has_recited_today).length,
    completed_revision_count: memberStats.filter((m) => m.has_reviewed_today).length,
    pending_recitation_today: pendingRecitationToday,
    pending_revision_today: pendingRevisionToday,
    behind_members_count: behindMembers.length,
    member_stats: memberStats,
  });
});

// ==================== VITE / STATIC SERVING ====================

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Motqin server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Motqin server:', err);
});

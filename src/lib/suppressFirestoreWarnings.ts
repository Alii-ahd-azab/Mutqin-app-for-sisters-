import { setLogLevel as setFirestoreLogLevel } from 'firebase/firestore';
import { setLogLevel as setFirebaseLoggerLogLevel } from '@firebase/logger';

function isBloomFilterWarning(arg: unknown): boolean {
  if (!arg) return false;
  if (typeof arg === 'string') {
    return arg.includes('BloomFilter') || arg.includes('Invalid hash count');
  }
  if (arg instanceof Error) {
    return (
      arg.name.includes('BloomFilter') ||
      arg.message.includes('BloomFilter') ||
      arg.message.includes('Invalid hash count')
    );
  }
  return false;
}

export function initFirestoreWarningSuppression(): void {
  // 1. Configure Firebase logger and Firestore to error level only
  try {
    setFirestoreLogLevel('error');
  } catch {
    // ignore
  }

  try {
    setFirebaseLoggerLogLevel('error');
  } catch {
    // ignore
  }

  // 2. Intercept console.warn and console.error for any benign BloomFilter SDK internal logs
  if (typeof console !== 'undefined') {
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (args.some(isBloomFilterWarning)) {
        return;
      }
      originalWarn.apply(console, args);
    };

    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      if (args.some(isBloomFilterWarning)) {
        return;
      }
      originalError.apply(console, args);
    };
  }
}

// Automatically initialize when imported
initFirestoreWarningSuppression();

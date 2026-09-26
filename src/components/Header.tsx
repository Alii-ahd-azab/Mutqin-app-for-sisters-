import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { CycleInfo, User } from '../types';
import { LogOut, Shield, User as UserIcon, ChevronDown, Key } from 'lucide-react';
import { ChangePasswordModal } from './Modals';
import { SistersLogo } from './SistersLogo';
import { api } from '../api/client';

interface HeaderProps {
  cycleInfo?: CycleInfo | null;
  allUsers?: User[];
  onRefresh: () => void;
}

export const Header: React.FC<HeaderProps> = () => {
  const { currentUser, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  if (!currentUser) return null;

  const handleChangePassword = async (payload: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }) => {
    await api.changePassword(payload);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-pink-100 shadow-2xs">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand & App Title */}
        <div className="flex items-center gap-3">
          <SistersLogo size="md" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-stone-900 tracking-tight leading-none font-quran">
                مُتْقِن للنساء
              </h1>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-pink-50 text-pink-700 font-medium border border-pink-200">
                مقرأة الأخوات
              </span>
            </div>
            <p className="text-xs text-stone-400 hidden sm:block">
              منظومة الحفظ والمراجعة اليومية لحافظات القرآن الكريم
            </p>
          </div>
        </div>

        {/* User Info & Profile Menu */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              id="user-account-menu-button"
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-pink-50/50 hover:bg-pink-50 border border-pink-100 transition text-right cursor-pointer"
              title="بيانات الحساب"
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                currentUser.role === 'admin' ? 'bg-rose-500' : 'bg-pink-400'
              }`}>
                {currentUser.role === 'admin' ? <Shield className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
              </div>
              <div className="hidden sm:block text-xs">
                <div className="font-bold text-stone-900 leading-tight flex items-center gap-1">
                  {currentUser.name}
                  <ChevronDown className="w-3 h-3 text-stone-400" />
                </div>
                <div className="text-pink-600/80">
                  {currentUser.role === 'admin' ? 'مشرفة المقرأة' : 'أخت حافظة'}
                </div>
              </div>
            </button>

            {/* Profile Dropdown */}
            {showUserMenu && (
              <div className="absolute left-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-pink-100 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-3 py-2.5 border-b border-pink-50 text-xs">
                  <p className="font-bold text-stone-900">{currentUser.name}</p>
                  <p className="text-stone-500 text-[11px] mt-0.5 font-mono">{currentUser.phone}</p>
                  <div className="mt-1.5">
                    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      currentUser.role === 'admin' ? 'bg-rose-100 text-rose-800' : 'bg-pink-100 text-pink-700'
                    }`}>
                      {currentUser.role === 'admin' ? 'حساب المشرفة' : 'عضوة بالمقرأة'}
                    </span>
                  </div>
                </div>
                <div className="pt-1 space-y-0.5">
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      setIsChangePasswordOpen(true);
                    }}
                    className="w-full text-right px-3 py-2 text-xs text-stone-700 hover:bg-pink-50/60 flex items-center gap-2 font-medium cursor-pointer transition"
                  >
                    <Key className="w-3.5 h-3.5 text-pink-400" />
                    تغيير كلمة المرور
                  </button>
                  <button
                    onClick={() => {
                      logout();
                      setShowUserMenu(false);
                    }}
                    className="w-full text-right px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-medium cursor-pointer transition"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    تسجيل الخروج
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Logout standalone button */}
          <button
            id="logout-header-btn"
            onClick={logout}
            className="p-2 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer"
            title="تسجيل الخروج"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>

      <ChangePasswordModal
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
        onSubmit={handleChangePassword}
      />
    </header>
  );
};

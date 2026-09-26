import React from 'react';

interface SistersLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const SistersLogo: React.FC<SistersLogoProps> = ({ className = '', size = 'md' }) => {
  const sizeMap = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16',
  };

  const iconSize = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
    xl: 'w-8 h-8',
  };

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-400 via-rose-300 to-pink-200 text-white shadow-sm border border-pink-200/80 shrink-0 ${sizeMap[size]} ${className}`}
    >
      {/* Decorative floral/spiritual halo */}
      <svg
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${iconSize[size]} text-rose-950/80 drop-shadow-xs`}
      >
        {/* Open Quran Stand / Book silhouette */}
        <path
          d="M20 14.5C18.2 12.8 15.5 12 12 12C9.5 12 7.3 12.4 5.5 13.2C5.2 13.3 5 13.6 5 13.9V27.8C5 28.3 5.4 28.7 5.9 28.5C7.6 27.9 9.6 27.5 12 27.5C15.2 27.5 17.8 28.3 19.5 29.8C19.8 30.1 20.2 30.1 20.5 29.8C22.2 28.3 24.8 27.5 28 27.5C30.4 27.5 32.4 27.9 34.1 28.5C34.6 28.7 35 28.3 35 27.8V13.9C35 13.6 34.8 13.3 34.5 13.2C32.7 12.4 30.5 12 28 12C24.5 12 21.8 12.8 20 14.5Z"
          fill="currentColor"
          fillOpacity="0.88"
        />
        {/* Soft floral petals flourish above book */}
        <path
          d="M20 7C20.8 8.6 22 9.8 23.5 10.5C22 11.2 20.8 12.4 20 14C19.2 12.4 18 11.2 16.5 10.5C18 9.8 19.2 8.6 20 7Z"
          fill="#FFF1F2"
          fillOpacity="0.95"
        />
        {/* Central spine divider */}
        <line x1="20" y1="15" x2="20" y2="28" stroke="#FFF1F2" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  );
};

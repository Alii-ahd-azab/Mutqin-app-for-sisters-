import React from 'react';

interface SistersLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const SistersLogo: React.FC<SistersLogoProps> = ({
  className = '',
  size = 'md',
}) => {
  const sizeMap = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16',
  };

  return (
    <div
        className={`relative inline-flex items-center justify-center shrink-0 ${sizeMap[size]} ${className}`}

    >
      <img
       src="/site-logo-icon-sisters.svg"
        alt="متقن للنساء"
         className="w-full h-full object-cover"
/>
    </div>
  );
};
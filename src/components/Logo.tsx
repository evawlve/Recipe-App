"use client";

import Image from 'next/image';

interface LogoProps {
  withText?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export default function Logo({ 
  withText = false, 
  size = 'md', 
  className = '' 
}: LogoProps) {
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-14 w-14',
    lg: 'h-20 w-20',
    xl: 'h-[260px] w-[260px]'
  };
  
  const logoSrc = withText ? '/logo.svg' : '/logo-noLetters.svg';
  
  return (
    <div className={`${sizeClasses[size]} overflow-hidden flex items-center justify-center ${className}`}>
      <Image 
        src={logoSrc} 
        alt="Mealspire Logo" 
        width={180} 
        height={180} 
        className="h-full w-full object-contain logo-dark-mode"
      />
    </div>
  );
}

import React from 'react';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { cn } from './ui/utils';

interface UserAvatarProps {
  src?: string;
  name?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-10 h-10 text-sm',
};

function getInitials(name?: string): string {
  if (!name) return 'U';
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function UserAvatar({ src, name, className, size = 'md' }: UserAvatarProps) {
  return (
    <Avatar className={cn(sizeClasses[size], className)}>
      {src && <AvatarImage src={src} alt={name || 'User avatar'} />}
      <AvatarFallback className="bg-slate-200 text-slate-600 font-medium">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

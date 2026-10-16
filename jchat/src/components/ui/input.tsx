import * as React from 'react';
import { cn } from './utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#07c160]/40 focus-visible:border-[#07c160]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

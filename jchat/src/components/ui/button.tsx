import * as React from 'react';
import { cn } from './utils';

type Variant = 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary' | 'link';
type Size = 'default' | 'sm' | 'lg' | 'icon';

const VARIANT: Record<Variant, string> = {
  default: 'bg-[#07c160] text-white hover:bg-[#06ad55]',
  outline: 'border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700',
  ghost: 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700',
  destructive: 'bg-red-500 text-white hover:bg-red-600',
  secondary: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600',
  link: 'text-[#07c160] underline-offset-4 hover:underline'
};

const SIZE: Record<Size, string> = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 px-3 text-sm',
  lg: 'h-10 px-6',
  icon: 'h-9 w-9 p-0'
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#07c160]/40',
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = 'Button';

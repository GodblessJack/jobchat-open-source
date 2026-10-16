import React from 'react';
import { Menu, X } from 'lucide-react';
import logoImage from '../assets/logo.png';
import { UserAvatar } from './UserAvatar';

interface NavigationProps {
  isLoggedIn: boolean;
  user: { name: string; avatar: string } | null;
  onLogout: () => void;
  onLogin: () => void;
}

export function Navigation({ isLoggedIn, user, onLogout, onLogin }: NavigationProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  return (
    <nav className="bg-white/80 backdrop-blur-xl text-black sticky top-0 z-50 border-b border-black/5">
      <div className="max-w-[980px] mx-auto px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <a href="/" className="flex items-center">
              <img src={logoImage} alt="JobChat" className="h-7" />
            </a>
          </div>

          <div className="hidden md:flex items-center gap-8">
            <a href="#team" className="text-[14px] text-black/80 hover:text-black transition-colors duration-200">Team</a>
            <a href="#services" className="text-[14px] text-black/80 hover:text-black transition-colors duration-200">Services</a>
            <a href="#testimonials" className="text-[14px] text-black/80 hover:text-black transition-colors duration-200">Testimonials</a>
            <a href="#blog" className="text-[14px] text-black/80 hover:text-black transition-colors duration-200">Blog</a>
          </div>

          <div className="flex items-center gap-4">
            {isLoggedIn ? (
              <div className="hidden md:flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <UserAvatar src={user?.avatar} name={user?.name} size="sm" className="border border-gray-200" />
                  <span className="text-sm font-medium text-gray-700">{user?.name?.split(' ')[0]}</span>
                </div>
                <button
                  onClick={onLogout}
                  className="text-[13px] text-black/80 hover:text-black transition-colors duration-200"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={onLogin}
                className="hidden md:block px-4 py-1.5 rounded-full bg-black text-white text-[14px] hover:bg-black/90 transition-all duration-200"
              >
                Sign In
              </button>
            )}

            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-white border-t border-black/5 animate-in slide-in-from-top duration-300">
          <div className="max-w-[980px] mx-auto px-6 py-6 space-y-4">
            <a href="#team" className="block text-[15px] font-medium text-black/80">Team</a>
            <a href="#services" className="block text-[15px] font-medium text-black/80">Services</a>
            <a href="#testimonials" className="block text-[15px] font-medium text-black/80">Testimonials</a>
            <a href="#blog" className="block text-[15px] font-medium text-black/80">Blog</a>
            <hr className="border-black/5" />
            {isLoggedIn ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <UserAvatar src={user?.avatar} name={user?.name} size="md" />
                  <div>
                    <p className="text-[15px] font-semibold text-black">{user?.name}</p>
                    <p className="text-[13px] text-black/40">Authenticated with LinkedIn</p>
                  </div>
                </div>
                <button
                  onClick={onLogout}
                  className="w-full text-left text-[15px] font-medium text-red-600 py-2"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={onLogin}
                className="w-full bg-black text-white rounded-xl py-3 text-[15px] font-medium"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
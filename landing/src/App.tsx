import React, { useState, useEffect, useRef } from 'react';
import { Hero } from './components/Hero';
import { TeamSection } from './components/TeamSection';
import { ServicesSection } from './components/ServicesSection';
import { TestimonialsSection } from './components/TestimonialsSection';
import { BlogSection } from './components/BlogSection';
import { Footer } from './components/Footer';
import { Navigation } from './components/Navigation';
import { SEO } from './components/SEO';
import { SEO_CONFIG } from './config/seo';
import { LoginModal } from './components/LoginModal';
import { authService, User } from './lib/auth';
import { Toaster } from './components/ui/sonner';
import { toast } from 'sonner';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const hasInitialized = useRef(false);

  const handleLoginSuccess = (userData: User) => {
    setUser(userData);
    setIsLoggedIn(true);
    toast.success(`Welcome, ${userData.name || userData.username}!`, {
      description: 'Successfully signed in.',
      duration: 3000,
    });
  };

  const handleLoginClick = () => {
    setIsLoginModalOpen(true);
  };

  const handleLogout = async () => {
    await authService.logout();
    setUser(null);
    setIsLoggedIn(false);

    toast.success('Signed out successfully', {
      description: 'Hope to see you again soon',
      duration: 2000,
    });
  };

  // Check session on mount (cookie-based refresh + /me)
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const initAuth = async () => {
      setIsLoading(true);
      try {
        const session = await authService.checkSession();
        if (session.isAuthenticated && session.user) {
          setUser(session.user);
          setIsLoggedIn(true);
        }
      } catch (err) {
        console.error('Session check failed:', err);
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#0077b5] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-600 font-medium tracking-wide">Initializing secure session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fbfbfd]">
      <SEO
        title={SEO_CONFIG.defaultTitle}
        description={SEO_CONFIG.defaultDescription}
        keywords={SEO_CONFIG.defaultKeywords}
        ogImage={`${SEO_CONFIG.siteUrl}${SEO_CONFIG.defaultOgImage}`}
        canonical={SEO_CONFIG.siteUrl}
        noindex={false}
      />
      <Navigation
        isLoggedIn={isLoggedIn}
        user={user}
        onLogout={handleLogout}
        onLogin={handleLoginClick}
      />
      <Hero
        isLoggedIn={isLoggedIn}
        onLogin={handleLoginClick}
        user={user}
      />
      <TeamSection />
      <ServicesSection />
      <TestimonialsSection />
      <BlogSection />
      <Footer />
      <LoginModal isOpen={isLoginModalOpen} onClose={() => setIsLoginModalOpen(false)} />
    </div>
  );
}

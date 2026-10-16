import React from 'react';
import { CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from './ui/button';
import { UserAvatar } from './UserAvatar';

interface HeroProps {
  isLoggedIn: boolean;
  onLogin: () => void;
  user?: { name: string; avatar: string } | null;
}

// Use a relative path by default so the same build works in dev and behind the gateway.
const CHAT_URL = import.meta.env.VITE_CHAT_URL || '/chat';

function navigateToChat() {
  window.location.href = CHAT_URL;
}

export function Hero({ isLoggedIn, onLogin, user }: HeroProps) {
  return (
    <section className="relative overflow-hidden bg-white py-20 md:py-32">
      <div className="max-w-[980px] mx-auto px-6 relative z-10">
        <div className="text-center max-w-4xl mx-auto animate-fade-in">
          <h1 className="text-5xl md:text-7xl font-semibold mb-3 tracking-tight leading-tight">
            Get Jobs Done.
          </h1>
          <h2 className="text-5xl md:text-7xl font-semibold mb-6 tracking-tight leading-tight text-black/40">
            All of Them.
          </h2>
          <p className="text-[19px] text-black/60 mb-10 max-w-2xl mx-auto leading-relaxed font-normal">
            Meet your dedicated, incredible world-class staff. Your Jobchat is an expert team, always on it for you 24/7.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            {isLoggedIn ? (
              <>
                <button
                  className="inline-flex items-center gap-4 px-6 py-3 text-black rounded-full font-medium text-[17px] transition-all duration-200"
                >
                  <UserAvatar src={user?.avatar} name={user?.name} size="sm" />
                  <span>Hey, {user?.name?.split(' ')[0]}</span>
                </button>
                <button
                  onClick={navigateToChat}
                  className="inline-flex items-center gap-2 px-7 py-3 bg-black text-white rounded-full font-medium text-[17px] hover:bg-black/90 transition-all duration-200"
                >
                  Get Jobs DONE!
                  <ArrowRight className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                onClick={onLogin}
                className="inline-flex items-center gap-2 px-7 py-3 bg-black text-white rounded-full font-medium text-[17px] hover:bg-black/90 transition-all duration-200"
              >
                Get Started
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="mt-20 grid md:grid-cols-2 gap-5 max-w-5xl mx-auto">
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-black/5 hover:shadow-lg transition-all duration-300">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-black/5 rounded-2xl flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-6 h-6 text-black" />
              </div>
              <div>
                <h3 className="font-semibold text-[21px] mb-2 tracking-tight">Task Management</h3>
                <p className="text-[15px] text-black/60 leading-relaxed">
                  Unlimited task requests completed one at a time. Average 24-48 hour delivery per task.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-8 shadow-sm border border-black/5 hover:shadow-lg transition-all duration-300">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-black/5 rounded-2xl flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-6 h-6 text-black" />
              </div>
              <div>
                <h3 className="font-semibold text-[21px] mb-2 tracking-tight">Expert Support</h3>
                <p className="text-[15px] text-black/60 leading-relaxed">
                  Professional team ready to handle all your needs with expertise and dedication.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

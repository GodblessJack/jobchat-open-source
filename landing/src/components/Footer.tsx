import React from 'react';
import { Twitter, Linkedin, Facebook, Instagram, Mail } from 'lucide-react';
import logoImage from '../assets/logo.png';

export function Footer() {
  return (
    <footer className="bg-[#f5f5f7] text-black py-16 border-t border-black/5">
      <div className="max-w-[980px] mx-auto px-6">
        <div className="grid md:grid-cols-2 gap-10 mb-10">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <a href="/" className="flex items-center">
                <img src={logoImage} alt="JobChat" className="h-7" />
              </a>
            </div>
            <p className="text-[14px] text-black/60 leading-relaxed">
              Your dedicated world-class team, always ready to get jobs done.
            </p>
          </div>

          {/* Connect */}
          <div>
            <h4 className="font-semibold text-[14px] mb-3">Connect</h4>
            <div className="flex gap-2.5 mb-4">
              <a href="#" className="w-9 h-9 bg-black/5 rounded-full flex items-center justify-center hover:bg-black/10 transition-all duration-200">
                <Twitter className="w-4 h-4" />
              </a>
              <a href="#" className="w-9 h-9 bg-black/5 rounded-full flex items-center justify-center hover:bg-black/10 transition-all duration-200">
                <Linkedin className="w-4 h-4" />
              </a>
              <a href="#" className="w-9 h-9 bg-black/5 rounded-full flex items-center justify-center hover:bg-black/10 transition-all duration-200">
                <Facebook className="w-4 h-4" />
              </a>
              <a href="#" className="w-9 h-9 bg-black/5 rounded-full flex items-center justify-center hover:bg-black/10 transition-all duration-200">
                <Instagram className="w-4 h-4" />
              </a>
            </div>
            <div>
              <a href="mailto:done@jobchat.io" className="flex items-center gap-2 text-[14px] text-black/60 hover:text-black transition-colors duration-200">
                <Mail className="w-4 h-4" />
                done@jobchat.io
              </a>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-6 border-t border-black/5 flex flex-col md:flex-row justify-between items-center gap-3 text-[12px] text-black/50">
          <p>Copyright © 2026 Jobchat Inc. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-black transition-colors duration-200">Privacy Policy</a>
            <a href="#" className="hover:text-black transition-colors duration-200">Terms of Use</a>
            <a href="#" className="hover:text-black transition-colors duration-200">Legal</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
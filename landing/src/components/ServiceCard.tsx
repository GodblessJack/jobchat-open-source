import React from 'react';
import { LucideIcon, CheckCircle } from 'lucide-react';

interface ServiceCardProps {
  title: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  items: string[];
  delay?: number;
}

export function ServiceCard({ title, subtitle, description, icon: Icon, items, delay = 0 }: ServiceCardProps) {
  return (
    <div
      className="bg-white rounded-3xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 border border-black/5 animate-slide-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Header */}
      <div className="bg-black/5 p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center">
            <Icon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-[19px] tracking-tight">{title}</h3>
            <p className="text-black/50 text-[14px] mt-0.5">{subtitle}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 bg-white">
        <p className="text-[15px] text-black/60 mb-5 leading-relaxed">
          {description}
        </p>

        <div className="space-y-2.5">
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-3">
              <CheckCircle className="w-[18px] h-[18px] text-black flex-shrink-0" />
              <span className="text-[15px] text-black/80">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

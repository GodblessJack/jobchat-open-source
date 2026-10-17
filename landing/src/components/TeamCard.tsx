import React from 'react';
import { LucideIcon } from 'lucide-react';

interface TeamCardProps {
  name: string;
  role: string;
  avatar: string;
  description: string;
  tags: string[];
  icon: LucideIcon;
  delay?: number;
}

export function TeamCard({ name, role, avatar, description, tags, icon: Icon, delay = 0 }: TeamCardProps) {
  return (
    <div
      className="bg-white rounded-3xl overflow-visible shadow-sm hover:shadow-lg transition-all duration-300 border border-black/5 animate-slide-in relative"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Header */}
      <div className="h-28 relative overflow-hidden rounded-t-3xl">
        <div
          className="absolute inset-0 bg-cover bg-center scale-110 blur-2xl"
          style={{ backgroundImage: `url(${avatar})` }}
        />
        <div className="absolute inset-0 bg-black/20" />
      </div>

      {/* Avatar positioned relative to card */}
      <div className="absolute top-16 left-1/2 transform -translate-x-1/2 z-10">
        <div className="relative">
          <img
            src={avatar}
            alt={`${name}, ${role} at JobChat`}
            className="w-24 h-24 rounded-full border-[3px] border-white object-cover shadow-md bg-white"
          />
          <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-black rounded-full flex items-center justify-center border-2 border-white shadow-sm">
            <Icon className="w-4 h-4 text-white" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="pt-16 px-5 pb-6">
        <div className="text-center mb-4">
          <h3 className="font-semibold text-[19px] tracking-tight">{name}</h3>
          <p className="text-[15px] text-black/50 mt-0.5">{role}</p>
        </div>

        <p className="text-[15px] text-black/60 mb-5 text-center leading-relaxed">
          {description}
        </p>

        {/* Tags */}
        <div className="flex flex-wrap gap-2 justify-center">
          {tags.map((tag, index) => (
            <span
              key={index}
              className="px-3 py-1.5 bg-black/5 text-black/70 text-[13px] rounded-full font-medium hover:bg-black/10 transition-colors duration-200"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import { Star, Quote } from 'lucide-react';

interface TestimonialCardProps {
  name: string;
  role: string;
  avatar: string;
  content: string;
  rating: number;
  company: string;
  delay?: number;
}

export function TestimonialCard({ name, role, avatar, content, rating, company, delay = 0 }: TestimonialCardProps) {
  return (
    <div
      className="bg-white rounded-3xl p-7 shadow-sm hover:shadow-lg transition-all duration-300 border border-black/5 animate-slide-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Quote Icon */}
      <div className="w-11 h-11 bg-black rounded-2xl flex items-center justify-center mb-5">
        <Quote className="w-5 h-5 text-white" />
      </div>

      {/* Content */}
      <p className="text-[15px] text-black/70 mb-5 leading-relaxed">
        "{content}"
      </p>

      {/* Rating */}
      <div className="flex gap-1 mb-5">
        {[...Array(rating)].map((_, i) => (
          <Star key={i} className="w-[18px] h-[18px] fill-black text-black" />
        ))}
      </div>

      {/* Author Info */}
      <div className="flex items-center gap-3 pt-5 border-t border-black/5">
        <img
          src={avatar}
          alt={`${name}, ${role} at ${company}`}
          className="w-12 h-12 rounded-full object-cover"
        />
        <div>
          <h4 className="font-semibold text-[15px]">{name}</h4>
          <p className="text-[13px] text-black/50">{role}</p>
          <p className="text-[13px] text-black/40">{company}</p>
        </div>
      </div>
    </div>
  );
}

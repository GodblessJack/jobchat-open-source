import React from 'react';
import { Calendar, Clock, ArrowRight } from 'lucide-react';

interface BlogCardProps {
  title: string;
  excerpt: string;
  date: string;
  readTime: string;
  image: string;
  category: string;
  delay?: number;
}

export function BlogCard({ title, excerpt, date, readTime, image, category, delay = 0 }: BlogCardProps) {
  return (
    <div
      className="bg-white rounded-3xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 border border-black/5 animate-slide-in group"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Image */}
      <div className="relative h-52 overflow-hidden">
        <img
          src={image}
          alt={`${title} - ${category} article`}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute top-4 left-4">
          <span className="px-3 py-1.5 bg-black/90 backdrop-blur-sm text-white text-[13px] font-medium rounded-full">
            {category}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        <h3 className="font-semibold text-[19px] mb-2 line-clamp-2 tracking-tight leading-snug group-hover:text-black/70 transition-colors duration-300">
          {title}
        </h3>

        <p className="text-[15px] text-black/60 mb-4 line-clamp-2 leading-relaxed">
          {excerpt}
        </p>

        <div className="flex items-center gap-4 text-[13px] text-black/50 mb-5">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            <span>{date}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <span>{readTime}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-black/5">
          <button className="flex items-center gap-2 text-[15px] font-medium text-[#06c] group-hover:underline transition-all duration-200">
            Read More
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

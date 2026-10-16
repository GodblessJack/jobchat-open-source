import React from 'react';
import { BlogCard } from './BlogCard';
import { ArrowRight } from 'lucide-react';

const blogPosts = [
  {
    title: 'How to go open-o your own amazing business',
    excerpt: 'Learn the essential steps and strategies to launch your dream business successfully.',
    date: 'Jan 15, 2026',
    readTime: '5 min read',
    image: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800',
    category: 'Business'
  },
  {
    title: 'Stop doing busy work. Delegate to your Jobchat.',
    excerpt: 'Discover how delegating routine tasks can transform your productivity and business growth.',
    date: 'Jan 18, 2026',
    readTime: '4 min read',
    image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800',
    category: 'Productivity'
  },
  {
    title: 'The potential of "Jobchat Work" signals massive paradigm shift',
    excerpt: 'Explore how the Jobchat work model is revolutionizing the future of remote collaboration.',
    date: 'Jan 20, 2026',
    readTime: '6 min read',
    image: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800',
    category: 'Trends'
  }
];

export function BlogSection() {
  return (
    <section id="blog" className="py-20 md:py-28 bg-white">
      <div className="max-w-[980px] mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-semibold mb-4 tracking-tight">
            Latest from the Jobchat World
          </h2>
          <p className="text-[19px] text-black/60 leading-relaxed">
            Insights, tips, and stories from the future of work.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5 mb-10">
          {blogPosts.map((post, index) => (
            <BlogCard key={index} {...post} delay={index * 100} />
          ))}
        </div>

        <div className="text-center">
          <button className="inline-flex items-center gap-2 px-7 py-3 bg-black text-white rounded-full font-medium text-[17px] hover:bg-black/90 transition-all duration-200">
            View All Articles
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
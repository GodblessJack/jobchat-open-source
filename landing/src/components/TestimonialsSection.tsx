import React from 'react';
import { TestimonialCard } from './TestimonialCard';
import { Star } from 'lucide-react';

const testimonials = [
  {
    name: 'Sarah M.',
    role: 'Startup Founder',
    avatar: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=400',
    content: 'Jobchat completely transformed how we operate. Having a dedicated team that understands our needs has been game-changing for our startup.',
    rating: 5,
    company: 'TechStart Inc.'
  },
  {
    name: 'Michael Chen',
    role: 'Product Manager',
    avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400',
    content: 'The quality of work and speed of delivery exceeded all expectations. Our team can now focus on what truly matters while Jobchat handles the rest.',
    rating: 5,
    company: 'Innovation Labs'
  },
  {
    name: 'Emily Rodriguez',
    role: 'Marketing Director',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400',
    content: "I was skeptical at first, but Jobchat's team proved to be true professionals. They've become an integral part of our marketing strategy.",
    rating: 5,
    company: 'Growth Co.'
  }
];

export function TestimonialsSection() {
  return (
    <section id="testimonials" className="py-20 md:py-28 bg-[#fbfbfd]">
      <div className="max-w-[980px] mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-semibold mb-4 tracking-tight">
            Voices from the Beta Program
          </h2>
          <p className="text-[19px] text-black/60 max-w-2xl mx-auto leading-relaxed">
            See what our early adopters have to say about their experience with Jobchat.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {testimonials.map((testimonial, index) => (
            <TestimonialCard key={index} {...testimonial} delay={index * 100} />
          ))}
        </div>
      </div>
    </section>
  );
}
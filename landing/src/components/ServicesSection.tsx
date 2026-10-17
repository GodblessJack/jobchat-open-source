import React from 'react';
import { ServiceCard } from './ServiceCard';
import { Code, PenTool, TrendingUp, FileText, Mail, Globe } from 'lucide-react';

const services = {
  leftColumn: [
    {
      title: 'Leave Your Broken Job',
      subtitle: 'Development & Tech',
      description: 'From web apps to mobile solutions, we build technology that scales with your business.',
      icon: Code,
      items: ['Web Development', 'Mobile Apps', 'API Integration', 'Tech Support']
    },
    {
      title: 'Design Excellence',
      subtitle: 'Creative Solutions',
      description: 'Beautiful, user-centered designs that make your brand stand out.',
      icon: PenTool,
      items: ['UI/UX Design', 'Brand Identity', 'Graphic Design', 'Prototyping']
    },
    {
      title: 'Market Research',
      subtitle: 'Data-Driven Insights',
      description: 'Understand your market and make informed decisions with comprehensive research.',
      icon: TrendingUp,
      items: ['Market Analysis', 'Competitor Research', 'User Surveys', 'Trend Reports']
    }
  ],
  rightColumn: [
    {
      title: 'Supercharge Productivity',
      subtitle: 'Efficient Workflows',
      description: 'Streamline your operations and boost team productivity with optimized processes.',
      icon: TrendingUp,
      items: ['Task Automation', 'Process Optimization', 'Team Collaboration', 'Performance Tracking']
    },
    {
      title: 'Email Marketing',
      subtitle: 'Engage Your Audience',
      description: 'Create compelling email campaigns that convert and build lasting relationships.',
      icon: Mail,
      items: ['Campaign Strategy', 'Email Design', 'A/B Testing', 'Analytics']
    },
    {
      title: 'Web Presence',
      subtitle: 'Digital Excellence',
      description: 'Build and maintain a powerful online presence that drives results.',
      icon: Globe,
      items: ['Website Management', 'SEO Optimization', 'Content Updates', 'Analytics']
    }
  ]
};

export function ServicesSection() {
  return (
    <section id="services" className="py-20 md:py-28 bg-white">
      <div className="max-w-[980px] mx-auto px-6">
        <div className="grid md:grid-cols-2 gap-5">
          {/* Left Column */}
          <div className="space-y-5">
            {services.leftColumn.map((service, index) => (
              <ServiceCard key={index} {...service} delay={index * 100} />
            ))}
          </div>

          {/* Right Column */}
          <div className="space-y-5">
            {services.rightColumn.map((service, index) => (
              <ServiceCard key={index} {...service} delay={(index + 3) * 100} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
import React from 'react';
import { TeamCard } from './TeamCard';
import { Briefcase, Code, Palette, TrendingUp, FileText, Users, Target, Megaphone } from 'lucide-react';

const teamMembers = [
  {
    name: 'Leah',
    role: 'Operations',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400',
    description: 'From managing stakeholders to optimizing processes, Leah is your operational backbone.',
    tags: ['Project Management', 'Process Optimization', 'Team Coordination'],
    icon: Briefcase
  },
  {
    name: 'Micah',
    role: 'Design',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400',
    description: 'Micah transforms ideas into stunning visual experiences with creative excellence.',
    tags: ['UI/UX Design', 'Branding', 'Visual Design'],
    icon: Palette
  },
  {
    name: 'Selina',
    role: 'Engineering',
    avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400',
    description: 'From frontend to backend, Selina builds robust solutions that scale.',
    tags: ['Full-Stack Dev', 'API Integration', 'Database Design'],
    icon: Code
  },
  {
    name: 'Alex',
    role: 'Marketing',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400',
    description: 'Alex drives growth through data-driven marketing strategies and campaigns.',
    tags: ['Growth Marketing', 'SEO', 'Content Strategy'],
    icon: TrendingUp
  },
  {
    name: 'Nina',
    role: 'Content',
    avatar: 'https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?w=400',
    description: 'Nina crafts compelling narratives that engage and convert your audience.',
    tags: ['Copywriting', 'Content Strategy', 'Brand Voice'],
    icon: FileText
  },
  {
    name: 'Ethan',
    role: 'Sales',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400',
    description: 'Ethan builds relationships and closes deals with strategic sales expertise.',
    tags: ['Business Development', 'Client Relations', 'Sales Strategy'],
    icon: Users
  },
  {
    name: 'Mia',
    role: 'Strategy',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400',
    description: 'Mia aligns business goals with actionable strategies for sustainable growth.',
    tags: ['Business Strategy', 'Market Analysis', 'Planning'],
    icon: Target
  },
  {
    name: 'Oliver',
    role: 'PR & Comms',
    avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400',
    description: 'Oliver manages your public image and communication with media expertise.',
    tags: ['Public Relations', 'Media Outreach', 'Crisis Management'],
    icon: Megaphone
  }
];

export function TeamSection() {
  return (
    <section id="team" className="py-20 md:py-28 bg-[#fbfbfd]">
      <div className="max-w-[980px] mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-semibold mb-4 tracking-tight">
            Meet Your Jobchat Team
          </h2>
          <p className="text-[19px] text-black/60 max-w-2xl mx-auto leading-relaxed">
            Your dedicated team of experts, ready to tackle any challenge with world-class expertise.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {teamMembers.map((member, index) => (
            <TeamCard key={index} {...member} delay={index * 100} />
          ))}
        </div>
      </div>
    </section>
  );
}
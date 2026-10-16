/**
 * SEO Configuration for JobChat Landing Page
 *
 * This file contains all SEO-related constants and configurations
 * to ensure consistent SEO across the application.
 */

export const SEO_CONFIG = {
    // Site Information
    siteName: 'JobChat',
    siteUrl: import.meta.env.VITE_SITE_URL || import.meta.env.VITE_CLIENT_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://jobchat.io'),

    // Default Meta Tags
    defaultTitle: 'JobChat - Get Jobs Done. All of Them. | Your AI Expert Team 24/7',
    defaultDescription: 'Meet your dedicated, incredible world-class AI staff. JobChat is an expert team covering operations, design, engineering, marketing, content, sales, strategy, and PR - always on it for you 24/7.',
    defaultKeywords: 'AI assistant, AI team, career development, job interview, AI chat, operations, design, engineering, marketing, sales, strategy, PR, LinkedIn integration',

    // Social Media
    twitterHandle: '@jobchat',

    // Images (relative to public folder)
    defaultOgImage: '/og-image.jpg',
    defaultTwitterImage: '/twitter-image.jpg',
    logo: '/logo.png',

    // Structured Data
    organization: {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'JobChat',
        description: 'Your dedicated AI expert team available 24/7 for operations, design, engineering, marketing, content, sales, strategy, and PR.',
        url: import.meta.env.VITE_SITE_URL || import.meta.env.VITE_CLIENT_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://jobchat.io'),
        logo: `${import.meta.env.VITE_SITE_URL || import.meta.env.VITE_CLIENT_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://jobchat.io')}/logo.png`,
        sameAs: [
            'https://www.linkedin.com/company/jobchat',
            // Add more social media links as needed
        ],
        contactPoint: {
            '@type': 'ContactPoint',
            contactType: 'Customer Service',
            availableLanguage: ['English'],
        },
    },

    webApplication: {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'JobChat',
        applicationCategory: 'BusinessApplication',
        offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
        },
        operatingSystem: 'Web Browser',
        description: 'AI-powered career development and interview platform with expert team assistance',
    },

    // Team Members for Structured Data
    teamMembers: [
        {
            '@type': 'Person',
            name: 'Leah',
            jobTitle: 'Operations Expert',
            description: 'Stakeholder management, process optimization, team collaboration',
        },
        {
            '@type': 'Person',
            name: 'Micah',
            jobTitle: 'Design Expert',
            description: 'UI/UX design, brand identity, visual aesthetics',
        },
        {
            '@type': 'Person',
            name: 'Selina',
            jobTitle: 'Engineering Expert',
            description: 'Full-stack development, API integration, database architecture',
        },
        {
            '@type': 'Person',
            name: 'Alex',
            jobTitle: 'Marketing Expert',
            description: 'Growth marketing, SEO optimization, content strategy',
        },
        {
            '@type': 'Person',
            name: 'Nina',
            jobTitle: 'Content Expert',
            description: 'Copywriting, brand voice, storytelling',
        },
        {
            '@type': 'Person',
            name: 'Ethan',
            jobTitle: 'Sales Expert',
            description: 'Business development, customer relationship management, sales strategy',
        },
        {
            '@type': 'Person',
            name: 'Mia',
            jobTitle: 'Strategy Expert',
            description: 'Business strategy analysis, market trend research',
        },
        {
            '@type': 'Person',
            name: 'Oliver',
            jobTitle: 'PR & Communications Expert',
            description: 'Public relations, crisis management, brand communication',
        },
    ],
} as const;

/**
 * Generate full URL from path
 */
export function getFullUrl(path: string = ''): string {
    return `${SEO_CONFIG.siteUrl}${path}`;
}

/**
 * Generate page title with site name
 */
export function generateTitle(pageTitle?: string): string {
    if (!pageTitle) return SEO_CONFIG.defaultTitle;
    return pageTitle.includes(SEO_CONFIG.siteName)
        ? pageTitle
        : `${pageTitle} | ${SEO_CONFIG.siteName}`;
}

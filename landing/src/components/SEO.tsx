import { useEffect } from 'react';

interface SEOProps {
    title?: string;
    description?: string;
    keywords?: string;
    ogImage?: string;
    canonical?: string;
    noindex?: boolean;
}

/**
 * SEO Component - Dynamically manages page meta tags
 *
 * @param title - Page title (will be appended with " | JobChat")
 * @param description - Meta description for the page
 * @param keywords - Comma-separated keywords
 * @param ogImage - Open Graph image URL
 * @param canonical - Canonical URL for the page
 * @param noindex - If true, prevents search engines from indexing this page
 */
export function SEO({
    title = 'Get Jobs Done. All of Them. | Your AI Expert Team 24/7',
    description = 'Meet your dedicated, incredible world-class AI staff. JobChat is an expert team covering operations, design, engineering, marketing, content, sales, strategy, and PR - always on it for you 24/7.',
    keywords = 'AI assistant, AI team, career development, job interview, AI chat, operations, design, engineering, marketing, sales, strategy, PR, LinkedIn integration',
    ogImage = 'https://jobchat.io/og-image.jpg',
    canonical = 'https://jobchat.io/',
    noindex = false,
}: SEOProps) {
    useEffect(() => {
        // Update document title
        document.title = title.includes('JobChat') ? title : `${title} | JobChat`;

        // Update or create meta tags
        const updateMetaTag = (name: string, content: string, isProperty = false) => {
            const attribute = isProperty ? 'property' : 'name';
            let element = document.querySelector(`meta[${attribute}="${name}"]`);

            if (!element) {
                element = document.createElement('meta');
                element.setAttribute(attribute, name);
                document.head.appendChild(element);
            }

            element.setAttribute('content', content);
        };

        // Primary meta tags
        updateMetaTag('title', title);
        updateMetaTag('description', description);
        updateMetaTag('keywords', keywords);
        updateMetaTag('robots', noindex ? 'noindex, nofollow' : 'index, follow');

        // Open Graph tags
        updateMetaTag('og:type', 'website', true);
        updateMetaTag('og:title', title, true);
        updateMetaTag('og:description', description, true);
        updateMetaTag('og:image', ogImage, true);
        updateMetaTag('og:url', canonical, true);
        updateMetaTag('og:site_name', 'JobChat', true);
        updateMetaTag('og:locale', 'en_US', true);

        // Twitter tags
        updateMetaTag('twitter:card', 'summary_large_image');
        updateMetaTag('twitter:title', title);
        updateMetaTag('twitter:description', description);
        updateMetaTag('twitter:image', ogImage);
        updateMetaTag('twitter:url', canonical);
        updateMetaTag('twitter:creator', '@jobchat');

        // Update canonical link
        let canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
        if (!canonicalLink) {
            canonicalLink = document.createElement('link');
            canonicalLink.setAttribute('rel', 'canonical');
            document.head.appendChild(canonicalLink);
        }
        canonicalLink.setAttribute('href', canonical);
    }, [title, description, keywords, ogImage, canonical, noindex]);

    return null;
}

/**
 * Hook to update page SEO dynamically
 */
export function useSEO(props: SEOProps) {
    useEffect(() => {
        const {
            title = 'Get Jobs Done. All of Them. | Your AI Expert Team 24/7',
            description = 'Meet your dedicated, incredible world-class AI staff. JobChat is an expert team covering operations, design, engineering, marketing, content, sales, strategy, and PR - always on it for you 24/7.',
            keywords = 'AI assistant, AI team, career development, job interview, AI chat, operations, design, engineering, marketing, sales, strategy, PR, LinkedIn integration',
            ogImage = 'https://jobchat.io/og-image.jpg',
            canonical = 'https://jobchat.io/',
            noindex = false,
        } = props;

        // Update document title
        document.title = title.includes('JobChat') ? title : `${title} | JobChat`;

        // Update meta tags
        const updateMetaTag = (name: string, content: string, isProperty = false) => {
            const attribute = isProperty ? 'property' : 'name';
            let element = document.querySelector(`meta[${attribute}="${name}"]`);

            if (!element) {
                element = document.createElement('meta');
                element.setAttribute(attribute, name);
                document.head.appendChild(element);
            }

            element.setAttribute('content', content);
        };

        updateMetaTag('title', title);
        updateMetaTag('description', description);
        updateMetaTag('keywords', keywords);
        updateMetaTag('robots', noindex ? 'noindex, nofollow' : 'index, follow');
        updateMetaTag('og:type', 'website', true);
        updateMetaTag('og:title', title, true);
        updateMetaTag('og:description', description, true);
        updateMetaTag('og:image', ogImage, true);
        updateMetaTag('og:url', canonical, true);
        updateMetaTag('og:site_name', 'JobChat', true);
        updateMetaTag('og:locale', 'en_US', true);
        updateMetaTag('twitter:card', 'summary_large_image');
        updateMetaTag('twitter:title', title);
        updateMetaTag('twitter:description', description);
        updateMetaTag('twitter:image', ogImage);
        updateMetaTag('twitter:url', canonical);
        updateMetaTag('twitter:creator', '@jobchat');

        // Update canonical link
        let canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
        if (!canonicalLink) {
            canonicalLink = document.createElement('link');
            canonicalLink.setAttribute('rel', 'canonical');
            document.head.appendChild(canonicalLink);
        }
        canonicalLink.setAttribute('href', canonical);
    }, [props]);
}

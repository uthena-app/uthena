// Home copy — the static (non-data) sections of the homepage live here.
// Sections backed by real data (featured grid → getFeaturedProducts,
// categories → getActiveCategories, stats → getPublicProductStats)
// compose their own copy from the data shape. This file is for the
// editorial sections (trust strip, testimonials, FAQ) where Phase 17 /
// future phases will swap hard-coded strings for admin-editable content.

// Trust strip — three numbered cells explaining how the marketplace
// works. Mockup-faithful to `mockups/home.html` lines 85–89.
export type TrustStep = {
  num: string
  title: string
  body: string
}

export const TRUST_STRIP: TrustStep[] = [
  {
    num: '01',
    title: 'Find relevant courses',
    body: 'Browse the catalog across 19 categories — from AI to mental health.',
  },
  {
    num: '02',
    title: 'Purchase the PLR license',
    body: 'Pay once. Get full source files, video, decks, and editable project files.',
  },
  {
    num: '03',
    title: 'Get 100% of the income',
    body: 'Resell under your own brand on your own site. We don\u2019t take a cut.',
  },
]

// Testimonials — single hard-coded quote for the home reviews block.
// Phase 9 (P9.14) wires real reviews from the reviews table; for v1 the
// homepage shows one anchored quote that matches the mockup.
export const FEATURED_TESTIMONIAL = {
  body: '\u201CSold three bundles in the first week. The PLR pack was cleaner than anything else I\u2019ve licensed \u2014 actually usable as-is.\u201D',
  cite: '\u2014 D. Patel, Indie hacker \u00b7 verified buyer \u00b7 2 days ago',
}

// FAQ teaser — six high-intent questions on the home page. The
// authoritative FAQ list lives in 02-features/legal (driven by
// `faqs` markdown + `listFaqs` query). The home FAQ is a hand-picked
// subset that matches the mockup exactly; replacing it with a
// live query is a P10.8 follow-up.
export type FaqItem = {
  q: string
  a: string
}

export const HOME_FAQ: FaqItem[] = [
  {
    q: 'What is PLR and can I really keep 100% of the revenue?',
    a: 'Private Label Rights means you can rebrand, edit, and resell the course under your own name. You pay once, sell as many times as you like, and keep every dollar.',
  },
  {
    q: 'How is MRR different from PLR?',
    a: 'Master Resell Rights lets your buyers also resell the course. PLR is for you to sell; MRR is for you to build a reseller chain on top.',
  },
  {
    q: 'Can I edit the videos and course materials?',
    a: 'Yes. Source files, scripts, slide decks and videos are all included and editable in standard tools.',
  },
  {
    q: 'Do you offer refunds?',
    a: '14-day return rights, no questions asked. Single courses are refundable if the course has not been downloaded.',
  },
  {
    q: 'What format are the courses delivered in?',
    a: 'MP4 video, PDF workbooks, slide decks, and editable project files where applicable.',
  },
  {
    q: 'Can I become an instructor?',
    a: 'Apply through the Earn with Uthena page. We license original work from independent creators and split revenue 70/30 in your favor.',
  },
]

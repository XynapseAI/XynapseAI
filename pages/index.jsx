'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Link from 'next/link';
import Head from 'next/head';
import { useRouter } from 'next/router';
import MatrixHoverEffect from '../components/MatrixHoverEffect';
import { TermsOfServiceContent } from '../components/TermsOfService';
import { PrivacyPolicyContent } from '../components/PrivacyPolicy';
import TypingEffect from '../components/TypingEffect';

gsap.registerPlugin(ScrollTrigger);

export default function Home() {
  const router = useRouter();
  const card1Ref = useRef(null);
  const card2Ref = useRef(null);
  const card3Ref = useRef(null);
  const sectionRef = useRef(null);
  const cardsContainerRef = useRef(null);
  const newSectionRef = useRef(null);
  const text1Ref = useRef(null);
  const text2Ref = useRef(null);
  const text3Ref = useRef(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);

  useEffect(() => {
    const path = router.asPath;
    if (path === '/privacy-policy') {
      setModalContent('privacy');
      setIsModalOpen(true);
      document.body.style.overflow = 'hidden';
    } else if (path === '/terms-of-service') {
      setModalContent('terms');
      setIsModalOpen(true);
      document.body.style.overflow = 'hidden';
    }
  }, [router.asPath]);

  const openModal = (content) => {
    setModalContent(content);
    setIsModalOpen(true);
    document.body.style.overflow = 'hidden';
    router.push(content === 'privacy' ? '/privacy-policy' : '/terms-of-service', undefined, {
      shallow: true,
    });
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalContent(null);
    document.body.style.overflow = 'auto';
    router.push('/', undefined, { shallow: true });
  };

  useEffect(() => {
    const checkRefs = () => {
      if (
        !sectionRef.current ||
        !card1Ref.current ||
        !card2Ref.current ||
        !card3Ref.current ||
        !cardsContainerRef.current ||
        !newSectionRef.current ||
        !text1Ref.current ||
        !text2Ref.current ||
        !text3Ref.current
      ) {
        console.log('Refs not ready yet. Retrying...');
        return false;
      }
      return true;
    };

    const initAnimation = () => {
      if (!checkRefs()) {
        setTimeout(initAnimation, 100);
        return;
      }

      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const isMobile = viewportWidth < 640;
      const cardWidth = isMobile ? viewportWidth * 0.9 : viewportWidth * 0.8;
      const cardHeight = isMobile ? viewportHeight * 0.7 : viewportHeight * 0.5;

      cardsContainerRef.current.style.minHeight = `${cardHeight * 3}px`;
      sectionRef.current.style.minHeight = `${viewportHeight * 1}px`;

      gsap.set([card1Ref.current, card2Ref.current, card3Ref.current], {
        width: cardWidth,
        height: cardHeight,
        y: cardHeight * 2,
        opacity: 0,
        overwrite: 'auto',
        zIndex: (i) => 100 + i,
      });

      const cardTl = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 5%',
          end: `+=${cardHeight * 5}`,
          pin: true,
          pinSpacing: true,
          scrub: 6,
          markers: false,
          onLeave: () => {
            gsap.set([card1Ref.current, card2Ref.current, card3Ref.current], {
              y: [0, cardHeight * 0.2, cardHeight * 0.4],
              opacity: 1,
            });
          },
        },
      });

      cardTl
        .to(card1Ref.current, {
          y: 0,
          opacity: 1,
          duration: 1.5,
          ease: 'power3.out',
        }, 0)
        .to(card2Ref.current, {
          y: cardHeight * 0.1,
          opacity: 1,
          duration: 1.5,
          ease: 'power3.out',
        }, 1)
        .to(card3Ref.current, {
          y: cardHeight * 0.3,
          opacity: 1,
          duration: 1.5,
          ease: 'power3.out',
        }, 2);

      gsap.set([text1Ref.current, text2Ref.current, text3Ref.current], {
        opacity: 0,
        y: 50,
      });

      const textTl = gsap.timeline({
        scrollTrigger: {
          trigger: newSectionRef.current,
          start: 'top top',
          end: '+=1000',
          pin: true,
          pinSpacing: true,
          scrub: 1,
          markers: false,
        },
      });

      textTl
        .to(text1Ref.current, {
          opacity: 1,
          y: 0,
          duration: 1,
          ease: 'power3.out',
        }, 0)
        .to(text2Ref.current, {
          opacity: 1,
          y: 0,
          duration: 1,
          ease: 'power3.out',
        }, 0.5)
        .to(text3Ref.current, {
          opacity: 1,
          y: 0,
          duration: 1,
          ease: 'power3.out',
        }, 1);

      ScrollTrigger.refresh();
    };

    initAnimation();

    return () => {
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      document.body.style.overflow = 'auto';
    };
  }, []);

  const partnerLogos = [
    '/icons/logo1.png',
    '/icons/logo2.png',
    '/icons/logo3.png',
    '/icons/logo4.png',
    '/icons/logo5.png',
    '/icons/logo6.png',
    '/icons/logo7.png',
    '/icons/logo8.png',
    '/icons/logo9.png',
    '/icons/logo10.png',
    '/icons/logo11.png',
    '/icons/logo12.png',
    '/icons/logo13.png',
    '/icons/logo14.png',
    '/icons/logo15.png',
    '/icons/logo16.png',
    '/icons/logo17.png',
    '/icons/logo18.png',
    '/icons/logo19.png',
    '/icons/logo20.png',
    '/icons/logo21.png',
    '/icons/logo22.png',
    '/icons/logo23.png',
    '/icons/logo24.png',
    '/icons/logo25.png',
    '/icons/logo26.png',
    '/icons/logo27.png',
    '/icons/logo28.png',
    '/icons/logo29.png',
    '/icons/logo30.png',
    '/icons/logo31.png',
    '/icons/logo32.png',
    '/icons/logo33.png',
    '/icons/logo34.png',
    '/icons/logo35.png',
    '/icons/logo36.png',
    '/icons/logo37.png',
    '/icons/logo38.png',
    '/icons/logo39.png',
    '/icons/logo40.png',
    '/icons/logo41.png',
  ];

  const row1Logos = partnerLogos.slice(0, 14); // Logos 1-14
  const row2Logos = partnerLogos.slice(14, 28); // Logos 15-28
  const row3Logos = partnerLogos.slice(28, 41);

  const trustedByLogos = [
    // Add your new logos here when available, e.g.:
    // '/trusted/logo1.png',
    // '/trusted/logo2.png',
    // ... etc.
    // For now, using a subset of partnerLogos as placeholders
    '/icons/logo1.png',
    '/icons/logo2.png',
    '/icons/logo3.png',
    '/icons/logo4.png',
    '/icons/logo5.png',
  ];

  const cardData = [
    {
      title: 'Grok AI',
      description:
        'Harness the power of Grok, created by xAI, to deliver unparalleled market predictions and deep crypto analytics with real-time precision.',
      image: '/icons/grok.png',
    },
    {
      title: 'Gemini AI',
      description:
        'Leverage Gemini’s advanced reasoning capabilities to uncover hidden market trends and optimize your crypto investment strategies.',
      image: '/icons/gemini.png',
    },
    {
      title: 'ChatGPT AI',
      description:
        'Utilize ChatGPT’s natural language processing to analyze social sentiment on X and generate actionable insights for market movements.',
      image: '/icons/gpt.png',
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-black text-white overflow-x-hidden font-courier">
      <Head>
        <title>
          {modalContent === 'privacy'
            ? 'Xynapse Privacy Policy'
            : modalContent === 'terms'
              ? 'Xynapse Terms of Service'
              : 'Xynapse Analytics - Home'}
        </title>
        <meta
          name="description"
          content={
            modalContent === 'privacy'
              ? 'Read Xynapse\'s Privacy Policy to understand how we protect your personal data.'
              : modalContent === 'terms'
                ? 'Review Xynapse\'s Terms of Service for our AI-powered crypto analytics platform.'
                : 'Explore the ultimate AI-powered crypto market analytics platform.'
          }
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </Head>

      {/* Header */}
      <header className="w-full py-1 px-6 flex justify-between items-center bg-tech backdrop-blur-md border-b border-white/10 z-50 sticky top-0">
        <img src="/icons/logo-landscape.png" alt="Xynapse Logo" className="h-16" />
        {/* <div className="flex items-center gap-6">
          <nav className="flex gap-4">
            {['Home', 'Features', 'Blog'].map((item) => (
              <Link
                key={item}
                href={`#${item.toLowerCase()}`}
                className="text-xs text-white transition-all duration-300 uppercase"
              >
                <MatrixHoverEffect text={item} hoverColor="#00BFFF" />
              </Link>
            ))}
          </nav>
        </div> */}
        <div className="flex items-center gap-4">
          <Link href="https://x.com" className="transition-all duration-300 mr-4">
            <img
              src="/icons/x.png" // Placeholder for Twitter logo
              alt="Twitter Logo"
              className="h-6"
            />
          </Link>
          <span>
            <img src="/icons/discord.png" alt="Discord Logo" className="h-6 opacity-50 mr-4" />
          </span>
          {/* <Link href="https://discord.com" className="transition-all duration-300 mr-4">
            <img
              src="/icons/discord.png" // Placeholder for Twitter logo
              alt="Twitter Logo"
              className="h-6"
            />
          </Link> */}
          <Link
            href="/dashboard"
            className="px-4 py-2 text-white border border-2 rounded-xl font-medium transition-all duration-300"
          >
            <MatrixHoverEffect text="Launch App" hoverColor="#00BFFF" />
          </Link>
        </div>
      </header>

      {/* Banner */}
      <section className="h-screen flex flex-col items-center justify-center py-16 bg-gradient-to-b from-black to-gray-900">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-4xl sm:text-5xl md:text-6xl font-bold text-center text-white mb-6 uppercase"
        >
          Master the Market with AI
        </motion.h1>
        <p className="text-sm text-gray-400 mb-8 text-center max-w-2xl">
          Unlock real-time insights, predictive analytics, and social sentiment analysis powered by Grok, Gemini, and ChatGPT. Start trading smarter today.
        </p>
        <div className="flex gap-4">
          <Link
            href="#learn-more"
            className="px-6 py-3 text-white border border-2 border-white rounded-full text-sm font-medium transition-all duration-300 uppercase"
          >
            <MatrixHoverEffect text="Discover Now" hoverColor="#00BFFF" />
          </Link>
          <Link
            href="/dashboard"
            className="px-6 py-3 border border-2 border-white text-white rounded-full text-sm font-medium transition-all duration-300 uppercase"
          >
            <MatrixHoverEffect text="Launch App" hoverColor="#00BFFF" />
          </Link>
        </div>
      </section>

      {/* Trusted By */}
      <section className="py-2">
        <p className="text-center text-gray-500 text-xl font-bold mb-4 uppercase m-10">
          Trusted by Top Crypto Innovators
        </p>
        <div className="w-full overflow-hidden mt-10">
          <div className="flex animate-marquee">
            {[...trustedByLogos, ...trustedByLogos].map((logo, index) => (
              <img
                key={`trusted-${index}`}
                src={logo}
                alt="Trusted By Logo"
                className="h-16 mx-10"
              />
            ))}
          </div>
        </div>
      </section>

      {/* Cards with Scroll Animation */}
      <section
        ref={sectionRef}
        className="py-10 flex flex-col items-center relative z-50 mt-16"
      >
        <h2 className="text-3xl font-bold text-white mb-12 text-center uppercase">
          <TypingEffect text="Powered by Elite AI Models" speed={150} loop={false} cursorHeight="2rem" />
        </h2>
        <div
          ref={cardsContainerRef}
          className="relative flex items-start justify-center pt-8"
        >
          {[card1Ref, card2Ref, card3Ref].map((ref, index) => (
            <motion.div
              key={index}
              ref={ref}
              className="absolute bg-tech backdrop-blur-md border border-white/10 rounded-xl shadow-card flex flex-row items-center justify-between p-8 w-full max-w-4xl"
            >
              <div className="flex-1 p-6">
                <h3 className="text-2xl font-bold text-white mb-6">
                  {cardData[index].title}
                </h3>
                <p className="text-base text-gray-500">
                  {cardData[index].description}
                </p>
              </div>
              <div className="flex-1">
                <img
                  src={cardData[index].image}
                  alt={cardData[index].title}
                  className="w-4/5 h-4/5 object-cover rounded-lg ml-10"
                />
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Why Choose Us? */}
      <section className="py-2 flex flex-col items-center relative z-10">
        <h3 className="text-2xl font-bold text-white mb-2 text-center uppercase">
          Why Xynapse Analytics?
        </h3>
        <p className="text-sm text-gray-500 mb-8 text-center max-w-2xl">
          <TypingEffect text="Our platform delivers cutting-edge tools to navigate the volatile crypto market with confidence and precision." speed={50} loop={false} cursorHeight="1rem" />
        </p>
        <div className="w-[90%] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { img: '/icons/icon1.png', text: 'Real-Time Token Tracking' },
            { img: '/icons/icon2.png', text: 'AI-Powered Predictions' },
            { img: '/icons/icon3.png', text: 'Social Sentiment Analysis' },
            { img: '/icons/icon4.png', text: 'Top Holder Insights' },
          ].map((item, index) => (
            <div
              key={index}
              className="flex flex-col items-center p-4 bg-tech backdrop-blur-md border border-white/10 rounded-xl shadow-card card-hover"
            >
              <img src={item.img} alt={item.text} className="h-24 mb-4" />
              <p className="text-sm text-white">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* New Section: Image and Text Scroll Animation */}
      <section
        ref={newSectionRef}
        className="min-h-screen flex items-center justify-center relative bg-black py-8"
      >
        <div className="flex flex-col lg:flex-row items-center w-[90%] max-w-6xl">
          <div className="lg:w-1/2 w-full">
            <img
              src="/images/1.png"
              alt="Crypto Analytics Dashboard"
              className="w-full h-[500px] object-cover rounded-lg"
            />
          </div>
          <div className="lg:w-1/2 w-full lg:pl-8 mt-8 lg:mt-0">
            <h3 className="text-2xl font-bold text-white mb-6 uppercase">
              Our Vision
            </h3>
            <ul className="space-y-4">
              <li ref={text1Ref} className="text-base text-gray-500 flex items-start">
                <span className="text-neon-blue mr-2">•</span> Democratize crypto market intelligence with AI-driven insights accessible to all.
              </li>
              <li ref={text2Ref} className="text-base text-gray-500 flex items-start">
                <span className="text-neon-blue mr-2">•</span> Empower users with real-time data on CEX/DEX, top holders, and transactions.
              </li>
              <li ref={text3Ref} className="text-base text-gray-500 flex items-start">
                <span className="text-neon-blue mr-2">•</span> Reward community engagement through X-integrated activities and authentic interactions.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-16 flex flex-col items-center">
        <h3 className="text-2xl font-bold text-white mb-2 text-center uppercase">
          Take Control of the Crypto Market
        </h3>
        <p className="text-sm text-gray-400 mb-8 text-center max-w-2xl">
          <TypingEffect text="Join a community of savvy traders using AI to stay ahead of market trends. Sign up now and start earning rewards on X." speed={50} loop={false} cursorHeight="1rem" />
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-[90%]">
          {['Instant Insights', 'AI Automation', 'Community Rewards', 'Secure Data'].map(
            (item, index) => (
              <div
                key={index}
                className="p-4 backdrop-blur-md border border-white rounded-xl shadow-card text-center"
              >
                <p className="text-sm text-white">{item}</p>
              </div>
            )
          )}
        </div>
        <div className="flex gap-4 mt-8">
          <Link
            href="/signup"
            className="px-6 py-3 border border-2 border-white bg-white text-black rounded-full text-sm font-medium transition-all duration-300 uppercase"
          >
            <MatrixHoverEffect text="Sign Up" hoverColor="#00BFFF" />
          </Link>
        </div>
      </section>

      {/* Partners Section */}
      <section className="min-h-screen flex flex-col items-center justify-center relative bg-black py-8">
        <p className="text-center font-bold text-gray-500 text-xl mb-20 uppercase">
          On-chain data on 65+ chains
        </p>
        <div className="relative w-full max-w-3xl overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-64 md:w-48 bg-gradient-to-r from-black to-transparent z-10"></div>
          <div className="absolute inset-y-0 right-0 w-64 md:w-48 bg-gradient-to-l from-black to-transparent z-10"></div>

          <div className="flex animate-marquee mb-8">
            {[...row1Logos, ...row1Logos].map((logo, index) => (
              <img
                key={`row1-${index}`}
                src={logo}
                alt="Partner Logo"
                className="h-20 mx-12 opacity-80 hover:opacity-100 transition-opacity duration-300"
              />
            ))}
          </div>

          <div className="flex animate-reverse-marquee mb-8">
            {[...row2Logos, ...row2Logos].map((logo, index) => (
              <img
                key={`row2-${index}`}
                src={logo}
                alt="Partner Logo"
                className="h-20 mx-12 opacity-80 hover:opacity-100 transition-opacity duration-300"
              />
            ))}
          </div>

          <div className="flex animate-marquee">
            {[...row3Logos, ...row3Logos].map((logo, index) => (
              <img
                key={`row3-${index}`}
                src={logo}
                alt="Partner Logo"
                className="h-20 mx-12 opacity-80 hover:opacity-100 transition-opacity duration-300"
              />
            ))}
          </div>
        </div>
      </section>

      {/* Modal for Terms and Privacy */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          onClick={closeModal} // NEW: Close modal on overlay click
        >
          <div
            className="bg-tech backdrop-blur-md border border-white/10 rounded-xl p-8 w-full max-w-7xl h-[90vh] overflow-y-auto custom-scrollbar relative"
            onClick={(e) => e.stopPropagation()} // NEW: Prevent closing when clicking content
          >
            <button
              onClick={closeModal}
              aria-label="Close modal"
              className="absolute top-4 right-4 text-white text-xl font-bold hover:text-neon-blue transition-all duration-300"
            >
              ✕
            </button>
            <div className="prose prose-invert max-w-none">
              {modalContent === 'privacy' ? <PrivacyPolicyContent /> : <TermsOfServiceContent />}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-8 bg-tech backdrop-blur-md border-t border-white/10 relative">
        <img
          src="/icons/logo-landscape.png"
          alt="Xynapse Logo"
          className="h-16 absolute top-8 left-6"
        />
        <div className="flex flex-col items-center pt-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 w-[90%] max-w-4xl">
            {[
              {
                title: 'Product',
                links: ['Features', 'Pricing', 'Docs'],
              },
              {
                title: 'Resources',
                links: ['Blog', 'Support', 'Brand Kit'],
              },
            ].map((col, index) => (
              <div key={index} className="text-center">
                <h3 className="text-lg font-bold text-white mb-2 uppercase">{col.title}</h3>
                {col.links.map((link) => (
                  <p key={link} className="text-sm text-gray-200 mb-1">
                    <Link
                      href={`${link.toLowerCase()}`}
                      className="transition-all duration-300"
                    >
                      <MatrixHoverEffect text={link} hoverColor="#00BFFF" />
                    </Link>
                  </p>
                ))}
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-6">
            <Link href="https://x.com">
              <img src="/icons/x.png" alt="X" className="h-6" />
            </Link>
            <span>
              <img src="/icons/discord.png" alt="Discord Logo" className="h-7 opacity-50" />
            </span>
            {/* <Link href="https://discord.com">
              <img src="/discord.png" alt="Discord" className="h-6" />
            </Link> */}
            {/* <Link href="https://docs.com">
              <img src="/docs.png" alt="Blog" className="h-6" />
            </Link> */}
          </div>
          <div className="flex gap-4 mt-4">
            <button
              onClick={() => openModal('terms')}
              className="text-xs text-gray-200 transition-all duration-300"
            >
              <MatrixHoverEffect text="Terms" hoverColor="#00BFFF" />
            </button>
            <button
              onClick={() => openModal('privacy')}
              className="text-xs text-gray-200 transition-all duration-300"
            >
              <MatrixHoverEffect text="Privacy" hoverColor="#00BFFF" />
            </button>
            <Link
              href="#contact"
              className="text-xs text-gray-200 transition-all duration-300"
            >
              <MatrixHoverEffect text="Contact" hoverColor="#00BFFF" />
            </Link>
          </div>
          <p className="text-xs text-gray-200 mt-4">
            Copyright © 2025 Xynapse Analytics. All rights reserved.
          </p>
        </div>
      </footer>

      <style jsx>{`
        .animate-marquee {
          display: flex;
          animation: marquee 20s linear infinite;
        }
        .animate-reverse-marquee {
          display: flex;
          animation: reverse-marquee 20s linear infinite;
        }
        @keyframes marquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        @keyframes reverse-marquee {
          0% {
            transform: translateX(-50%);
          }
          100% {
            transform: translateX(0);
          }
        }
        @media (max-width: 640px) {
          .w-48 {
            width: 6rem;
          }
          .h-16 {
            height: 2.5rem;
          }
          .mx-10 {
            margin-left: 1rem;
            margin-right: 1rem;
          }
          .text-2xl {
            font-size: 1.5rem;
          }
          .text-base {
            font-size: 0.875rem;
          }
        }
        .prose-invert h1 {
          font-size: 2.25rem;
          font-weight: bold;
          margin-bottom: 1.5rem;
          text-transform: uppercase;
        }
        .prose-invert h2 {
          font-size: 1.5rem;
          font-weight: bold;
          margin-top: 2rem;
          margin-bottom: 1rem;
        }
        .prose-invert h3 {
          font-size: 1.25rem;
          font-weight: bold;
          margin-top: 1.5rem;
          margin-bottom: 0.75rem;
        }
        .prose-invert p {
          margin-bottom: 1rem;
          line-height: 1.6;
        }
        .prose-invert ul {
          list-style-type: disc;
          margin-left: 1.5rem;
          margin-bottom: 1rem;
        }
        .prose-invert li {
          margin-bottom: 0.5rem;
        }
        .prose-invert strong {
          font-weight: bold;
        }
        .prose-invert em {
          font-style: italic;
        }
        .prose-invert table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 1rem;
        }
        .prose-invert th,
        .prose-invert td {
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 0.75rem;
          text-align: left;
        }
        .prose-invert th {
          background-color: rgba(255, 255, 255, 0.05);
          font-weight: bold;
        }
      `}</style>
    </div>
  );
}
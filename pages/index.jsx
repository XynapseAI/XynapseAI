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
    const cardWidth = isMobile ? viewportWidth * 0.9 : Math.min(viewportWidth * 0.8, 1000);
    const cardHeight = isMobile ? viewportHeight * 0.35 : viewportHeight * 0.3;

    // Card section setup
    cardsContainerRef.current.style.minHeight = `${cardHeight * 1.4 + 150}px`;
    sectionRef.current.style.minHeight = `${viewportHeight * 1.2}px`;
    sectionRef.current.style.marginTop = isMobile ? '-10vh' : '0';

    gsap.set([card1Ref.current, card2Ref.current, card3Ref.current], {
      opacity: 0,
      y: 150,
      scale: isMobile ? 0.95 : 0.9,
      width: cardWidth,
      height: cardHeight,
      overwrite: 'auto',
    });

    const cardTl = gsap.timeline({
      scrollTrigger: {
        trigger: sectionRef.current,
        start: isMobile ? 'top 10%' : 'top 20%',
        end: isMobile ? `+=${viewportHeight * 1.5}` : `+=${viewportHeight * 2}`,
        scrub: 0.5,
        pin: true,
        pinSpacing: true,
        markers: false,
        immediateRender: true,
        anticipatePin: 1,
      },
    });

    cardTl
      .to(card1Ref.current, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: isMobile ? 0.8 : 1,
        ease: 'power3.out',
      }, 0)
      .to(card2Ref.current, {
        opacity: 1,
        y: isMobile ? cardHeight * 0.2 : 20,
        scale: 1,
        duration: isMobile ? 0.8 : 1,
        ease: 'power3.out',
      }, isMobile ? 0.3 : 0.5)
      .to(card3Ref.current, {
        opacity: 1,
        y: isMobile ? cardHeight * 0.4 : 40,
        scale: 1,
        duration: isMobile ? 0.8 : 1,
        ease: 'power3.out',
      }, isMobile ? 0.6 : 1);

    // Restore text animation for "Our Vision" section
    gsap.set([text1Ref.current, text2Ref.current, text3Ref.current], {
      opacity: 0,
      y: isMobile ? 30 : 50, // Smaller offset on mobile for tighter spacing
      overwrite: 'auto',
    });

    const textTl = gsap.timeline({
      scrollTrigger: {
        trigger: newSectionRef.current,
        start: isMobile ? 'top 20%' : 'top top', // Earlier trigger on mobile
        end: isMobile ? `+=${viewportHeight}` : '+=1000', // Shorter scroll distance on mobile
        pin: true,
        pinSpacing: true,
        scrub: 0.5, // Match card animation smoothness
        markers: false,
        immediateRender: true,
      },
    });

    textTl
      .to(text1Ref.current, {
        opacity: 1,
        y: 0,
        duration: isMobile ? 0.8 : 1,
        ease: 'power3.out',
      }, 0)
      .to(text2Ref.current, {
        opacity: 1,
        y: 0,
        duration: isMobile ? 0.8 : 1,
        ease: 'power3.out',
      }, isMobile ? 0.3 : 0.5)
      .to(text3Ref.current, {
        opacity: 1,
        y: 0,
        duration: isMobile ? 0.8 : 1,
        ease: 'power3.out',
      }, isMobile ? 0.6 : 1);

    ScrollTrigger.refresh();
  };

  initAnimation();

  window.addEventListener('resize', () => {
    ScrollTrigger.refresh();
    initAnimation();
  });

  return () => {
    ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    window.removeEventListener('resize', initAnimation);
    document.body.style.overflow = 'auto';
  };
}, []);

  const partnerLogos = [
    '/logos/logo1.png',
    '/logos/logo2.png',
    '/logos/logo3.png',
    '/logos/logo4.png',
    '/logos/logo5.png',
    '/logos/logo6.png',
    '/logos/logo7.png',
    '/logos/logo8.png',
    '/logos/logo9.png',
    '/logos/logo10.png',
    '/logos/logo11.png',
    '/logos/logo12.png',
    '/logos/logo13.png',
    '/logos/logo14.png',
    '/logos/logo15.png',
    '/logos/logo16.png',
    '/logos/logo17.png',
    '/logos/logo18.png',
    '/logos/logo19.png',
    '/logos/logo20.png',
    '/logos/logo21.png',
    '/logos/logo22.png',
    '/logos/logo23.png',
    '/logos/logo24.png',
    '/logos/logo25.png',
    '/logos/logo26.png',
    '/logos/logo27.png',
    '/logos/logo28.png',
    '/logos/logo29.png',
    '/logos/logo30.png',
    '/logos/logo31.png',
    '/logos/logo32.png',
    '/logos/logo33.png',
    '/logos/logo34.png',
    '/logos/logo35.png',
    '/logos/logo36.png',
    '/logos/logo37.png',
    '/logos/logo38.png',
    '/logos/logo39.png',
    '/logos/logo40.png',
    '/logos/logo41.png',
  ];

  const row1Logos = partnerLogos.slice(0, 14);
  const row2Logos = partnerLogos.slice(14, 28);
  const row3Logos = partnerLogos.slice(28, 41);

  const trustedByLogos = [
    '/logos/logo1.png',
    '/logos/logo2.png',
    '/logos/logo3.png',
    '/logos/logo4.png',
    '/logos/logo5.png',
  ];

  const cardData = [
    {
      title: 'Grok AI',
      description:
        'Harness the power of Grok, created by xAI, to deliver unparalleled market predictions and deep crypto analytics with real-time precision.',
      image: '/logos/grok.png',
    },
    {
      title: 'Gemini AI',
      description:
        'Leverage Gemini’s advanced reasoning capabilities to uncover hidden market trends and optimize your crypto investment strategies.',
      image: '/logos/gemini.png',
    },
    {
      title: 'ChatGPT AI',
      description:
        'Utilize ChatGPT’s natural language processing to analyze social sentiment on X and generate actionable insights for market movements.',
      image: '/logos/gpt.png',
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-black text-white overflow-x-hidden font-jetbrains">
      <Head>
        <title>
          {modalContent === 'privacy'
            ? 'Xynapse Privacy Policy'
            : modalContent === 'terms'
              ? 'Xynapse Terms of Service'
              : 'Xynapse'}
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
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </Head>

      {/* Header */}
      <header className="w-full py-4 px-6 flex justify-between items-center bg-gray-900/30 backdrop-blur-lg border-b border-white/10 z-50 sticky top-0">
        <img src="/logos/logo-landscape.png" alt="Xynapse Logo" className="h-12 sm:h-16" />
        <div className="flex items-center gap-4">
          <Link href="https://x.com" className="transition-all duration-300">
            <img src="/logos/x.png" alt="X Logo" className="h-5 sm:h-6" />
          </Link>
          <span>
            <img src="/logos/discord.png" alt="Discord Logo" className="h-5 sm:h-6 opacity-50" />
          </span>
          <Link
            href="/dashboard"
            className="px-4 py-2 text-white text-sm border border-white/20 rounded-lg font-medium transition-all duration-300 hover:bg-white/10 backdrop-blur-md"
          >
            <MatrixHoverEffect text="Launch App" hoverColor="#00BFFF" />
          </Link>
        </div>
      </header>

      {/* Banner */}
      <section className="min-h-screen flex flex-col items-center justify-center py-16 bg-gradient-to-b from-black to-gray-900">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="text-4xl sm:text-5xl md:text-6xl font-bold text-center text-white mb-6 uppercase"
        >
          Master the Market with AI
        </motion.h1>
        <p className="text-sm sm:text-base text-gray-400 mb-8 text-center max-w-2xl">
          Unlock real-time insights, predictive analytics, and social sentiment analysis powered by Grok, Gemini, and ChatGPT.
        </p>
        <div className="flex gap-4">
          <Link
            href="#learn-more"
            className="px-6 py-3 text-white border border-white/20 rounded-full text-sm font-medium transition-all duration-300 hover:bg-white/10 backdrop-blur-md uppercase"
          >
            <MatrixHoverEffect text="Discover Now" hoverColor="#00BFFF" />
          </Link>
          <Link
            href="/dashboard"
            className="px-6 py-3 text-white border border-white/20 rounded-full text-sm font-medium transition-all duration-300 hover:bg-white/10 backdrop-blur-md uppercase"
          >
            <MatrixHoverEffect text="Launch App" hoverColor="#00BFFF" />
          </Link>
        </div>
      </section>

      {/* Trusted By */}
      <section className="py-8">
        <p className="text-center text-gray-400 text-xl font-bold mb-6 uppercase">
          Trusted by Top Crypto Innovators
        </p>
        <div className="w-full overflow-hidden">
          <div className="flex animate-marquee">
            {[...trustedByLogos, ...trustedByLogos].map((logo, index) => (
              <img
                key={`trusted-${index}`}
                src={logo}
                alt="Trusted By Logo"
                className="h-12 sm:h-16 mx-6 sm:mx-10 opacity-80 hover:opacity-100 transition-opacity duration-300"
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
      <section className="py-16 flex flex-col items-center relative z-10">
        <h3 className="text-2xl sm:text-3xl font-bold text-white mb-4 text-center uppercase">
          Why Xynapse Analytics?
        </h3>
        <p className="text-sm sm:text-base text-gray-400 mb-8 text-center max-w-2xl">
          <TypingEffect text="Cutting-edge tools to navigate the volatile crypto market with confidence." speed={50} loop={false} cursorHeight="1rem" />
        </p>
        <div className="w-[90%] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { img: '/logos/icon1.png', text: 'Real-Time Token Tracking' },
            { img: '/logos/icon2.png', text: 'AI-Powered Predictions' },
            { img: '/logos/icon3.png', text: 'Social Sentiment Analysis' },
            { img: '/logos/icon4.png', text: 'Top Holder Insights' },
          ].map((item, index) => (
            <motion.div
              key={index}
              className="flex flex-col items-center p-4 bg-gray-900/30 backdrop-blur-lg border border-white/20 rounded-xl shadow-glow-neon transition-all duration-300 hover:shadow-neon-blue hover:scale-[1.02]"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <img src={item.img} alt={item.text} className="h-16 sm:h-20 mb-4" />
              <p className="text-sm text-white text-center">{item.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* New Section: Image and Text Scroll Animation */}
      <section
        ref={newSectionRef}
        className="min-h-screen flex items-center justify-center relative bg-black py-16"
      >
        <div className="flex flex-col lg:flex-row items-center w-[90%] max-w-6xl">
          <div className="lg:w-1/2 w-full">
            <img
              src="/images/1.png"
              alt="Crypto Analytics Dashboard"
              className="w-full h-[400px] sm:h-[500px] object-cover rounded-2xl border border-white/20 shadow-glow-neon"
            />
          </div>
          <div className="lg:w-1/2 w-full lg:pl-8 mt-8 lg:mt-0">
            <h3 className="text-2xl sm:text-3xl font-bold text-white mb-6 uppercase">
              Our Vision
            </h3>
            <ul className="space-y-4">
              <li ref={text1Ref} className="text-sm sm:text-base text-gray-400 flex items-start">
                <span className="text-neon-blue mr-2">•</span> Democratize crypto market intelligence with AI-driven insights.
              </li>
              <li ref={text2Ref} className="text-sm sm:text-base text-gray-400 flex items-start">
                <span className="text-neon-blue mr-2">•</span> Empower users with real-time data on CEX/DEX and transactions.
              </li>
              <li ref={text3Ref} className="text-sm sm:text-base text-gray-400 flex items-start">
                <span className="text-neon-blue mr-2">•</span> Reward community engagement through X-integrated activities.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-16 flex flex-col items-center">
        <h3 className="text-2xl sm:text-3xl font-bold text-white mb-4 text-center uppercase">
          Take Control of the Crypto Market
        </h3>
        <p className="text-sm sm:text-base text-gray-400 mb-8 text-center max-w-2xl">
          <TypingEffect text="Join savvy traders using AI to stay ahead of market trends." speed={50} loop={false} cursorHeight="1rem" />
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-[90%]">
          {['Instant Insights', 'AI Automation', 'Community Rewards', 'Secure Data'].map(
            (item, index) => (
              <motion.div
                key={index}
                className="p-4 bg-gray-900/30 backdrop-blur-lg border border-white/20 rounded-xl shadow-glow-neon text-center transition-all duration-300 hover:shadow-neon-blue"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <p className="text-sm text-white">{item}</p>
              </motion.div>
            )
          )}
        </div>
        <div className="flex gap-4 mt-8">
          <Link
            href="/signup"
            className="px-6 py-3 bg-white text-black rounded-full text-sm font-medium transition-all duration-300 uppercase shadow-glow-neon hover:bg-gray-200"
          >
            <MatrixHoverEffect text="Sign Up" hoverColor="#00BFFF" />
          </Link>
        </div>
      </section>

      {/* Partners Section */}
      <section className="min-h-screen flex flex-col items-center justify-center relative bg-black py-16">
        <p className="text-center font-bold text-gray-400 text-xl mb-12 uppercase">
          On-chain data on 65+ chains
        </p>
        <div className="relative w-full max-w-4xl overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-32 sm:w-48 bg-gradient-to-r from-black to-transparent z-10"></div>
          <div className="absolute inset-y-0 right-0 w-32 sm:w-48 bg-gradient-to-l from-black to-transparent z-10"></div>
          <div className="flex animate-marquee mb-8">
            {[...row1Logos, ...row1Logos].map((logo, index) => (
              <img
                key={`row1-${index}`}
                src={logo}
                alt="Partner Logo"
                className="h-12 sm:h-16 mx-6 sm:mx-12 opacity-80 hover:opacity-100 transition-opacity duration-300"
              />
            ))}
          </div>
          <div className="flex animate-reverse-marquee mb-8">
            {[...row2Logos, ...row2Logos].map((logo, index) => (
              <img
                key={`row2-${index}`}
                src={logo}
                alt="Partner Logo"
                className="h-12 sm:h-16 mx-6 sm:mx-12 opacity-80 hover:opacity-100 transition-opacity duration-300"
              />
            ))}
          </div>
          <div className="flex animate-marquee">
            {[...row3Logos, ...row3Logos].map((logo, index) => (
              <img
                key={`row3-${index}`}
                src={logo}
                alt="Partner Logo"
                className="h-12 sm:h-16 mx-6 sm:mx-12 opacity-80 hover:opacity-100 transition-opacity duration-300"
              />
            ))}
          </div>
        </div>
      </section>

      {/* Modal for Terms and Privacy */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/75 flex items-center justify-center z-50"
          onClick={closeModal}
        >
          <div
            className="bg-gray-900/30 backdrop-blur-lg border border-white/20 rounded-2xl w-full max-w-7xl h-[90vh] relative flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 backdrop-blur-lg border-b border-white/20 p-6 flex justify-between items-center">
              <h1 className="text-2xl sm:text-3xl font-bold text-white uppercase">
                {modalContent === 'privacy'
                  ? 'Xynapse Privacy Policy'
                  : 'Xynapse Terms of Service'}
                <span className="block text-sm sm:text-base text-gray-400 mt-1">
                  Effective Date: June 21, 2025
                </span>
              </h1>
              <button
                onClick={closeModal}
                aria-label="Close modal"
                className="text-white text-xl font-bold hover:text-neon-blue transition-all duration-300"
              >
                ✕
              </button>
            </div>
            <div className="text-xs sm:text-sm flex-1 overflow-y-auto custom-scrollbar p-6 prose prose-invert max-w-none">
              {modalContent === 'privacy' ? <PrivacyPolicyContent /> : <TermsOfServiceContent />}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-8 bg-gray-900/30 backdrop-blur-lg border-t border-white/20 relative">
        <img
          src="/logos/logo-landscape.png"
          alt="Xynapse Logo"
          className="h-12 sm:h-16 absolute top-8 left-6"
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
              <img src="/logos/x.png" alt="X" className="h-5 sm:h-6" />
            </Link>
            <span>
              <img src="/logos/discord.png" alt="Discord Logo" className="h-5 sm:h-6 opacity-50" />
            </span>
          </div>
          <div className="flex gap-4 mt-4">
            <button
              onClick={() => openModal('terms')}
              className="text-xs sm:text-sm text-gray-200 transition-all duration-300"
            >
              <MatrixHoverEffect text="Terms" hoverColor="#00BFFF" />
            </button>
            <button
              onClick={() => openModal('privacy')}
              className="text-xs sm:text-sm text-gray-200 transition-all duration-300"
            >
              <MatrixHoverEffect text="Privacy" hoverColor="#00BFFF" />
            </button>
            <Link
              href="#contact"
              className="text-xs sm:text-sm text-gray-200 transition-all duration-300"
            >
              <MatrixHoverEffect text="Contact" hoverColor="#00BFFF" />
            </Link>
          </div>
          <p className="text-xs sm:text-sm text-gray-200 mt-4">
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
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes reverse-marquee {
          0% { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }
        .shadow-glow-neon {
          box-shadow: 0 0 10px rgba(0, 191, 255, 0.3), 0 0 20px rgba(0, 191, 255, 0.2);
        }
        .shadow-neon-blue:hover {
          box-shadow: 0 0 15px rgba(0, 191, 255, 0.5);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
        .prose-invert h1 {
          font-size: 2rem sm:2.25rem;
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
        @media (max-width: 640px) {
          .w-48 { width: 6rem; }
          .h-16 { height: 2.5rem; }
          .mx-10 { margin-left: 1rem; margin-right: 1rem; }
          .text-2xl { font-size: 1.5rem; }
          .text-base { font-size: 0.875rem; }
        }
      `}</style>
    </div>
  );
}
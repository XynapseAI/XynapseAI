'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
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

// NEW: TiltCard component for 3D hover effect
const TiltCard = ({ children, className }) => {
  const ref = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const xSpring = useSpring(x, { stiffness: 300, damping: 30 });
  const ySpring = useSpring(y, { stiffness: 300, damping: 30 });

  const rotateX = useTransform(ySpring, [-0.5, 0.5], ['10deg', '-10deg']);
  const rotateY = useTransform(xSpring, [-0.5, 0.5], ['-10deg', '10deg']);

  const handleMouseMove = (e) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const xPct = mouseX / width - 0.5;
    const yPct = mouseY / height - 0.5;

    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        rotateX,
        rotateY,
        transformStyle: 'preserve-3d',
      }}
      className={className}
    >
      <div style={{ transform: 'translateZ(50px)' }}>{children}</div>
    </motion.div>
  );
};

export default function Home() {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [isScrolled, setIsScrolled] = useState(false);

  // Refs for GSAP animations
  const mainRef = useRef(null);
  const card1Ref = useRef(null);
  const card2Ref = useRef(null);
  const card3Ref = useRef(null);
  const sectionRef = useRef(null);
  const newSectionRef = useRef(null);

  useEffect(() => {
    const path = router.asPath;
    if (path.includes('/privacy-policy')) {
      setModalContent('privacy');
      setIsModalOpen(true);
      document.body.style.overflow = 'hidden';
    } else if (path.includes('/terms-of-service')) {
      setModalContent('terms');
      setIsModalOpen(true);
      document.body.style.overflow = 'hidden';
    }
  }, [router.asPath]);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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

  const handleSmoothScroll = (e, targetId) => {
    e.preventDefault();
    const targetElement = document.querySelector(targetId);
    if (targetElement) {
      window.scrollTo({
        top: targetElement.offsetTop,
        behavior: 'smooth',
      });
    }
  };

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.matchMedia().add({
        isDesktop: `(min-width: 641px)`,
        isMobile: `(max-width: 640px)`,
      }, (context) => {
        const { isDesktop, isMobile } = context.conditions;
        
        // --- Card Stack Animation ---
        gsap.set([card1Ref.current, card2Ref.current, card3Ref.current], {
            opacity: 0,
            y: 150,
            scale: 0.9,
            width: isMobile ? '90vw' : '80vw',
            maxWidth: isMobile ? 'none' : '1000px',
            // CHANGE: Replaced fixed height with a larger min-height
            minHeight: isMobile ? '50vh' : '35vh',
        });

        const cardTl = gsap.timeline({
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 20%',
            end: `+=${window.innerHeight * 1.5}`,
            scrub: 1,
            pin: true,
            pinSpacing: true,
            anticipatePin: 1,
          },
        });
        
        cardTl
          .to(card1Ref.current, { opacity: 1, y: 0, scale: 1 }, 0)
          .to(card2Ref.current, { opacity: 1, y: isDesktop ? 20 : 30, scale: 1 }, 0.2)
          .to(card3Ref.current, { opacity: 1, y: isDesktop ? 40 : 60, scale: 1 }, 0.4);

        // --- Our Vision Text Animation ---
        const visionItems = gsap.utils.toArray('.vision-item');
        gsap.set(visionItems, { opacity: 0, y: 50 });

        gsap.to(visionItems, {
          opacity: 1,
          y: 0,
          duration: 1,
          ease: 'power3.out',
          stagger: 0.3,
          scrollTrigger: {
            trigger: newSectionRef.current,
            start: isMobile ? 'top 60%' : 'top 50%',
            toggleActions: 'play none none reverse',
          },
        });
      });
    }, mainRef);

    return () => ctx.revert();
  }, []);
  
  const partnerLogos = [
    '/logos/logo1.png', '/logos/logo2.png', '/logos/logo3.png', '/logos/logo4.png', '/logos/logo5.png',
    '/logos/logo6.png', '/logos/logo7.png', '/logos/logo8.png', '/logos/logo9.png', '/logos/logo10.png',
    '/logos/logo11.png', '/logos/logo12.png', '/logos/logo13.png', '/logos/logo14.png', '/logos/logo15.png',
    '/logos/logo16.png', '/logos/logo17.png', '/logos/logo18.png', '/logos/logo19.png', '/logos/logo20.png',
    '/logos/logo21.png', '/logos/logo22.png', '/logos/logo23.png', '/logos/logo24.png', '/logos/logo25.png',
    '/logos/logo26.png', '/logos/logo27.png', '/logos/logo28.png', '/logos/logo29.png', '/logos/logo30.png',
    '/logos/logo31.png', '/logos/logo32.png', '/logos/logo33.png', '/logos/logo34.png', '/logos/logo35.png',
    '/logos/logo36.png', '/logos/logo37.png', '/logos/logo38.png', '/logos/logo39.png', '/logos/logo40.png',
    '/logos/logo41.png',
  ];
  const row1Logos = partnerLogos.slice(0, 14);
  const row2Logos = partnerLogos.slice(14, 28);
  const row3Logos = partnerLogos.slice(28, 41);
  const trustedByLogos = [
    '/logos/logo1.png', '/logos/logo2.png', '/logos/logo3.png', '/logos/logo4.png', '/logos/logo5.png',
  ];
  const cardData = [
    { title: 'Grok AI', description: 'Harness the power of Grok, created by xAI, to deliver unparalleled market predictions and deep crypto analytics with real-time precision.', image: '/logos/grok.png' },
    { title: 'Gemini AI', description: 'Leverage Gemini’s advanced reasoning capabilities to uncover hidden market trends and optimize your crypto investment strategies.', image: '/logos/gemini.png' },
    { title: 'ChatGPT AI', description: 'Utilize ChatGPT’s natural language processing to analyze social sentiment on X and generate actionable insights for market movements.', image: '/logos/gpt.png' },
  ];

  return (
    <div ref={mainRef} className="min-h-screen flex flex-col bg-black text-white overflow-x-hidden font-jetbrains">
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
                    ? "Read Xynapse's Privacy Policy to understand how we protect your personal data."
                    : modalContent === 'terms'
                        ? "Review Xynapse's Terms of Service for our AI-powered crypto analytics platform."
                        : 'Explore the ultimate AI-powered crypto market analytics platform.'
                }
            />
            <link
                href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap"
                rel="stylesheet"
            />
        </Head>

      <header className={`w-full py-4 px-6 flex justify-between items-center z-50 sticky top-0 transition-all duration-300 ${isScrolled ? 'bg-black/50 backdrop-blur-lg border-b border-white/10 shadow-lg' : 'bg-transparent border-b border-transparent'}`}>
        <img src="/logos/logo-landscape.png" alt="Xynapse Logo" className="h-12 sm:h-16" />
        <div className="flex items-center gap-4">
          <Link href="https://x.com" className="transition-all duration-300"><img src="/logos/x.png" alt="X Logo" className="h-5 sm:h-6" /></Link>
          <span><img src="/logos/discord.png" alt="Discord Logo" className="h-5 sm:h-6 opacity-50" /></span>
          <Link href="/dashboard" className="px-4 py-2 text-white text-sm border border-white/20 rounded-lg font-medium transition-all duration-300 hover:bg-white/10 backdrop-blur-md">
            <MatrixHoverEffect text="App" hoverColor="#00BFFF" />
          </Link>
        </div>
      </header>

      <section className="min-h-screen flex flex-col items-center justify-center py-16 relative overflow-hidden animated-gradient-background">
        <img src="/logos/grok.png" alt="floating icon" className="floating-icon" style={{ top: '20%', left: '15%', width: '80px', animationDuration: '8s' }} />
        <img src="/logos/gemini.png" alt="floating icon" className="floating-icon" style={{ top: '60%', right: '10%', width: '60px', animationDuration: '12s', animationDelay: '2s' }} />
        <img src="/logos/gpt.png" alt="floating icon" className="floating-icon" style={{ bottom: '15%', left: '25%', width: '50px', animationDuration: '10s', animationDelay: '1s' }} />

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="text-4xl sm:text-5xl md:text-6xl font-bold text-center text-white mb-6 uppercase z-10"
        >
          <TypingEffect text="Master the Market with AI" speed={100} loop={false} cursorHeight="3rem" />
        </motion.h1>
        <p className="text-sm sm:text-base text-gray-400 mb-8 text-center max-w-2xl z-10">
          Unlock real-time insights, predictive analytics, and social sentiment analysis powered by Grok, Gemini, and ChatGPT.
        </p>
        <div className="flex gap-4 z-10">
          <a href="#learn-more" onClick={(e) => handleSmoothScroll(e, '#learn-more')} className="px-6 py-3 text-white border border-white/20 rounded-full text-sm font-medium transition-all duration-300 hover:bg-white/10 backdrop-blur-md uppercase">
            <MatrixHoverEffect text="Discover Now" hoverColor="#00BFFF" />
          </a>
          <Link href="/dashboard" className="px-6 py-3 text-white border border-white/20 rounded-full text-sm font-medium transition-all duration-300 hover:bg-white/10 backdrop-blur-md uppercase">
            <MatrixHoverEffect text="App" hoverColor="#00BFFF" />
          </Link>
        </div>
      </section>

      <section className="py-8" id="learn-more">
        <p className="text-center text-gray-400 text-xl font-bold mb-6 uppercase">Trusted by Top Crypto Innovators</p>
        <div className="w-full overflow-hidden">
          <div className="flex animate-marquee">
            {[...trustedByLogos, ...trustedByLogos].map((logo, index) => (
              <img key={`trusted-${index}`} src={logo} alt="Trusted By Logo" className="h-12 sm:h-16 mx-6 sm:mx-10 opacity-80 hover:opacity-100 hover:scale-110 transition-all duration-300 hover:drop-shadow-glow" />
            ))}
          </div>
        </div>
      </section>

      {/* UPDATED: Cards section */}
      <section ref={sectionRef} className="py-10 flex flex-col items-center relative z-20 mt-16">
        <h2 className="text-3xl font-bold text-white mb-12 text-center uppercase">
          <TypingEffect text="Powered by Elite AI Models" speed={150} loop={false} cursorHeight="2rem" />
        </h2>
        <div className="relative flex items-start justify-center pt-8 w-full" style={{ minHeight: '60vh' }}>
          {[card1Ref, card2Ref, card3Ref].map((ref, index) => (
            <div key={index} ref={ref} className="absolute flex justify-center w-full">
              {/* CHANGE: Added h-[33vh] for 1/3 page height, changed flex-col to flex-row and items-center to start, added space-x-6 */}
              <TiltCard className="bg-tech backdrop-blur-md border border-white/10 rounded-xl shadow-card flex flex-col sm:flex-row items-center sm:items-start justify-between p-6 sm:p-8 w-full h-[33vh] space-x-6">
                {/* Logo on the left */}
                <div className="flex-shrink-0 flex justify-center items-center">
                  {/* CHANGE: Adjusted image size to w-20 h-20 for smaller logo */}
                  <img src={cardData[index].image} alt={cardData[index].title} className="w-20 h-20 object-contain rounded-lg"/>
                </div>
                {/* Text content on the right */}
                <div className="flex-1 p-2 sm:p-6 text-center sm:text-left">
                  <h3 className="text-2xl font-bold text-white mb-4 sm:mb-6">{cardData[index].title}</h3>
                  <p className="text-base text-gray-500">{cardData[index].description}</p>
                </div>
              </TiltCard>
            </div>
          ))}
        </div>
      </section>

      <section className="py-16 flex flex-col items-center relative z-10">
        <h3 className="text-2xl sm:text-3xl font-bold text-white mb-4 text-center uppercase">Why Xynapse Analytics?</h3>
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
              className="flex flex-col items-center p-4 bg-gray-900/30 backdrop-blur-lg border border-white/20 rounded-xl shadow-glow-neon transition-all duration-300 hover:shadow-neon-blue"
              whileHover={{ scale: 1.05, y: -5 }}
              transition={{ type: 'spring', stiffness: 300 }}
            >
              <img src={item.img} alt={item.text} className="h-16 sm:h-20 mb-4" />
              <p className="text-sm text-white text-center">{item.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section ref={newSectionRef} className="min-h-screen flex items-center justify-center relative bg-black py-16">
        <div className="flex flex-col lg:flex-row items-center w-[90%] max-w-6xl">
          <div className="lg:w-1/2 w-full">
            <img src="/images/1.png" alt="Crypto Analytics Dashboard" className="w-full h-auto max-h-[500px] object-cover rounded-2xl border border-white/20 shadow-glow-neon"/>
          </div>
          <div className="lg:w-1/2 w-full lg:pl-8 mt-8 lg:mt-0">
            <h3 className="text-2xl sm:text-3xl font-bold text-white mb-6 uppercase">Our Vision</h3>
            <ul className="space-y-4">
              <li className="vision-item text-sm sm:text-base text-gray-400 flex items-start"><span className="text-neon-blue mr-2">•</span> Democratize crypto market intelligence with AI-driven insights.</li>
              <li className="vision-item text-sm sm:text-base text-gray-400 flex items-start"><span className="text-neon-blue mr-2">•</span> Empower users with real-time data on CEX/DEX and transactions.</li>
              <li className="vision-item text-sm sm:text-base text-gray-400 flex items-start"><span className="text-neon-blue mr-2">•</span> Reward community engagement through X-integrated activities.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="py-16 flex flex-col items-center relative animated-gradient-background">
        <h3 className="text-2xl sm:text-3xl font-bold text-white mb-4 text-center uppercase z-10">Take Control of the Crypto Market</h3>
        <p className="text-sm sm:text-base text-gray-400 mb-8 text-center max-w-2xl z-10">
          <TypingEffect text="Join savvy traders using AI to stay ahead of market trends." speed={50} loop={false} cursorHeight="1rem" />
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-[90%] z-10">
          {['Instant Insights', 'AI Automation', 'Community Rewards', 'Secure Data'].map((item, index) => (
            <motion.div
              key={index}
              className="p-4 bg-gray-900/30 backdrop-blur-lg border border-white/20 rounded-xl shadow-glow-neon text-center transition-all duration-300 hover:shadow-neon-blue"
              whileHover={{ scale: 1.05, y: -5 }}
              transition={{ type: 'spring', stiffness: 400, damping: 10 }}
            >
              <p className="text-sm text-white">{item}</p>
            </motion.div>
          ))}
        </div>
        <div className="flex gap-4 mt-8 z-10">
          <Link href="/signup" className="px-6 py-3 bg-white text-black rounded-full text-sm font-medium transition-all duration-300 uppercase shadow-glow-neon hover:bg-gray-200 hover:scale-105">
            <MatrixHoverEffect text="Sign Up" hoverColor="#00BFFF" />
          </Link>
        </div>
      </section>

      <section className="min-h-screen flex flex-col items-center justify-center relative bg-black py-16">
        <p className="text-center font-bold text-gray-400 text-xl mb-12 uppercase">On-chain data on 65+ chains</p>
        <div className="relative w-full max-w-4xl overflow-hidden">
            <div className="absolute inset-y-0 left-0 w-32 sm:w-48 bg-gradient-to-r from-black to-transparent z-10"></div>
            <div className="absolute inset-y-0 right-0 w-32 sm:w-48 bg-gradient-to-l from-black to-transparent z-10"></div>
            <div className="flex animate-marquee mb-8">
                {[...row1Logos, ...row1Logos].map((logo, index) => (
                <img key={`row1-${index}`} src={logo} alt="Partner Logo" className="h-12 sm:h-16 mx-6 sm:mx-12 opacity-80 hover:opacity-100 hover:scale-110 transition-all duration-300 hover:drop-shadow-glow"/>
                ))}
            </div>
            <div className="flex animate-reverse-marquee mb-8">
                {[...row2Logos, ...row2Logos].map((logo, index) => (
                <img key={`row2-${index}`} src={logo} alt="Partner Logo" className="h-12 sm:h-16 mx-6 sm:mx-12 opacity-80 hover:opacity-100 hover:scale-110 transition-all duration-300 hover:drop-shadow-glow"/>
                ))}
            </div>
            <div className="flex animate-marquee">
                {[...row3Logos, ...row3Logos].map((logo, index) => (
                <img key={`row3-${index}`} src={logo} alt="Partner Logo" className="h-12 sm:h-16 mx-6 sm:mx-12 opacity-80 hover:opacity-100 hover:scale-110 transition-all duration-300 hover:drop-shadow-glow"/>
                ))}
            </div>
        </div>
      </section>

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
                    Effective Date: July 19, 2025
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

      <footer className="py-8 bg-gray-900/30 backdrop-blur-lg border-t border-white/20 relative">
        <div className="glowing-divider"></div>
        <img
            src="/logos/logo-landscape.png"
            alt="Xynapse Logo"
            className="h-12 sm:h-16 absolute top-8 left-6"
        />
        <div className="flex flex-col items-center pt-16">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 w-[90%] max-w-4xl">
            {[
                { title: 'Product', links: ['Features', 'Pricing', 'Docs'] },
                { title: 'Resources', links: ['Blog', 'Support', 'Brand Kit'] },
            ].map((col, index) => (
                <div key={index} className="text-center">
                    <h3 className="text-lg font-bold text-white mb-2 uppercase">{col.title}</h3>
                    {col.links.map((link) => (
                        <p key={link} className="text-sm text-gray-200 mb-1">
                        <Link
                            href={`/${link.toLowerCase()}`}
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
          animation: marquee 40s linear infinite;
        }
        .animate-reverse-marquee {
          display: flex;
          animation: reverse-marquee 40s linear infinite;
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
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.3); }
        
        /* Prose styles for modal content */
        .prose-invert h1, .prose-invert h2, .prose-invert h3 { font-weight: bold; }
        .prose-invert h1 { font-size: 2rem; margin-bottom: 1.5rem; text-transform: uppercase; }
        .prose-invert h2 { font-size: 1.5rem; margin-top: 2rem; margin-bottom: 1rem; }
        .prose-invert h3 { font-size: 1.25rem; margin-top: 1.5rem; margin-bottom: 0.75rem; }
        .prose-invert p { margin-bottom: 1rem; line-height: 1.6; }
        .prose-invert ul { list-style-type: disc; margin-left: 1.5rem; margin-bottom: 1rem; }
        .prose-invert li { margin-bottom: 0.5rem; }
        .prose-invert strong { font-weight: bold; }
        .prose-invert em { font-style: italic; }
        .prose-invert table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
        .prose-invert th, .prose-invert td { border: 1px solid rgba(255, 255, 255, 0.1); padding: 0.75rem; text-align: left; }
        .prose-invert th { background-color: rgba(255, 255, 255, 0.05); }

        /* NEW STYLES */
        .drop-shadow-glow {
          filter: drop-shadow(0 0 8px rgba(0, 191, 255, 0.7));
        }

        .animated-gradient-background {
          background: linear-gradient(125deg, #000428, #004e92, #1a001a, #2a0845);
          background-size: 400% 400%;
          animation: gradientAnimation 15s ease infinite;
          position: relative;
        }

        @keyframes gradientAnimation {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        
        .floating-icon {
          position: absolute;
          opacity: 0.15;
          filter: blur(1px);
          animation: float 10s ease-in-out infinite;
          z-index: 0;
        }

        @keyframes float {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
          100% { transform: translateY(0px); }
        }

        .glowing-divider {
            position: absolute;
            top: -2px;
            left: 0;
            right: 0;
            height: 4px;
            background: radial-gradient(ellipse at center, rgba(0, 191, 255, 0.4) 0%, rgba(0, 191, 255, 0) 70%);
        }
      `}</style>
    </div>
  );
}
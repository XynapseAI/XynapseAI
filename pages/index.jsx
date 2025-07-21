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

// TiltCard component for 3D hover effect
const TiltCard = ({ children, className }) => {
  const ref = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const xSpring = useSpring(x, { stiffness: 300, damping: 30 });
  const ySpring = useSpring(y, { stiffness: 300, damping: 30 });

  const rotateX = useTransform(ySpring, [-0.5, 0.5], ['8deg', '-8deg']);
  const rotateY = useTransform(xSpring, [-0.5, 0.5], ['-8deg', '8deg']);

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
      <div style={{ transform: 'translateZ(60px)' }}>{children}</div>
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
  const visionSectionRef = useRef(null);

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

        // Card Stack Animation
        gsap.set([card1Ref.current, card2Ref.current, card3Ref.current], {
          opacity: 0,
          y: 100,
          scale: 0.95,
          width: isMobile ? '90vw' : '80vw',
          maxWidth: isMobile ? 'none' : '1100px',
          minHeight: isMobile ? '60vh' : '40vh',
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
          .to(card2Ref.current, { opacity: 1, y: isDesktop ? 30 : 40, scale: 1 }, 0.2)
          .to(card3Ref.current, { opacity: 1, y: isDesktop ? 60 : 80, scale: 1 }, 0.4);

        // Vision Section Animation
        const visionItems = gsap.utils.toArray('.vision-item');
        gsap.set(visionItems, { opacity: 0, y: 30 });

        gsap.to(visionItems, {
          opacity: 1,
          y: 0,
          duration: 1,
          ease: 'power3.out',
          stagger: 0.3,
          scrollTrigger: {
            trigger: visionSectionRef.current,
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
    <div ref={mainRef} className="min-h-screen flex flex-col bg-black text-white overflow-x-hidden font-inter">
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
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </Head>

      {/* Header */}
      <header className={`w-full py-4 px-6 sm:px-8 flex justify-between items-center z-50 sticky top-0 transition-all duration-500 ${isScrolled ? 'bg-black/70 backdrop-blur-xl border-b border-white/10 shadow-neon-blue' : 'bg-transparent border-b border-transparent'}`}>
        <img src="/logos/logo-landscape.png" alt="Xynapse Logo" className="h-10 sm:h-14" />
        <div className="flex items-center gap-4 sm:gap-6">
          <Link href="https://x.com" className="transition-all duration-300"><img src="/logos/x.png" alt="X Logo" className="h-5 sm:h-6" /></Link>
          <span><img src="/logos/discord.png" alt="Discord Logo" className="h-5 sm:h-6 opacity-60 hover:opacity-100 transition-all duration-300" /></span>
          <Link href="/dashboard" className="px-4 sm:px-6 py-2 text-white text-sm sm:text-base bg-gradient-to-r from-neon-blue to-green-500 hover:from-green-500 hover:to-neon-blue rounded-full font-medium transition-all duration-300 shadow-glow-neon">
            <MatrixHoverEffect text="App" hoverColor="#00BFFF" />
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="min-h-screen flex flex-col items-center justify-center py-20 px-6 sm:px-8 relative overflow-hidden animated-gradient-background">
        <img src="/logos/grok.png" alt="floating icon" className="floating-icon" style={{ top: '15%', left: '10%', width: '70px', animationDuration: '7s' }} />
        <img src="/logos/gemini.png" alt="floating icon" className="floating-icon" style={{ top: '65%', right: '15%', width: '60px', animationDuration: '9s', animationDelay: '2s' }} />
        <img src="/logos/gpt.png" alt="floating icon" className="floating-icon" style={{ bottom: '10%', left: '20%', width: '50px', animationDuration: '8s', animationDelay: '1s' }} />

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="text-4xl sm:text-5xl md:text-7xl font-bold text-center text-white mb-6 uppercase z-10"
        >
          <TypingEffect text="Master the Market with AI" speed={80} loop={false} cursorHeight="3rem" />
        </motion.h1>
        <p className="text-sm sm:text-lg text-gray-300 mb-10 text-center max-w-3xl z-10 leading-relaxed">
          Unlock real-time insights, predictive analytics, and social sentiment analysis powered by Grok, Gemini, and ChatGPT.
        </p>
        <div className="flex gap-4 sm:gap-6 z-10">
          <a href="#learn-more" onClick={(e) => handleSmoothScroll(e, '#learn-more')} className="px-6 sm:px-8 py-3 text-white bg-gradient-to-r from-neon-blue to-green-500 hover:from-green-500 hover:to-neon-blue rounded-full text-sm sm:text-base font-medium transition-all duration-300 shadow-glow-neon uppercase">
            <MatrixHoverEffect text="Discover Now" hoverColor="#00BFFF" />
          </a>
          <Link href="/dashboard" className="px-6 sm:px-8 py-3 text-white border border-white/20 hover:bg-white/10 rounded-full text-sm sm:text-base font-medium transition-all duration-300 shadow-glow-neon uppercase">
            <MatrixHoverEffect text="App" hoverColor="#00BFFF" />
          </Link>
        </div>
      </section>

      {/* Trusted By Section */}
      <section className="py-12 px-6 sm:px-8" id="learn-more">
        <p className="text-center text-gray-300 text-xl sm:text-2xl font-bold mb-8 uppercase">Trusted by Top Crypto Innovators</p>
        <div className="w-full overflow-hidden">
          <div className="flex animate-marquee">
            {[...trustedByLogos, ...trustedByLogos].map((logo, index) => (
              <img key={`trusted-${index}`} src={logo} alt="Trusted By Logo" className="h-12 sm:h-16 mx-6 sm:mx-10 opacity-70 hover:opacity-100 hover:scale-110 transition-all duration-300 drop-shadow-glow" />
            ))}
          </div>
        </div>
      </section>

      {/* Cards Section */}
      <section ref={sectionRef} className="py-16 px-6 sm:px-8 flex flex-col items-center relative z-20">
        <h2 className="text-3xl sm:text-4xl font-bold text-white mb-12 text-center uppercase">
          <TypingEffect text="Powered by Elite AI Models" speed={100} loop={false} cursorHeight="2rem" />
        </h2>
        <div className="relative flex items-start justify-center pt-8 w-full" style={{ minHeight: '70vh' }}>
          {[card1Ref, card2Ref, card3Ref].map((ref, index) => (
            <div key={index} ref={ref} className="absolute flex justify-center w-full">
              <TiltCard className="bg-gradient-to-br from-gray-900 to-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-glow-neon flex flex-col sm:flex-row items-center sm:items-start justify-between p-6 sm:p-8 w-full max-w-5xl min-h-[40vh] space-x-6">
                <div className="flex-shrink-0 flex justify-center items-center">
                  <img src={cardData[index].image} alt={cardData[index].title} className="w-24 h-24 object-contain rounded-lg" />
                </div>
                <div className="flex-1 p-4 sm:p-6 text-center sm:text-left">
                  <h3 className="text-xl sm:text-2xl font-bold text-white mb-4">{cardData[index].title}</h3>
                  <p className="text-sm sm:text-base text-gray-300 leading-relaxed">{cardData[index].description}</p>
                </div>
              </TiltCard>
            </div>
          ))}
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 px-6 sm:px-8 flex flex-col items-center relative z-10">
        <h3 className="text-2xl sm:text-3xl font-bold text-white mb-6 text-center uppercase">Why Xynapse Analytics?</h3>
        <p className="text-sm sm:text-base text-gray-300 mb-10 text-center max-w-3xl">
          <TypingEffect text="Cutting-edge tools to navigate the volatile crypto market with confidence." speed={50} loop={false} cursorHeight="1rem" />
        </p>
        <div className="w-full max-w-6xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { img: '/logos/icon1.png', text: 'Real-Time Token Tracking' },
            { img: '/logos/icon2.png', text: 'AI-Powered Predictions' },
            { img: '/logos/icon3.png', text: 'Social Sentiment Analysis' },
            { img: '/logos/icon4.png', text: 'Top Holder Insights' },
          ].map((item, index) => (
            <motion.div
              key={index}
              className="flex flex-col items-center p-6 bg-gradient-to-br from-gray-900 to-black/80 backdrop-blur-lg border border-white/10 rounded-2xl shadow-glow-neon transition-all duration-300 hover:shadow-neon-blue"
              whileHover={{ scale: 1.05, y: -5 }}
              transition={{ type: 'spring', stiffness: 400, damping: 10 }}
            >
              <img src={item.img} alt={item.text} className="h-16 sm:h-20 mb-4" />
              <p className="text-sm sm:text-base text-white text-center">{item.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Vision Section */}
      <section ref={visionSectionRef} className="min-h-screen flex items-center justify-center relative bg-black py-16 px-6 sm:px-8">
        <div className="flex flex-col lg:flex-row items-center w-full max-w-7xl">
          <div className="lg:w-1/2 w-full">
            <img src="/images/1.png" alt="Crypto Analytics Dashboard" className="w-full h-auto max-h-[600px] object-cover rounded-2xl border border-white/10 shadow-glow-neon" />
          </div>
          <div className="lg:w-1/2 w-full lg:pl-10 mt-8 lg:mt-0">
            <h3 className="text-2xl sm:text-3xl font-bold text-white mb-6 uppercase">Our Vision</h3>
            <ul className="space-y-4">
              <li className="vision-item text-sm sm:text-base text-gray-300 flex items-start"><span className="text-neon-blue mr-2">•</span> Democratize crypto market intelligence with AI-driven insights.</li>
              <li className="vision-item text-sm sm:text-base text-gray-300 flex items-start"><span className="text-neon-blue mr-2">•</span> Empower users with real-time data on CEX/DEX and transactions.</li>
              <li className="vision-item text-sm sm:text-base text-gray-300 flex items-start"><span className="text-neon-blue mr-2">•</span> Reward community engagement through X-integrated activities.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Call-to-Action Section */}
      <section className="py-16 px-6 sm:px-8 flex flex-col items-center relative animated-gradient-background">
        <h3 className="text-2xl sm:text-3xl font-bold text-white mb-6 text-center uppercase z-10">Take Control of the Crypto Market</h3>
        <p className="text-sm sm:text-base text-gray-300 mb-10 text-center max-w-3xl z-10">
          <TypingEffect text="Join savvy traders using AI to stay ahead of market trends." speed={50} loop={false} cursorHeight="1rem" />
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 w-full max-w-6xl z-10">
          {['Instant Insights', 'AI Automation', 'Community Rewards', 'Secure Data'].map((item, index) => (
            <motion.div
              key={index}
              className="p-6 bg-gradient-to-br from-gray-900 to-black/80 backdrop-blur-lg border border-white/10 rounded-2xl shadow-glow-neon text-center transition-all duration-300 hover:shadow-neon-blue"
              whileHover={{ scale: 1.05, y: -5 }}
              transition={{ type: 'spring', stiffness: 400, damping: 10 }}
            >
              <p className="text-sm sm:text-base text-white">{item}</p>
            </motion.div>
          ))}
        </div>
        <div className="flex gap-4 sm:gap-6 mt-10 z-10">
          <Link href="/signup" className="px-6 sm:px-8 py-3 bg-gradient-to-r from-neon-blue to-green-500 text-white rounded-full text-sm sm:text-base font-medium transition-all duration-300 uppercase shadow-glow-neon hover:scale-105">
            <MatrixHoverEffect text="Sign Up" hoverColor="#00BFFF" />
          </Link>
        </div>
      </section>

      {/* Partners Section */}
      <section className="min-h-screen flex flex-col items-center justify-center relative bg-black py-16 px-6 sm:px-8">
        <p className="text-center font-bold text-gray-300 text-xl sm:text-2xl mb-12 uppercase">On-chain data on 65+ chains</p>
        <div className="relative w-full max-w-5xl overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-24 sm:w-32 bg-gradient-to-r from-black to-transparent z-10"></div>
          <div className="absolute inset-y-0 right-0 w-24 sm:w-32 bg-gradient-to-l from-black to-transparent z-10"></div>
          <div className="flex animate-marquee mb-8">
            {[...row1Logos, ...row1Logos].map((logo, index) => (
              <img key={`row1-${index}`} src={logo} alt="Partner Logo" className="h-12 sm:h-16 mx-6 sm:mx-12 opacity-70 hover:opacity-100 hover:scale-110 transition-all duration-300 drop-shadow-glow" />
            ))}
          </div>
          <div className="flex animate-reverse-marquee mb-8">
            {[...row2Logos, ...row2Logos].map((logo, index) => (
              <img key={`row2-${index}`} src={logo} alt="Partner Logo" className="h-12 sm:h-16 mx-6 sm:mx-12 opacity-70 hover:opacity-100 hover:scale-110 transition-all duration-300 drop-shadow-glow" />
            ))}
          </div>
          <div className="flex animate-marquee">
            {[...row3Logos, ...row3Logos].map((logo, index) => (
              <img key={`row3-${index}`} src={logo} alt="Partner Logo" className="h-12 sm:h-16 mx-6 sm:mx-12 opacity-70 hover:opacity-100 hover:scale-110 transition-all duration-300 drop-shadow-glow" />
            ))}
          </div>
        </div>
      </section>

      {/* Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
          onClick={closeModal}
        >
          <div
            className="bg-gradient-to-br from-gray-900 to-black/80 backdrop-blur-xl border border-white/10 rounded-2xl w-full max-w-7xl h-[90vh] relative flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 backdrop-blur-xl border-b border-white/10 p-6 flex justify-between items-center">
              <h1 className="text-2xl sm:text-3xl font-bold text-white uppercase">
                {modalContent === 'privacy'
                  ? 'Xynapse Privacy Policy'
                  : 'Xynapse Terms of Service'}
                <span className="block text-sm sm:text-base text-gray-300 mt-1">
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

      {/* Footer */}
      <footer className="py-12 px-6 sm:px-8 bg-gradient-to-t from-gray-900 to-black/80 backdrop-blur-xl border-t border-white/10 relative">
        <div className="glowing-divider"></div>
        <img
          src="/logos/logo-landscape.png"
          alt="Xynapse Logo"
          className="h-10 sm:h-14 absolute top-8 left-6 sm:left-8"
        />
        <div className="flex flex-col items-center pt-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 w-full max-w-4xl">
            {[
              { title: 'Product', links: ['Features', 'Pricing', 'Docs'] },
              { title: 'Resources', links: ['Blog', 'Support', 'Brand Kit'] },
            ].map((col, index) => (
              <div key={index} className="text-center">
                <h3 className="text-lg font-bold text-white mb-4 uppercase">{col.title}</h3>
                {col.links.map((link) => (
                  <p key={link} className="text-sm text-gray-300 mb-2">
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
          <div className="flex gap-4 sm:gap-6 mt-8">
            <Link href="https://x.com">
              <img src="/logos/x.png" alt="X" className="h-5 sm:h-6 opacity-70 hover:opacity-100 transition-all duration-300" />
            </Link>
            <span>
              <img src="/logos/discord.png" alt="Discord Logo" className="h-5 sm:h-6 opacity-70 hover:opacity-100 transition-all duration-300" />
            </span>
          </div>
          <div className="flex gap-4 sm:gap-6 mt-6">
            <button
              onClick={() => openModal('terms')}
              className="text-sm text-gray-300 transition-all duration-300"
            >
              <MatrixHoverEffect text="Terms" hoverColor="#00BFFF" />
            </button>
            <button
              onClick={() => openModal('privacy')}
              className="text-sm text-gray-300 transition-all duration-300"
            >
              <MatrixHoverEffect text="Privacy" hoverColor="#00BFFF" />
            </button>
            <Link
              href="#contact"
              className="text-sm text-gray-300 transition-all duration-300"
            >
              <MatrixHoverEffect text="Contact" hoverColor="#00BFFF" />
            </Link>
          </div>
          <p className="text-xs sm:text-sm text-gray-300 mt-6">
            Copyright © 2025 Xynapse Analytics. All rights reserved.
          </p>
        </div>
      </footer>

      <style jsx>{`
        .animate-marquee {
          display: flex;
          animation: marquee 35s linear infinite;
        }
        .animate-reverse-marquee {
          display: flex;
          animation: reverse-marquee 35s linear infinite;
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
          box-shadow: 0 0 12px rgba(0, 191, 255, 0.4), 0 0 24px rgba(0, 191, 255, 0.2);
        }
        .shadow-neon-blue:hover {
          box-shadow: 0 0 16px rgba(0, 191, 255, 0.6);
        }
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.4); }

        .prose-invert h1, .prose-invert h2, .prose-invert h3 { font-weight: 700; }
        .prose-invert h1 { font-size: 2.25rem; margin-bottom: 1.5rem; text-transform: uppercase; }
        .prose-invert h2 { font-size: 1.75rem; margin-top: 2rem; margin-bottom: 1rem; }
        .prose-invert h3 { font-size: 1.5rem; margin-top: 1.5rem; margin-bottom: 0.75rem; }
        .prose-invert p { margin-bottom: 1.25rem; line-height: 1.7; }
        .prose-invert ul { list-style-type: disc; margin-left: 1.5rem; margin-bottom: 1.25rem; }
        .prose-invert li { margin-bottom: 0.75rem; }
        .prose-invert strong { font-weight: 700; }
        .prose-invert em { font-style: italic; }
        .prose-invert table { width: 100%; border-collapse: collapse; margin-bottom: 1.25rem; }
        .prose-invert th, .prose-invert td { border: 1px solid rgba(255, 255, 255, 0.1); padding: 0.75rem; text-align: left; }
        .prose-invert th { background-color: rgba(255, 255, 255, 0.05); }

        .drop-shadow-glow {
          filter: drop-shadow(0 0 10px rgba(0, 191, 255, 0.5));
        }

        .animated-gradient-background {
          background: linear-gradient(135deg, #0a0a0a, #1a3c6b, #2a003a, #3a0855);
          background-size: 500% 500%;
          animation: gradientAnimation 12s ease infinite;
          position: relative;
        }

        @keyframes gradientAnimation {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        .floating-icon {
          position: absolute;
          opacity: 0.2;
          filter: blur(1.5px);
          animation: float 8s ease-in-out infinite;
          z-index: 0;
        }

        @keyframes float {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-25px); }
          100% { transform: translateY(0px); }
        }

        .glowing-divider {
          position: absolute;
          top: -2px;
          left: 0;
          right: 0;
          height: 4px;
          background: radial-gradient(ellipse at center, rgba(0, 191, 255, 0.5) 0%, rgba(0, 191, 255, 0) 70%);
        }
      `}</style>
    </div>
  );
}
'use client';

import { TermsOfServiceContent } from '../../components/TermsOfService';
import { useRouter } from 'next/navigation';

export default function TermsOfService() {
  const router = useRouter();

  const closeModal = () => {
    router.push('/', { scroll: false });
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={closeModal}>
      <div
        className="bg-gradient-to-br from-gray-900 to-black/80 backdrop-blur-xl border border-white/10 rounded-2xl w-full max-w-7xl h-[90vh] relative flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 backdrop-blur-xl border-b border-white/10 p-6 flex justify-between items-center">
          <h1 className="text-2xl sm:text-3xl font-bold text-white uppercase">
            Xynapse Terms of Service
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
          <TermsOfServiceContent />
        </div>
      </div>
      <style jsx>{`
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
      `}</style>
    </div>
  );
}
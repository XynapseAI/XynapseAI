'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { signIn, signOut, useSession, getProviders } from 'next-auth/react';
import Header from '../../components/Header';
import LeaderboardTab from '../../components/LeaderboardTab';
import PointTab from '../../components/PointTab';
import AITab from '../../components/AITab';
import TaskTab from '../../components/TaskTab';
import ProfileTab from '../../components/ProfileTab';
import MarketTab from '../../components/MarketTab';
import TreemapTab from '../../components/TreemapTab';
import WatchlistsTab from '../../components/WatchlistsTab';
import { motion } from 'framer-motion';
import ReCAPTCHA from 'react-google-recaptcha';
import { toast } from 'react-toastify';
import MatrixHoverEffect from '../../components/MatrixHoverEffect';
import styles from './page.module.css';
import Image from 'next/image';
import { gsap } from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';

// Register GSAP plugins
gsap.registerPlugin(MotionPathPlugin);

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

export default function Dashboard() {
  const { data: session, status, update } = useSession();
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('profile');
  const [topPlayers, setTopPlayers] = useState({ rankings: [], creators: [], aiRank: [] });
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [lastAnalysisSuccess, setLastAnalysisSuccess] = useState(false);
  const [providers, setProviders] = useState(null);
  const [email, setEmail] = useState('');
  const [csrfToken, setCsrfToken] = useState(null);
  const [isFetchingCsrf, setIsFetchingCsrf] = useState(false);
  const recaptchaRef = useRef(null);
  const starsBackgroundRef = useRef(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Fetch providers for sign-in options
  useEffect(() => {
    async function fetchProviders() {
      try {
        const response = await getProviders();
        setProviders(response);
      } catch (err) {
        console.error('Lỗi khi lấy providers:', err);
        setError('Không thể lấy danh sách phương thức đăng nhập.');
      }
    }
    fetchProviders();
  }, []);

  // Fetch CSRF token on mount when authenticated
  useEffect(() => {
    if (!isMounted || status !== 'authenticated' || session?.csrfToken || isFetchingCsrf) return;

    async function fetchCsrfToken() {
      setIsFetchingCsrf(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // Giảm timeout xuống 5 giây
        console.log('Bắt đầu lấy CSRF token...');
        const response = await fetch(`${API_BASE_URL}/api/csrf-token`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        console.log('Phản hồi từ /api/csrf-token:', response.status, response.statusText);
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Không thể lấy CSRF token');
        setCsrfToken(result.csrfToken);
        try {
          await update({ csrfToken: result.csrfToken });
          console.log('CSRF token fetched and session updated:', result.csrfToken);
        } catch (updateError) {
          console.error('Lỗi khi cập nhật session:', updateError);
          setError(`Không thể cập nhật session: ${updateError.message}. Vui lòng làm mới trang.`);
        }
      } catch (err) {
        console.error('Lỗi khi lấy CSRF token:', err);
        setError(`Không thể lấy CSRF token: ${err.message}. Vui lòng làm mới trang hoặc liên hệ hỗ trợ.`);
        setCsrfToken(null); // Đặt lại csrfToken để thử lại
      } finally {
        setIsFetchingCsrf(false);
        console.log('Hoàn tất fetchCsrfToken, isFetchingCsrf:', false);
      }
    }
    fetchCsrfToken();
  }, [isMounted, status, session, update, isFetchingCsrf]);

  // Fetch top players
  useEffect(() => {
    if (!isMounted || status !== 'authenticated' || !csrfToken) return;

    async function fetchTopPlayers() {
      setLoading(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // Giảm timeout xuống 10 giây
        console.log('Bắt đầu lấy dữ liệu leaderboard...', { csrfToken });
        const response = await fetch(`${API_BASE_URL}/api/connect-data`, {
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken || '',
          },
          credentials: 'include',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        console.log('Phản hồi từ /api/connect-data:', response.status, response.statusText);
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Không thể lấy dữ liệu leaderboard');
        console.log('Dữ liệu leaderboard nhận được:', result);
        setTopPlayers({
          rankings: result.rankings || [],
          creators: result.creators.map((player) => ({
            ...player,
            points: player.tweet_points,
            profilePicture: player.profile_picture,
            googleName: player.google_name,
          })),
          aiRank: result.aiRank.map((player) => ({
            ...player,
            points: player.ai_points,
            profilePicture: player.profile_picture,
            googleName: player.google_name,
          })),
        });
        setError(null); // Xóa lỗi nếu thành công
      } catch (err) {
        console.error('Lỗi khi lấy dữ liệu leaderboard:', err);
        setError(`Không thể lấy dữ liệu leaderboard: ${err.message}. Vui lòng thử lại sau.`);
        setTopPlayers({ rankings: [], creators: [], aiRank: [] });
      } finally {
        setLoading(false);
        console.log('Hoàn tất fetchTopPlayers, loading:', false);
      }
    }
    fetchTopPlayers();
  }, [isMounted, status, csrfToken]);

  // Fetch user data
  useEffect(() => {
    if (!isMounted || !session?.user?.id || !csrfToken) return;

    async function initUserData() {
      setLoading(true);
      try {
        if (!recaptchaRef.current) throw new Error('reCAPTCHA chưa được khởi tạo');
        let recaptchaToken = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await recaptchaRef.current.reset();
            recaptchaToken = await Promise.race([
              recaptchaRef.current.executeAsync(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('reCAPTCHA hết thời gian')), 5000)),
            ]);
            if (recaptchaToken) break;
          } catch (err) {
            console.error('Lỗi khi tạo reCAPTCHA token (lần thử', attempt, '):', err);
            if (attempt === 3) throw new Error('Không thể tạo reCAPTCHA token sau 3 lần thử');
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
        if (!recaptchaToken) throw new Error('Không thể tạo reCAPTCHA token');

        // Retry logic cho yêu cầu /api/user
        let response;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // Giảm timeout xuống 5 giây
            console.log('Bắt đầu lấy dữ liệu user (lần thử', attempt, ')...', { uid: session.user.id, csrfToken });
            response = await fetch(`${API_BASE_URL}/api/user?uid=${encodeURIComponent(session.user.id)}`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                'X-Recaptcha-Token': recaptchaToken,
                'X-CSRF-Token': csrfToken || '',
              },
              credentials: 'include',
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            console.log('Phản hồi từ /api/user:', response.status, response.statusText);
            if (response.ok) break;
            if (response.status === 403 && attempt < 3) {
              console.log('CSRF không hợp lệ, thử lại với CSRF token mới...');
              await fetchCsrfToken(); // Thử lấy CSRF token mới
            } else {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
          } catch (err) {
            console.error('Lỗi khi lấy dữ liệu user (lần thử', attempt, '):', err);
            if (attempt === 3) throw err;
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }

        const result = await response.json();
        if (!response.ok) {
          if (result.detail?.includes('User not found')) {
            throw new Error('HTTP 404: Không tìm thấy người dùng');
          }
          throw new Error(
            `${result.detail || 'Lỗi không xác định'}${result.errors ? `: ${result.errors.map((e) => e.msg).join(', ')}` : ''} (HTTP ${response.status})`
          );
        }
        console.log('Dữ liệu user nhận được:', result);
        setUserData({
          ...result.user,
          profilePicture: result.user.profile_picture,
          googleName: result.user.google_name,
          tweetPoints: result.user.tweet_points,
          aiPoints: result.user.ai_points,
        });
        setError(null);
        toast.success('Tải dữ liệu người dùng thành công!', { position: 'top-center' });
      } catch (err) {
        console.error('Lỗi khi lấy dữ liệu người dùng:', err);
        if (err.message.includes('HTTP 404')) {
          setError('Không tìm thấy người dùng. Vui lòng đăng nhập lại.');
          await signOut({ redirect: false });
          router.push('/auth/signin');
        } else {
          setUserData(null);
          setError(`Không thể lấy dữ liệu người dùng: ${err.message}. Vui lòng làm mới trang hoặc liên hệ hỗ trợ.`);
          toast.error(`Lỗi: ${err.message}`, { position: 'top-center' });
        }
      } finally {
        setLoading(false);
        console.log('Hoàn tất initUserData, loading:', false);
      }
    }
    initUserData();
  }, [isMounted, session, router, csrfToken]);

  const handleConnectWallet = async () => {
    try {
      if (!session?.user) throw new Error('Chưa đăng nhập');
      if (!isConnected || !address) throw new Error('Ví chưa được kết nối');
      if (!recaptchaRef.current) throw new Error('reCAPTCHA chưa sẵn sàng');
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      const message = `Ký tin nhắn này để xác thực: ${address}`;
      const signature = await signMessageAsync({ message });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${API_BASE_URL}/api/verify-wallet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
          'X-CSRF-Token': csrfToken || '',
        },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          walletAddress: address,
          signature,
          message,
          uid: session.user.id,
        }),
      });
      clearTimeout(timeoutId);
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Xác minh ví thất bại');
      setError(null);
      setUserData((prev) => ({
        ...prev,
        walletAddress: address,
      }));
      toast.success('Kết nối ví thành công!', { position: 'top-center' });
    } catch (err) {
      console.error('Lỗi xác minh ví:', err);
      setError(`Lỗi xác minh ví: ${err.message}`);
      toast.error(`Lỗi xác minh ví: ${err.message}`, { position: 'top-center' });
    } finally {
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut({ callbackUrl: '/' });
      if (isConnected) disconnect();
      setUserData(null);
      setError(null);
      toast.success('Đăng xuất thành công!', { position: 'top-center' });
    } catch (error) {
      console.error('Lỗi đăng xuất:', error);
      setError('Không thể đăng xuất.');
      toast.error('Không thể đăng xuất.', { position: 'top-center' });
    }
  };

  const handleAnalyzeTweets = async () => {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      if (!session?.user) throw new Error('Chưa đăng nhập');
      if (!recaptchaRef.current) throw new Error('reCAPTCHA chưa sẵn sàng');
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      console.log('Bắt đầu phân tích tweet...', { uid: session.user.id });
      const response = await fetch(`${API_BASE_URL}/api/analyze-tweets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
          'X-CSRF-Token': csrfToken || '',
        },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({ uid: session.user.id }),
      });
      clearTimeout(timeoutId);
      console.log('Phản hồi từ /api/analyze-tweets:', response.status, response.statusText);
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Phân tích tweet thất bại');
      setUserData((prev) => (prev ? { ...prev, points: result.points, tweet_points: result.tweet_points } : null));
      setError(null);
      setLastAnalysisSuccess(true);
      toast.success('Phân tích tweet thành công!', { position: 'top-center' });
    } catch (error) {
      console.error('Lỗi phân tích tweet:', error);
      setError(`Lỗi phân tích tweet: ${error.message}`);
      setLastAnalysisSuccess(false);
      toast.error(`Lỗi phân tích tweet: ${error.message}`, { position: 'top-center' });
    } finally {
      setIsAnalyzing(false);
      if (recaptchaRef.current) recaptchaRef.current.reset();
      console.log('Hoàn tất handleAnalyzeTweets, isAnalyzing:', false);
    }
  };

  const handleNavigateToToken = (slug) => {
    if (!slug || typeof slug !== 'string' || slug.trim() === '') {
      console.error('Slug không hợp lệ:', { slug });
      toast.error('Không thể chuyển đến trang token: ID token không hợp lệ.', { position: 'top-center', autoClose: 3000 });
      return;
    }
    router.push(`/token/${slug}`, undefined, { shallow: true });
    setActiveTab('market');
  };

  const handleEmailSignIn = async (e) => {
    e.preventDefault();
    try {
      await signIn('email', { email, callbackUrl: '/dashboard' });
      toast.success('Đã gửi email đăng nhập, vui lòng kiểm tra hộp thư!', { position: 'top-center' });
    } catch {
      setError('Không thể đăng nhập bằng email. Vui lòng thử lại.');
      toast.error('Không thể đăng nhập bằng email.', { position: 'top-center' });
    }
  };

  if (!isMounted || !providers) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
        <p>Đang tải...</p>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className={`h-screen w-screen flex items-center justify-center bg-black text-white overflow-hidden font-jetbrains relative ${styles.container}`}
      >
        <motion.div
          ref={starsBackgroundRef}
          className={`absolute inset-0 bg-gradient-to-br from-gray-900 via-black to-gray-800 ${styles['stars-background']}`}
          animate={{
            background: [
              'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(17, 24, 39, 0.9))',
              'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(0, 191, 255, 0.1))',
              'linear-gradient(135deg, rgba(17, 24, 39, 0.9), rgba(0, 0, 0, 1), rgba(17, 24, 39, 0.9))',
            ],
          }}
          transition={{ duration: 15, repeat: Infinity, repeatType: 'reverse' }}
        >
          <div className={styles['stars-layer-1']} />
          <div className={styles['stars-layer-2']} />
          <div className={styles['stars-layer-3']} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className={`absolute top-2 left-2 z-20 ${styles['logo-container']}`}
        >
          <Image
            src="/logos/logo-landscape.png"
            alt="Xynapse Logo"
            width={120}
            height={56}
            className="h-10 sm:h-12 w-auto object-contain"
            priority
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className={`relative z-10 bg-gray-900/30 backdrop-blur-lg p-6 md:p-10 rounded-2xl border border-white/10 ${styles['shadow-glow-neon']} max-w-md w-full mx-4 flex flex-col items-center`}
        >
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-2xl md:text-3xl font-bold text-white uppercase mb-2 text-center"
          >
            Đăng Nhập
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-xs md:text-xs text-gray-400 mb-8 text-center"
          >
            Đăng nhập bằng Google hoặc Email để truy cập dashboard của bạn.
          </motion.p>
          <form onSubmit={handleEmailSignIn} className="w-full space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Nhập email của bạn"
              className={`w-full px-4 py-3 bg-gray-800/50 border border-white/10 rounded-full text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-neon-blue ${styles['input-glow']}`}
              required
            />
            <button
              type="submit"
              className={`w-full px-4 py-3 bg-neon-blue text-black rounded-full text-sm font-medium uppercase transition-all duration-300 hover:bg-neon-blue/80 ${styles['button-glow']}`}
            >
              <MatrixHoverEffect text="Đăng nhập bằng Email" hoverColor="#FFFFFF" />
            </button>
          </form>
          <div className="flex items-center justify-center my-4 w-full">
            <span className="text-gray-500 text-sm uppercase">HOẶC</span>
          </div>
          {providers?.google && (
            <button
              onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
              className={`w-full px-4 py-3 bg-gray-800/50 border border-white/20 rounded-full text-white text-sm font-medium uppercase flex items-center justify-center gap-2 transition-all duration-300 hover:bg-gray-700/50 ${styles['button-glow']}`}
            >
              <Image
                src="/logos/google.png"
                alt="Google Logo"
                width={20}
                height={20}
                className="w-5 h-5 object-contain mr-2"
              />
              <MatrixHoverEffect text="Đăng nhập bằng Google" hoverColor="#00BFFF" />
            </button>
          )}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className={`mt-6 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center ${styles['shadow-glow-neon-red']}`}
            >
              Lỗi: {error}
            </motion.div>
          )}
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="absolute bottom-2 left-2 text-[8px] text-gray-600 z-10"
        >
          Được bảo vệ bởi reCAPTCHA. Xem{' '}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neon-blue hover:underline"
          >
            Chính sách bảo mật
          </a>{' '}
          &{' '}
          <a
            href="https://policies.google.com/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neon-blue hover:underline"
          >
            Điều khoản
          </a>{' '}
          của Google.
        </motion.p>
      </motion.div>
    );
  }

  return (
    <div className="h-screen w-screen bg-black text-white overflow-x-hidden flex flex-col">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} handleSignOut={handleSignOut} />
      <main className="flex-1 flex items-center justify-center overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full h-full flex items-center justify-center"
        >
          {activeTab === 'market' && <MarketTab recaptchaRef={recaptchaRef} onTokenSelect={handleNavigateToToken} />}
          {activeTab === 'ai' && <AITab recaptchaRef={recaptchaRef} />}
          {activeTab === 'leaderboard' && (
            <LeaderboardTab
              topPlayers={topPlayers}
              loading={loading}
              error={error}
              recaptchaRef={recaptchaRef}
            />
          )}
          {activeTab === 'point' && (
            <PointTab
              userData={userData}
              loading={loading}
              error={error}
              handleAnalyzeTweets={handleAnalyzeTweets}
              isAnalyzing={isAnalyzing}
              recaptchaRef={recaptchaRef}
            />
          )}
          {activeTab === 'task' && <TaskTab recaptchaRef={recaptchaRef} />}
          {activeTab === 'profile' && (
            <ProfileTab
              userData={userData}
              loading={loading}
              error={error}
              isConnected={isConnected}
              handleConnectWallet={handleConnectWallet}
              recaptchaRef={recaptchaRef}
            />
          )}
          {activeTab === 'treemap' && <TreemapTab onTokenSelect={handleNavigateToToken} />}
          {activeTab === 'watchlists' && <WatchlistsTab toast={toast} />}
        </motion.div>
      </main>
      <ReCAPTCHA
        ref={recaptchaRef}
        sitekey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
        size="invisible"
        badge="bottomright"
      />
      <p className="text-[8px] text-gray-600 ml-2">
        Được bảo vệ bởi reCAPTCHA. Xem{' '}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-neon-blue">
          Chính sách bảo mật
        </a>{' '}
        &{' '}
        <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="text-neon-blue">
          Điều khoản
        </a>{' '}
        của Google.
      </p>
    </div>
  );
}
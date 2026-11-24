import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Menu, X, Leaf, Wallet } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const location = useLocation();
  const { connected, publicKey, connect, disconnect, select, wallets, wallet } = useWallet();
  const { user, login, logout } = useAuth();
  const connectInFlight = useRef(false);

  useEffect(() => {
    setIsMenuOpen(false);
    setIsWalletMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (connected && publicKey && !user) {
      login(publicKey.toString()).catch((error) => {
        console.error('Login failed:', error);
      });
    }
  }, [connected, publicKey, user, login]);

  const handleWalletConnect = async (walletName: string) => {
    if (connectInFlight.current) return;
    connectInFlight.current = true;
    setIsConnecting(true);
    setIsWalletMenuOpen(false);

    try {
      const selectedWallet = wallets.find((w) => w.adapter.name === walletName);
      if (!selectedWallet) return;

      if (wallet?.adapter.name !== walletName) {
        select(selectedWallet.adapter.name);
      }

      await connect();
    } catch (error) {
      console.error('Wallet connection failed:', error);
    } finally {
      connectInFlight.current = false;
      setIsConnecting(false);
    }
  };

  const handleWalletDisconnect = async () => {
    try {
      await disconnect();
      logout();
    } catch (error) {
      console.error('Wallet disconnect failed:', error);
    }
    setIsWalletMenuOpen(false);
  };

  const toggleWalletMenu = () => {
    if (isConnecting) return;
    setIsWalletMenuOpen((prev) => !prev);
  };

  const navLinks = [
    { path: '/', label: 'Home' },
    { path: '/marketplace', label: 'Marketplace' },
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/about', label: 'About' },
  ];

  return (
    <header className="bg-white shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link to="/" className="flex items-center space-x-2">
            <Leaf className="h-8 w-8 text-green-600" />
            <span className="text-xl font-bold text-gray-900">AgroChain</span>
          </Link>

          <nav className="hidden md:flex items-center space-x-8">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`text-sm font-medium transition-colors ${
                  location.pathname === link.path
                    ? 'text-green-600'
                    : 'text-gray-700 hover:text-green-600'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="hidden md:flex items-center space-x-4">
            {connected ? (
              <div className="relative">
                <button
                  onClick={toggleWalletMenu}
                  className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Wallet className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {publicKey?.toString().slice(0, 4)}...{publicKey?.toString().slice(-4)}
                  </span>
                </button>
                {isWalletMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg py-1">
                    <Link
                      to="/dashboard"
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Dashboard
                    </Link>
                    <button
                      onClick={handleWalletDisconnect}
                      className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative">
                <button
                  onClick={toggleWalletMenu}
                  disabled={isConnecting}
                  className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Wallet className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {isConnecting ? 'Connecting...' : 'Connect Wallet'}
                  </span>
                </button>
                {isWalletMenuOpen && !isConnecting && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg py-1">
                    {wallets.map((w) => (
                      <button
                        key={w.adapter.name}
                        onClick={() => handleWalletConnect(w.adapter.name)}
                        className="flex items-center space-x-2 w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        {w.adapter.icon && (
                          <img src={w.adapter.icon} alt={w.adapter.name} className="h-5 w-5" />
                        )}
                        <span>{w.adapter.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => setIsMenuOpen((prev) => !prev)}
            className="md:hidden p-2 rounded-lg text-gray-700 hover:bg-gray-100"
            aria-label="Toggle menu"
          >
            {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {isMenuOpen && (
        <div className="md:hidden border-t border-gray-200 bg-white">
          <div className="px-4 py-4 space-y-2">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                  location.pathname === link.path
                    ? 'bg-green-50 text-green-600'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-2 border-t border-gray-200">
              {connected ? (
                <div className="space-y-2">
                  <div className="px-3 py-2 text-sm text-gray-700">
                    {publicKey?.toString().slice(0, 4)}...{publicKey?.toString().slice(-4)}
                  </div>
                  <button
                    onClick={handleWalletDisconnect}
                    className="block w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-gray-100"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                    {isConnecting ? 'Connecting...' : 'Connect Wallet'}
                  </div>
                  {!isConnecting &&
                    wallets.map((w) => (
                      <button
                        key={w.adapter.name}
                        onClick={() => handleWalletConnect(w.adapter.name)}
                        className="flex items-center space-x-2 w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100"
                      >
                        {w.adapter.icon && (
                          <img src={w.adapter.icon} alt={w.adapter.name} className="h-5 w-5" />
                        )}
                        <span>{w.adapter.name}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;


import React, { useState } from 'react';
import { LayoutGrid, Loader2, Lock, User, Cloud, Database } from 'lucide-react';
import { db } from '../utils/db';

interface Props {
  onLoginSuccess: () => void;
}

export const LoginScreen: React.FC<Props> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('mihail');
  const [password, setPassword] = useState('250364');
  
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const isDbConfigured = db.isConfigured();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isDbConfigured) {
      setError('Ошибка: База данных недоступна. Попробуйте обновить страницу.');
      return;
    }

    setIsLoading(true);

    try {
      const success = await db.login(username, password, rememberMe);
      if (success) {
        onLoginSuccess();
      } else {
        setError('Неверный логин или пароль');
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка соединения');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        
        {/* Header */}
        <div className="bg-slate-900 p-8 text-center relative overflow-hidden">
          <div className="relative z-10">
            <div className="inline-flex items-center justify-center p-3 bg-indigo-600 rounded-xl mb-4 shadow-lg shadow-indigo-900/50">
              <LayoutGrid className="text-white w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-wide">3D FARM CRM</h1>
            <p className="text-slate-400 text-sm mt-2">Система управления фермой</p>
          </div>
          
          {/* Status Badge */}
          <div className="absolute top-4 right-4 z-20">
             {isDbConfigured ? (
               <span className="flex items-center gap-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-1 rounded-lg text-xs font-bold backdrop-blur-sm">
                  <Cloud size={12} /> Подключено
               </span>
             ) : (
               <span className="flex items-center gap-1.5 bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-1 rounded-lg text-xs font-bold backdrop-blur-sm">
                  <Database size={12} /> Ошибка
               </span>
             )}
          </div>
        </div>

        {/* Login Form */}
        <div className="p-8 pt-6">
          <form onSubmit={handleLogin} className="space-y-5">
            
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">Пользователь</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white text-slate-900 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-all font-medium"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">Пароль</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white text-slate-900 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-all font-medium"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer group select-none">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                  />
                  <span className="text-sm font-medium text-slate-600 group-hover:text-indigo-600 transition-colors">Запомнить меня</span>
                </label>
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 text-sm font-bold px-4 py-3 rounded-xl border border-red-100 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-xl transition-all active:scale-[0.98] shadow-lg flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed mt-2"
            >
              {isLoading ? <Loader2 className="animate-spin" /> : 'Войти в систему'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

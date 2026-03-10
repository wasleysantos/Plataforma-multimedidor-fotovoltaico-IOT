import { useEffect, useState, type FormEvent } from "react";
import { Mail, Lock, ShieldCheck } from "lucide-react";
import logoImage from "figma:asset/86a5dbd476eaf5850e2d574675b5ba3853e32186.png";
import solarBg from "../assets/solar.png";

interface LoginProps {
  onLogin: (
    email: string,
    password: string,
  ) => Promise<string | null> | string | null | void;

  onGoogleLogin: () => Promise<string | null> | string | null | void;

  // ✅ (opcional) se você não quer signup na tela, pode nem passar
  onNavigateToSignup?: () => void;

  // ✅ novo
  onNavigateToForgotPassword?: () => void;
}

export function Login({
  onLogin,
  onGoogleLogin,
  onNavigateToSignup,
  onNavigateToForgotPassword,
}: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [errorMessage, setErrorMessage] = useState("");

  // ✅ loading separado
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);

  // ✅ animação suave
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 60);
    return () => window.clearTimeout(t);
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    if (!email || !password) return;

    try {
      setLoadingLogin(true);
      const result = await onLogin(email, password);

      if (typeof result === "string" && result.trim().length > 0) {
        setErrorMessage(result);
      }
    } catch {
      setErrorMessage("Não foi possível entrar agora. Tente novamente.");
    } finally {
      setLoadingLogin(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMessage("");

    try {
      setLoadingGoogle(true);

      // ✅ garante render do "Carregando..." antes do redirect do OAuth
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );

      const result = await onGoogleLogin();

      // se retornar string, é erro (sem redirect)
      if (typeof result === "string" && result.trim().length > 0) {
        setErrorMessage(result);
        setLoadingGoogle(false);
      }
    } catch {
      setErrorMessage(
        "Não foi possível entrar com Google agora. Tente novamente.",
      );
      setLoadingGoogle(false);
    }
  };

  const topAnim = mounted
    ? "opacity-100 translate-y-0"
    : "opacity-0 -translate-y-2";

  const cardAnim = mounted
    ? "opacity-100 translate-y-0"
    : "opacity-0 translate-y-3";

  const busy = loadingLogin || loadingGoogle;

  return (
    <div className="relative w-full min-h-screen flex items-center justify-center overflow-hidden">
      {/* BACKGROUND FIXO */}
      <div
        className="fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${solarBg})` }}
      />

      {/* Gradiente */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-[#0a1628]/90 via-[#0a1628]/80 to-[#071224]/95 pointer-events-none" />

      {/* Vinheta */}
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_center,transparent_40%,rgba(0,0,0,0.7)_100%)] pointer-events-none" />

      {/* Conteúdo */}
      <div className="w-full max-w-md px-4 sm:px-6 relative z-10">
        {/* ✅ Logo + Badge com fade suave */}
        <div
          className={[
            "flex flex-col items-center justify-center mb-6 sm:mb-8",
            "transition-all duration-700 ease-out",
            topAnim,
          ].join(" ")}
        >
          <img
            src={logoImage}
            alt="Logo"
            className="h-9 sm:h-16 mb-2 sm:mb-4 object-contain"
          />
          <div className="flex items-center gap-1.5 bg-blue-500/10 px-2.5 py-0.5 rounded-full border border-blue-500/20">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-blue-400 text-[9px] font-semibold uppercase tracking-wide">
              Acesso Administrativo
            </span>
          </div>
        </div>

        {/* ✅ Card com fade + slide */}
        <div
          className={[
            "bg-[#1a2942] rounded-2xl p-6 sm:p-8 shadow-2xl border border-white/10",
            "transition-all duration-700 ease-out delay-75",
            cardAnim,
          ].join(" ")}
        >
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-1 sm:mb-2">
            Painel de Gestão
          </h2>
          <p className="text-gray-400 mb-6 sm:mb-8 text-sm sm:text-base">
            Entre para monitorar os dispositivos solares
          </p>

          {errorMessage && (
            <div className="mb-5 sm:mb-6 rounded-lg border-2 border-red-900 bg-red-600 px-4 py-3 shadow-lg shadow-red-900/40">
              <p className="text-sm font-bold text-black text-center">
                {errorMessage}
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-2">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                E-mail Corporativo
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrorMessage("");
                  }}
                  className="w-full bg-[#0a1628] text-white pl-12 pr-4 py-3 rounded-lg border border-gray-700 focus:border-green-500 focus:outline-none transition-colors"
                  placeholder="admin@teslalab.com"
                  required
                  disabled={busy}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrorMessage("");
                  }}
                  className="w-full bg-[#0a1628] text-white pl-12 pr-4 py-3 rounded-lg border border-gray-700 focus:border-green-500 focus:outline-none transition-colors"
                  placeholder="••••••••"
                  required
                  disabled={busy}
                />
              </div>
            </div>

            {/* ✅ Só o "Esqueceu a senha?" */}
            <div className="text-right pt-1">
              <button
                type="button"
                onClick={() => onNavigateToForgotPassword?.()}
                className="text-sm text-green-400 hover:text-green-300 transition-colors disabled:opacity-70"
                disabled={busy || !onNavigateToForgotPassword}
                style={{
                  cursor:
                    busy || !onNavigateToForgotPassword
                      ? "not-allowed"
                      : "pointer",
                }}
                title={
                  onNavigateToForgotPassword
                    ? "Recuperar senha"
                    : "Navegação não configurada"
                }
              >
                Esqueceu a senha?
              </button>
            </div>

            {/* ✅ Botão Entrar */}
            <button
              type="submit"
              disabled={busy}
              className={[
                "relative w-full py-3 rounded-lg font-semibold text-white transition-all",
                "bg-green-500 hover:bg-green-600",
                "disabled:opacity-70",
                "hover:shadow-lg hover:shadow-green-500/20",
                "focus:outline-none focus:ring-2 focus:ring-green-400/40 focus:ring-offset-0",
              ].join(" ")}
              style={{ cursor: busy ? "not-allowed" : "pointer" }}
            >
              <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
                <span className="tsBtnGlow absolute -inset-x-24 top-0 h-full w-24 rotate-12 bg-white/20 blur-md" />
              </span>

              <span className="relative z-10">
                {loadingLogin ? "Entrando..." : "Entrar"}
              </span>
            </button>

            <div className="flex items-center gap-3 pt-1">
              <div className="h-px bg-gray-700 flex-1" />
              <span className="text-gray-500 text-xs sm:text-sm">
                AUTENTIÇÃO SSO
              </span>
              <div className="h-px bg-gray-700 flex-1" />
            </div>

            {/* ✅ Botão Google */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={busy}
              style={{
                backgroundColor: "#ffffff",
                color: "#111827",
                cursor: busy ? "not-allowed" : "pointer",
              }}
              className="w-full border border-gray-100 hover:bg-gray-100 text-gray-900 font-medium py-3 rounded-lg transition flex items-center justify-center gap-3 shadow-sm disabled:opacity-70"
            >
              <svg
                className="pointer-events-none"
                width="18"
                height="18"
                viewBox="0 0 48 48"
                aria-hidden="true"
              >
                <path
                  fill="#FFC107"
                  d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.2 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.1-.1-2.2-.4-3.5z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.3 14.7l6.6 4.8C14.7 15.4 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.2 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.1 0 9.9-1.9 13.5-5.1l-6.2-5.2C29.4 35.3 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.4 39.6 16.1 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.5H42V20H24v8h11.3c-1.0 2.9-3.1 5.2-5.9 6.6l6.2 5.2C39.2 36.4 44 31.0 44 24c0-1.1-.1-2.2-.4-3.5z"
                />
              </svg>

              {loadingGoogle ? "Carregando..." : "Entrar com Google"}
            </button>
          </form>

          {/* ✅ Mantive o texto final igual o seu */}
        </div>
      </div>

      <style>{`
        .tsBtnGlow {
          animation: tsBtnGlow 2.8s ease-in-out infinite;
          opacity: 0.35;
        }
        @keyframes tsBtnGlow {
          0% { transform: translateX(-260px) rotate(12deg); opacity: 0; }
          25% { opacity: 0.35; }
          55% { transform: translateX(520px) rotate(12deg); opacity: 0.35; }
          100% { transform: translateX(520px) rotate(12deg); opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .tsBtnGlow { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

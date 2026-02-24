import { ShieldCheck } from "lucide-react";
import { User, Github, ChevronRight, UserPlus } from "lucide-react";

interface SettingsPageProps {
  user: { name: string; email: string };

  // ✅ navegação sem router
  onNavigate?: (page: "settings" | "customer_register" | "dashboard") => void;
}

export function SettingsPage({ user, onNavigate }: SettingsPageProps) {
  const githubRepoUrl = "https://github.com/wasleysantos/Tesla-Solar";
  const whatsappUrl = "https://wa.me/5598988020311";
  const appVersion = "";

  return (
    <div className="space-y-6 pb-24 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white leading-tight">
            Configurações
          </h2>
          <p className="text-gray-400 text-sm">
            Gerencie sua base de clientes.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-gray-400">
          <span className="px-2 py-1 rounded-lg bg-[#0a1628] border border-gray-800">
            {appVersion}
          </span>
        </div>
      </div>

      {/* Perfil */}
      <div className="bg-[#1a2942] rounded-2xl p-4 border border-gray-800">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg">
            {user.name.charAt(0).toUpperCase()}
          </div>

          <div className="min-w-0">
            <h3 className="text-white font-semibold text-lg truncate">
              {user.name}
            </h3>
            <p className="text-gray-400 text-sm truncate">{user.email}</p>
          </div>
        </div>

        <div className="mt-1">..</div>

        <div
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl
          bg-gradient-to-r from-green-400 to-blue-500
          text-[#0a1628] font-bold shadow-lg shadow-green-500/20"
        >
          <ShieldCheck className="w-5 h-5" />
          <span className="text-sm">Administrador do Sistema</span>
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cadastro */}
        <div className="bg-[#1a2942] rounded-2xl border border-green-500/20 overflow-hidden">
          <div className="p-6 border-b border-gray-800/60">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-green-400" />
              Cadastro de Cliente
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              Abra a tela dedicada para cadastrar ou atualizar clientes.
            </p>
          </div>

          <div className="p-4 sm:p-6">
            <button
              type="button"
              onClick={() => onNavigate?.("customer_register")}
              className="w-full bg-green-500 text-[#0a1628] font-bold px-4 py-3 text-sm rounded-2xl hover:bg-green-400 transition-all shadow-lg shadow-green-500/10 flex items-center justify-center gap-2"
            >
              <UserPlus className="w-4 h-4" />
              CADASTRAR CLIENTE
            </button>
          </div>
        </div>
      </div>

      {/* Options */}
      <div className="bg-[#1a2942] rounded-2xl p-4 border border-gray-800">
        <button className="w-full flex items-center justify-between p-4 hover:bg-[#0a1628] rounded-xl transition-colors">
          <div className="flex items-center gap-3">
            <User className="w-5 h-5 text-green-400" />
            <span className="text-white">Informações da Conta</span>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-400" />
        </button>

        <a
          href={githubRepoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-between p-4 hover:bg-[#0a1628] rounded-xl transition-colors"
        >
          <div className="flex items-center gap-3">
            <Github className="w-5 h-5 text-white" />
            <span className="text-white">Sobre a Plataforma</span>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-400" />
        </a>

        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-between p-4 hover:bg-[#0a1628] rounded-xl transition-colors"
        >
          <div className="flex items-center gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 32 32"
              className="w-5 h-5"
            >
              <path
                fill="#17e663"
                d="M16 3C9.4 3 4 8.1 4 14.4c0 2.5.9 4.9 2.6 6.8L5 29l7.9-1.6c1.9 1 4.1 1.5 6.3 1.5 6.6 0 12-5.1 12-11.4C31 8.1 22.6 3 16 3z"
              />
              <path
                fill="#fff"
                d="M23.1 18.6c-.3-.2-1.8-.9-2.1-1s-.5-.2-.7.2-.8 1-.9 1.2-.4.2-.7 0-1.3-.5-2.5-1.6c-.9-.8-1.6-1.9-1.8-2.2-.2-.3 0-.5.2-.6.2-.2.3-.4.5-.5.2-.2.2-.3.3-.5.1-.2 0-.4 0-.5s-.7-1.7-1-2.3c-.3-.6-.6-.5-.8-.5h-.7c-.2 0-.5.1-.7.3s-1 1-1 2.4 1 2.8 1.1 3c.2.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4 0-.1-.3-.2-.6-.4z"
              />
            </svg>

            <div className="flex flex-col">
              <span className="text-white">Ajuda e Suporte</span>
              <span className="text-xs text-gray-400"></span>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-400" />
        </a>
      </div>

      {/* System Info */}
      <div className="bg-[#1a2942] rounded-2xl p-6 border border-gray-800">
        <h3 className="text-white font-semibold mb-4">
          Informações do Sistema
        </h3>

        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-400">Versão do App</span>
            <span className="text-white font-semibold">2.0</span>
          </div>

          <div className="flex justify-between">
            <span className="text-gray-400">Status</span>
            <span className="text-green-400 font-semibold">Online</span>
          </div>

          <div className="flex justify-between">
            <span className="text-gray-400">Banco de dados</span>
            <span className="text-white font-semibold">Supabase</span>
          </div>
        </div>
      </div>
    </div>
  );
}

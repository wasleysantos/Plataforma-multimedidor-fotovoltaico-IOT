import { useState } from "react";
import { supabase } from "../lib/supabase";
import { ArrowLeft, UserPlus, CheckCircle, AlertCircle } from "lucide-react";

interface CustomerRegisterPageProps {
  onBack?: () => void;
}

function onlyDigits(v: string) {
  return (v || "").replace(/\D/g, "");
}

function formatCpf(v: string) {
  const d = onlyDigits(v).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);

  let out = p1;
  if (p2) out += `.${p2}`;
  if (p3) out += `.${p3}`;
  if (p4) out += `-${p4}`;
  return out;
}

function formatCep(v: string) {
  const digits = (v || "").replace(/\D/g, "").slice(0, 8);
  const part1 = digits.slice(0, 5);
  const part2 = digits.slice(5, 8);
  return part2 ? `${part1}-${part2}` : part1;
}

function formatWhatsappBR(v: string) {
  let d = onlyDigits(v);
  if (d.startsWith("55")) d = d.slice(2);

  d = d.slice(0, 11);
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);

  if (!ddd) return "";

  const isCell = d.length >= 11;
  const p1 = isCell ? rest.slice(0, 5) : rest.slice(0, 4);
  const p2 = isCell ? rest.slice(5, 9) : rest.slice(4, 8);

  if (!rest) return `(${ddd}`;
  if (!p1) return `(${ddd})`;
  if (!p2) return `(${ddd}) ${p1}`;
  return `(${ddd}) ${p1}-${p2}`;
}

function whatsappToE164BR(input: string) {
  let d = onlyDigits(input);
  if (d.startsWith("55")) d = d.slice(2);
  if (!(d.length === 10 || d.length === 11)) return null;
  return `+55${d}`;
}

function isValidCPF(cpf: string) {
  const clean = onlyDigits(cpf);
  if (clean.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(clean)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(clean[i]) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== Number(clean[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(clean[i]) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  if (d2 !== Number(clean[10])) return false;

  return true;
}

export function CustomerRegisterPage({ onBack }: CustomerRegisterPageProps) {
  const [newName, setNewName] = useState("");
  const [newCpf, setNewCpf] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newWhatsapp, setNewWhatsapp] = useState("");
  const [newDeviceGeracao, setNewDeviceGeracao] = useState("");
  const [newDeviceConsumo, setNewDeviceConsumo] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newZip, setNewZip] = useState("");
  const [newState, setNewState] = useState("");
  const [newCity, setNewCity] = useState("");

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);

  const resetForm = () => {
    setNewName("");
    setNewCpf("");
    setNewEmail("");
    setNewWhatsapp("");
    setNewDeviceGeracao("");
    setNewDeviceConsumo("");
    setNewAddress("");
    setNewZip("");
    setNewState("");
    setNewCity("");
  };

  const fetchAddressByCep = async (zipRaw: string) => {
    const zip = (zipRaw || "").replace(/\D/g, "");
    if (zip.length !== 8) return;

    try {
      const res = await fetch(`https://viacep.com.br/ws/${zip}/json/`);
      const data = await res.json();

      if (!data?.erro) {
        const logradouro = data.logradouro || "";
        const bairro = data.bairro || "";

        setNewCity(data.localidade || "");
        setNewState((data.uf || "").toUpperCase());

        const suggestedAddress = [logradouro, bairro]
          .filter(Boolean)
          .join(" - ");

        if (!newAddress.trim() && suggestedAddress) {
          setNewAddress(suggestedAddress);
        }
      }
    } catch (err) {
      console.error("Erro ao buscar CEP:", err);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setLoading(true);

    try {
      const cpfDigits = onlyDigits(newCpf);

      if (!isValidCPF(cpfDigits)) {
        setStatus({
          type: "error",
          msg: "CPF inválido. Verifique os dígitos.",
        });
        return;
      }

      const whatsappE164 = newWhatsapp.trim()
        ? whatsappToE164BR(newWhatsapp)
        : null;

      if (newWhatsapp.trim() && !whatsappE164) {
        setStatus({
          type: "error",
          msg: "WhatsApp inválido. Use DDD + número.",
        });
        return;
      }

      const deviceGeracaoClean = (newDeviceGeracao || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");

      const deviceConsumoClean = (newDeviceConsumo || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");

      const clientePayload = {
        name: newName.trim(),
        cpf: cpfDigits,
        email: newEmail.trim() || null,
        whatsapp: whatsappE164,
        device_geracao: deviceGeracaoClean || null,
        device_consumo: deviceConsumoClean || null,
        address: newAddress.trim() || null,
        zip_code: newZip.trim() || null,
        state: newState.trim().toUpperCase() || null,
        city: newCity.trim() || null,
      };

      const { data: clienteExistente, error: clienteSelectError } =
        await supabase
          .from("clientes")
          .select("id, cpf")
          .eq("cpf", cpfDigits)
          .maybeSingle();

      if (clienteSelectError) {
        throw new Error(`Erro ao consultar cliente: ${clienteSelectError.message}`);
      }

      if (clienteExistente) {
        const { error: clienteUpdateError } = await supabase
          .from("clientes")
          .update(clientePayload)
          .eq("cpf", cpfDigits);

        if (clienteUpdateError) {
          throw new Error(`Erro ao atualizar cliente: ${clienteUpdateError.message}`);
        }

        setStatus({
          type: "success",
          msg: "Cliente atualizado com sucesso!",
        });
      } else {
        const { error: clienteInsertError } = await supabase
          .from("clientes")
          .insert([clientePayload]);

        if (clienteInsertError) {
          throw new Error(`Erro ao inserir cliente: ${clienteInsertError.message}`);
        }

        setStatus({
          type: "success",
          msg: "Cliente cadastrado com sucesso!",
        });
      }

      resetForm();
    } catch (err: any) {
      setStatus({
        type: "error",
        msg: err?.message || "Erro ao cadastrar cliente.",
      });
    } finally {
      setLoading(false);
    }
  };

  const whatsappPreview = newWhatsapp.trim()
    ? whatsappToE164BR(newWhatsapp) || ""
    : "";

  return (
    <div className="space-y-6 pb-24 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white leading-tight">
            Cadastro de Cliente
          </h2>
          <p className="text-gray-400 text-sm">
            Cadastre ou atualize um cliente pelo CPF.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onBack?.()}
          className="bg-green-500 text-[#0a1628] font-bold px-4 py-2 text-sm rounded-xl hover:bg-green-400 transition-all shadow-lg shadow-green-500/10 flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-semibold">Voltar</span>
        </button>
      </div>

      <div className="bg-[#1a2942] rounded-2xl border border-green-500/20 overflow-hidden">
        <div className="p-6 border-b border-gray-800/60">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-green-400" />
            Cadastrar Cliente
          </h3>
        </div>

        <form onSubmit={handleRegister} className="p-4 sm:p-6 space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-gray-400">Nome completo</label>
            <input
              className="w-full bg-[#0a1628] border border-gray-700 rounded-xl px-3 py-3 text-white text-sm outline-none focus:border-green-500"
              placeholder="Ex: Maria Silva"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-400">CPF</label>
              <input
                className="w-full bg-[#0a1628] border border-gray-700 rounded-xl px-3 py-3 text-white text-sm outline-none focus:border-green-500 text-center tracking-wider"
                placeholder="000.000.000-00"
                value={newCpf}
                onChange={(e) => setNewCpf(formatCpf(e.target.value))}
                inputMode="numeric"
                maxLength={14}
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-400">E-mail</label>
              <input
                className="w-full bg-[#0a1628] border border-gray-700 rounded-xl px-3 py-3 text-white text-sm outline-none focus:border-green-500"
                placeholder="cliente@email.com"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-400">WhatsApp</label>
              <input
                className="w-full bg-[#0a1628] border border-gray-700 rounded-xl px-3 py-3 text-white text-sm outline-none focus:border-green-500"
                placeholder="(98) 98888-7777"
                value={newWhatsapp}
                onChange={(e) =>
                  setNewWhatsapp(formatWhatsappBR(e.target.value))
                }
                inputMode="tel"
                maxLength={16}
              />
              {whatsappPreview && (
                <div className="text-[10px] text-gray-500 mt-1">
                  Será salvo como:{" "}
                  <span className="text-gray-300">{whatsappPreview}</span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-400">
                Device de Geração (S/N)
              </label>
              <input
                className="w-full bg-[#0a1628] border border-gray-700 rounded-xl px-3 py-3 text-white text-sm outline-none focus:border-green-500 uppercase tracking-wide"
                placeholder="Ex: 24BRINV00018473"
                value={newDeviceGeracao}
                onChange={(e) => setNewDeviceGeracao(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-400">
              Device de Consumo (S/N)
            </label>
            <input
              className="w-full bg-[#0a1628] border border-gray-700 rounded-xl px-3 py-3 text-white text-sm outline-none focus:border-green-500 uppercase tracking-wide"
              placeholder="Ex: 24BRCON00018473"
              value={newDeviceConsumo}
              onChange={(e) => setNewDeviceConsumo(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-400">Endereço</label>
            <input
              className="w-full bg-[#0a1628] border border-gray-700 rounded-xl px-3 py-3 text-white text-sm outline-none focus:border-green-500"
              placeholder="Rua, Nº, Bairro"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-xs text-gray-400">CEP</label>
              <input
                className="w-full bg-[#0a1628] border border-gray-700 rounded-xl px-3 py-3 text-white text-sm outline-none focus:border-green-500"
                placeholder="00000-000"
                inputMode="numeric"
                value={newZip}
                onChange={(e) => {
                  const formatted = formatCep(e.target.value);
                  setNewZip(formatted);

                  const digits = formatted.replace(/\D/g, "");
                  if (digits.length === 8) fetchAddressByCep(digits);
                }}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-400">UF</label>
              <input
                className="w-full bg-[#0a1628] border border-gray-700 rounded-xl px-3 py-3 text-white text-sm outline-none focus:border-green-500 text-center uppercase"
                placeholder="UF"
                value={newState}
                onChange={(e) => setNewState(e.target.value.toUpperCase())}
                maxLength={2}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-400">Cidade</label>
            <input
              className="w-full bg-[#0a1628] border border-gray-700 rounded-xl px-3 py-3 text-white text-sm outline-none focus:border-green-500"
              placeholder="Ex: São Luís"
              value={newCity}
              onChange={(e) => setNewCity(e.target.value)}
            />
          </div>

          <div className="pt-2 space-y-3">
            <div className="flex justify-end">
              <button
                className="bg-green-500 text-[#0a1628] font-bold px-4 py-2 text-sm rounded-xl hover:bg-green-400 transition-all shadow-lg shadow-green-500/10 disabled:opacity-70 disabled:cursor-not-allowed"
                disabled={loading}
              >
                {loading ? "SALVANDO..." : "SALVAR CLIENTE"}
              </button>
            </div>

            {status && (
              <div
                className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl border ${
                  status.type === "success"
                    ? "text-green-300 border-green-500/20 bg-green-500/10"
                    : "text-red-300 border-red-500/20 bg-red-500/10"
                }`}
              >
                {status.type === "success" ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
                <span className="leading-snug">{status.msg}</span>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
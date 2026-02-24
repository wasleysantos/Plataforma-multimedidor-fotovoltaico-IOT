import { useEffect, useMemo, useState } from "react";
import { Search, MapPin, ExternalLink, Wifi, WifiOff } from "lucide-react";
import { supabase } from "../lib/supabase";

interface MonitoringProps {
  // ✅ permite selecionar um CPF pela base
  onSelectCpf?: (cpf: string) => void;
}

// ✅ helpers CPF
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

type CustomerRow = {
  id: number;
  name: string | null;
  cpf: string | null;
  email: string | null;
  state: string | null;
  city: string | null;
  device_id: string | null;
};

type DeviceStatusRow = {
  device_id: string;
  relay_state: boolean | null;
  updated_at: string | null;
};

type CustomerWithStatus = CustomerRow & {
  // ✅ regra: se estiver DESLIGADO (false) OU não existir na tabela => OFFLINE
  isOnline: boolean;
  statusUpdatedAt?: string | null;
};

export function Monitoring({ onSelectCpf }: MonitoringProps) {
  const [customers, setCustomers] = useState<CustomerWithStatus[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  const [loading, setLoading] = useState(false);
  const [dbError, setDbError] = useState("");

  const fetchBase = async () => {
    setLoading(true);
    setDbError("");

    try {
      // 1) clientes
      const { data: cData, error: cErr } = await supabase
        .from("customers")
        .select("id,name,cpf,email,state,city,device_id")
        .order("name", { ascending: true });

      if (cErr) {
        setDbError(cErr.message || "Erro ao buscar customers");
        setCustomers([]);
        setLoading(false);
        return;
      }

      const customersRaw = (cData || []) as CustomerRow[];

      // 2) status dos dispositivos
      const { data: dData, error: dErr } = await supabase
        .from("device_status")
        .select("device_id,relay_state,updated_at");

      if (dErr) {
        // Se der erro na tabela, ainda assim mostramos a base, mas tudo OFFLINE
        const fallback = customersRaw.map((c) => ({
          ...c,
          isOnline: false,
          statusUpdatedAt: null,
        }));
        setCustomers(fallback);
        setDbError(dErr.message || "Erro ao buscar device_status");
        setLoading(false);
        return;
      }

      const statusRows = (dData || []) as DeviceStatusRow[];
      const statusByDevice = new Map<string, DeviceStatusRow>();
      for (const s of statusRows) statusByDevice.set(String(s.device_id), s);

      // 3) merge + regra OFFLINE quando:
      //    - não existe device_id no cliente
      //    - não existe linha em device_status
      //    - relay_state === false (DESLIGADO)
      //    - relay_state === null (tratamos como OFFLINE)
      const merged: CustomerWithStatus[] = customersRaw.map((c) => {
        const devId = (c.device_id || "").trim();
        const st = devId ? statusByDevice.get(devId) : undefined;

        const relay = st?.relay_state;
        const isOnline = relay === true; // ✅ só TRUE vira ONLINE, o resto é OFFLINE

        return {
          ...c,
          isOnline,
          statusUpdatedAt: st?.updated_at ?? null,
        };
      });

      setCustomers(merged);
    } catch (e: any) {
      setDbError(e?.message || "Erro inesperado");
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBase();

    // ✅ opcional: atualizar status periodicamente
    const id = window.setInterval(() => fetchBase(), 15000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredCustomers = useMemo(() => {
    const term = (searchTerm || "").toLowerCase();

    return (customers || []).filter((c) => {
      const cpfMasked = formatCpf(c.cpf || "");
      return [
        c.name,
        c.cpf,
        cpfMasked,
        c.city,
        c.email,
        c.state,
        c.device_id,
      ].some((f) =>
        String(f || "")
          .toLowerCase()
          .includes(term),
      );
    });
  }, [customers, searchTerm]);

  const handleSelect = (cpfRaw: string) => {
    const clean = onlyDigits(cpfRaw);
    if (clean.length !== 11) return;
    onSelectCpf?.(clean);
  };

  return (
    <div className="pb-24 max-w-3xl mx-auto">
      <div className="bg-[#1a2942] rounded-2xl border border-gray-800 overflow-hidden">
        <div className="p-6 border-b border-gray-800/60">
          <h3 className="text-white font-semibold">Base de Monitoramento</h3>
          <p className="text-xs text-gray-400 mt-1">
            Pesquise e selecione rapidamente um CPF para monitorar.
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="    Buscar por nome, CPF, e-mail ou cidade..."
              className="w-full bg-[#0a1628] border border-gray-700 rounded-xl py-3 pl-10 pr-4 text-white text-sm outline-none focus:border-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>
              Resultados:{" "}
              <span className="text-gray-200 font-semibold">
                {filteredCustomers.length}
              </span>
            </span>
            <span className="hidden sm:inline">
              Total:{" "}
              <span className="text-gray-200 font-semibold">
                {customers.length}
              </span>
            </span>
          </div>

          {dbError && (
            <div className="text-[11px] text-yellow-400">
              {dbError} (mostrando base com status OFFLINE quando necessário)
            </div>
          )}

          {loading && (
            <div className="text-xs text-gray-400 animate-pulse">
              Carregando base...
            </div>
          )}

          <div className="space-y-3 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
            {filteredCustomers.map((c) => {
              const statusText = c.isOnline ? "Online" : "Offline"; // ✅ sem “DESLIGADO”
              const statusClass = c.isOnline
                ? "bg-green-500/15 text-green-400"
                : "bg-red-500/15 text-red-400";

              return (
                <div
                  key={c.id}
                  className="group flex items-center justify-between gap-3 p-3 rounded-2xl border border-gray-800 bg-[#0a1628]/50 hover:bg-[#0a1628]/70 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/10 flex items-center justify-center shrink-0">
                      <MapPin className="w-4 h-4 text-blue-300" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-white text-sm font-medium truncate">
                          {c.name || "Sem nome"}
                        </p>

                        <span
                          className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold ${statusClass}`}
                          title={
                            c.device_id
                              ? `device_id: ${c.device_id}`
                              : "Sem device_id (OFFLINE)"
                          }
                        >
                          {c.isOnline ? (
                            <Wifi className="w-3.5 h-3.5" />
                          ) : (
                            <WifiOff className="w-3.5 h-3.5" />
                          )}
                          {statusText}
                        </span>
                      </div>

                      <p className="text-gray-500 text-[11px] leading-snug">
                        {formatCpf(c.cpf || "")}
                        {c.city || c.state ? (
                          <>
                            {" "}
                            • {c.city || "-"}
                            {c.state ? `/${c.state}` : ""}
                          </>
                        ) : null}
                        {c.email ? ` • ${c.email}` : ""}
                      </p>

                      {/* opcional: mostrar última atualização do status */}
                      {c.statusUpdatedAt && (
                        <p className="text-gray-600 text-[10px] mt-1">
                          Status atualizado em:{" "}
                          {new Intl.DateTimeFormat("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(c.statusUpdatedAt))}
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => handleSelect(c.cpf || "")}
                    type="button"
                    title="Selecionar CPF"
                    className="shrink-0 bg-green-500 text-[#0a1628] font-bold px-3 py-2 text-xs rounded-2xl hover:bg-green-400 transition-all shadow-lg shadow-green-500/10 flex items-center justify-center gap-2"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span className="hidden sm:inline">Selecionar</span>
                  </button>
                </div>
              );
            })}

            {!loading && filteredCustomers.length === 0 && (
              <div className="text-center py-10">
                <div className="text-gray-300 text-sm font-semibold">
                  Nada encontrado
                </div>
                <div className="text-gray-500 text-xs mt-1">
                  Tente outro nome/CPF ou limpe o campo de busca.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

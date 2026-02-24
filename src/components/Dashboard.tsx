// Dashboard.tsx (COMPLETO ATUALIZADO) ✅
// - Cards alterados para: GERAÇÃO (MÊS), CONSUMO (MÊS), SALDO (MÊS) e STATUS
// - Geração (Mês) usa monthKwh (measurements)
// - Consumo e Saldo ficam vazios por enquanto
// - Status (Online/Offline) mantém a lógica atual (relayState)
// - Mantém todo o resto (monitoring, realtime/polling, toggle, etc.)

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sun,
  Zap,
  History,
  Settings,
  LogOut,
  Menu,
  X,
  AlertCircle,
  Plug,
  Wifi,
  WifiOff,
  Users,
} from "lucide-react";

import { supabase } from "../lib/supabase";

import { MetricsCard } from "./MetricsCard";
import { PowerChart } from "./PowerChart";
import { Generation } from "./Generation";
import { Consumption } from "./Consumption";
import { Historic } from "./Historic";
import { SettingsPage } from "./SettingsPage";
import { CustomerRegisterPage } from "./CustomerRegisterPage";
import { Monitoring } from "./Monitoring";

import logoImage from "figma:asset/86a5dbd476eaf5850e2d574675b5ba3853e32186.png";

interface DashboardProps {
  user: { name: string; email: string };
  onLogout: () => void;
}

type Screen =
  | "dashboard"
  | "monitoring"
  | "generation"
  | "consumption"
  | "historic"
  | "settings"
  | "customer_register";

const normalizeCpf = (value: string) =>
  (value || "").replace(/\D/g, "").slice(0, 11);

const maskCPF = (value: string) => {
  const v = normalizeCpf(value);
  const p1 = v.slice(0, 3);
  const p2 = v.slice(3, 6);
  const p3 = v.slice(6, 9);
  const p4 = v.slice(9, 11);

  let out = p1;
  if (p2) out += `.${p2}`;
  if (p3) out += `.${p3}`;
  if (p4) out += `-${p4}`;
  return out;
};

const toNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function tsToMs(ts: string) {
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function integrateKwhFromRows(
  rowsAsc: { timestamp: string; solar_generation: any }[],
) {
  if (!rowsAsc || rowsAsc.length < 2) return 0;

  let kwh = 0;

  for (let i = 1; i < rowsAsc.length; i++) {
    const prev = rowsAsc[i - 1];
    const curr = rowsAsc[i];

    const t0 = tsToMs(prev.timestamp);
    const t1 = tsToMs(curr.timestamp);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;

    const dtHours = Math.max(0, (t1 - t0) / (1000 * 60 * 60));

    const p0w = Math.max(0, toNum(prev.solar_generation));
    const p1w = Math.max(0, toNum(curr.solar_generation));

    const pAvgKw = (p0w + p1w) / 2 / 1000;
    kwh += pAvgKw * dtHours;
  }

  return kwh;
}

export function Dashboard({ user, onLogout }: DashboardProps) {
  const [currentScreen, setCurrentScreen] = useState<Screen>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);

  const [now, setNow] = useState(() => new Date());

  const [targetCPF, setTargetCPF] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [inputError, setInputError] = useState(false);

  const [cpfNotFound, setCpfNotFound] = useState(false);
  const [dbError, setDbError] = useState("");

  const [personName, setPersonName] = useState<string>("");
  const [nameNotFound, setNameNotFound] = useState(false);
  const [loadingName, setLoadingName] = useState(false);

  const [lastUpdate, setLastUpdate] = useState<string>("—");

  const [realData, setRealData] = useState({
    voltage: 0,
    current: 0,
    solarW: 0,
    consW: 0,
    netW: 0,
    status: "Offline" as "Online" | "Offline",
  });

  // ✅ AGORA É kWh DO MÊS
  const [monthKwh, setMonthKwh] = useState(0);
  const [monthKwhError, setMonthKwhError] = useState("");

  // ==============================
  // ✅ CONTROLE DO SISTEMA (device_status)
  // ==============================
  const DEVICE_ID = "ESP32_PZEM_TESTE";

  const [relayState, setRelayState] = useState<boolean | null>(null);
  const [relayLoading, setRelayLoading] = useState(false);
  const [relayError, setRelayError] = useState("");

  const fetchRelayState = async () => {
    setRelayError("");

    const { data, error } = await supabase
      .from("device_status")
      .select("relay_state")
      .eq("device_id", DEVICE_ID)
      .maybeSingle();

    if (error) {
      console.error("Erro device_status:", error);
      setRelayError(error.message || "Erro ao consultar device_status");
      setRelayState(null);
      return;
    }

    if (!data) {
      setRelayState(false);
      return;
    }

    setRelayState(!!data.relay_state);
  };

  const toggleSystemPower = async () => {
    if (relayState === null) return;

    setRelayLoading(true);
    setRelayError("");

    const prevState = relayState;
    const nextState = !relayState;

    setRelayState(nextState);

    const { error } = await supabase.from("device_status").upsert(
      {
        device_id: DEVICE_ID,
        relay_state: nextState,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "device_id" },
    );

    if (error) {
      console.error("❌ Erro toggleSystemPower:", error);
      setRelayError(error.message || "Erro ao atualizar estado do sistema");
      setRelayState(prevState);
    }

    setRelayLoading(false);
  };

  const fetchLatestData = async () => {
    if (!targetCPF) return;

    setDbError("");

    const { data, error } = await supabase
      .from("measurements")
      .select("*")
      .eq("user_cpf", targetCPF)
      .order("timestamp", { ascending: false })
      .limit(1);

    if (error) {
      console.error("Erro measurements:", {
        message: error.message,
        details: (error as any).details,
        hint: (error as any).hint,
        code: (error as any).code,
        targetCPF,
      });
      setDbError(error.message || "Erro ao consultar measurements");
      setCpfNotFound(false);

      setLastUpdate("—");
      setRealData({
        voltage: 0,
        current: 0,
        solarW: 0,
        consW: 0,
        netW: 0,
        status: "Offline",
      });
      return;
    }

    if (!data || data.length === 0) {
      setLastUpdate("—");
      setRealData({
        voltage: 0,
        current: 0,
        solarW: 0,
        consW: 0,
        netW: 0,
        status: "Offline",
      });
      setCpfNotFound(true);
      return;
    }

    const row: any = data[0];

    const formattedDate = row?.timestamp
      ? new Intl.DateTimeFormat("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date(row.timestamp))
      : "—";
    setLastUpdate(formattedDate);

    const solarW = toNum(row.solar_generation);
    const consW = toNum(row.house_consumption);
    const netW = solarW - consW;

    setRealData({
      voltage: toNum(row.voltage),
      current: toNum(row.current),
      solarW,
      consW,
      netW,
      status: "Online",
    });

    setCpfNotFound(false);
  };

  // ✅ kWh DO MÊS (do dia 1 até agora)
  // Base correta: solar_generation (W) a cada 10s

  const SAMPLE_SECONDS = 10;
  const WH_FACTOR = SAMPLE_SECONDS / 3600; // 1/360

  const calcMonthKwh = async () => {
    if (!targetCPF) return;

    setMonthKwhError("");

    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("measurements")
      .select("solar_generation")
      .eq("user_cpf", targetCPF)
      .gte("timestamp", start.toISOString())
      .limit(100000); // mês pode ter bastante leitura

    if (error) {
      console.error("Erro calcMonthKwh:", error);
      setMonthKwhError(error.message || "Erro ao calcular kWh do mês");
      setMonthKwh(0);
      return;
    }

    const rows = (data || []) as { solar_generation: any }[];

    // 🔥 Soma correta: W → Wh → kWh
    const totalWh = rows.reduce((acc, r) => {
      const w = Number(r?.solar_generation);
      const safeW = Number.isFinite(w) && w > 0 ? w : 0;
      return acc + safeW * WH_FACTOR;
    }, 0);

    const kwh = totalWh / 1000;

    setMonthKwh(Number(kwh.toFixed(3)));
  };

  const fetchPersonName = async () => {
    if (!targetCPF) return;

    setLoadingName(true);

    const { data, error } = await supabase
      .from("customers")
      .select("name")
      .eq("cpf", targetCPF)
      .limit(1);

    if (error) {
      console.error("Erro customers:", {
        message: error.message,
        details: (error as any).details,
        hint: (error as any).hint,
        code: (error as any).code,
        targetCPF,
      });
      setPersonName("");
      setNameNotFound(false);
      setLoadingName(false);
      return;
    }

    if (!data || data.length === 0) {
      setPersonName("");
      setNameNotFound(true);
      setLoadingName(false);
      return;
    }

    setPersonName(data[0]?.name || "");
    setNameNotFound(false);
    setLoadingName(false);
  };

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const cpfRef = useRef(targetCPF);
  useEffect(() => {
    cpfRef.current = targetCPF;
  }, [targetCPF]);

  const refreshAllFor = (cpf: string) => {
    if (!cpf) return;
    cpfRef.current = cpf;

    fetchLatestData();
    fetchPersonName();
    fetchRelayState();
    calcMonthKwh();
  };

  const handleFilter = () => {
    const cpfDigits = normalizeCpf(searchInput);

    if (cpfDigits.length !== 11) {
      setInputError(true);
      return;
    }

    setInputError(false);
    setCpfNotFound(false);
    setDbError("");
    setNameNotFound(false);
    setPersonName("");

    if (cpfDigits === targetCPF) {
      refreshAllFor(cpfDigits);
      return;
    }

    setTargetCPF(cpfDigits);
  };

  useEffect(() => {
    const cpfDigits = normalizeCpf(searchInput);

    if (cpfDigits.length < 11) {
      setInputError(false);
      return;
    }

    if (cpfDigits.length === 11) {
      setInputError(false);

      if (cpfDigits === targetCPF) {
        refreshAllFor(cpfDigits);
        return;
      }

      setCpfNotFound(false);
      setDbError("");
      setNameNotFound(false);
      setPersonName("");
      setTargetCPF(cpfDigits);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  useEffect(() => {
    let subscription: any = null;
    let relaySub: any = null;
    let pollId: number | null = null;
    let kwhPollId: number | null = null;

    if (targetCPF) {
      fetchLatestData();
      fetchPersonName();
      fetchRelayState();
      calcMonthKwh();

      pollId = window.setInterval(() => {
        fetchLatestData();
        fetchRelayState();
      }, 5000);

      kwhPollId = window.setInterval(() => {
        calcMonthKwh();
      }, 15000);

      subscription = supabase
        .channel(`realtime-measurements-${targetCPF}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "measurements",
            filter: `user_cpf=eq.${targetCPF}`,
          },
          (payload: any) => {
            const n = payload?.new;
            if (!n) return;

            const formatted = n?.timestamp
              ? new Intl.DateTimeFormat("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }).format(new Date(n.timestamp))
              : "—";
            setLastUpdate(formatted);

            const solarW = toNum(n.solar_generation);
            const consW = toNum(n.house_consumption);
            const netW = solarW - consW;

            setRealData({
              voltage: toNum(n.voltage),
              current: toNum(n.current),
              solarW,
              consW,
              netW,
              status: "Online",
            });

            setCpfNotFound(false);
            setDbError("");
          },
        )
        .subscribe();

      relaySub = supabase
        .channel(`realtime-device-status-${DEVICE_ID}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "device_status",
            filter: `device_id=eq.${DEVICE_ID}`,
          },
          (payload: any) => {
            setRelayState(!!payload.new.relay_state);
            setRelayError("");
          },
        )
        .subscribe();
    } else {
      setLastUpdate("—");
      setRealData({
        voltage: 0,
        current: 0,
        solarW: 0,
        consW: 0,
        netW: 0,
        status: "Offline",
      });
      setCpfNotFound(false);
      setDbError("");
      setPersonName("");
      setNameNotFound(false);
      setLoadingName(false);

      setMonthKwh(0);
      setMonthKwhError("");

      setRelayState(null);
      setRelayError("");
      setRelayLoading(false);
    }

    return () => {
      if (subscription) supabase.removeChannel(subscription);
      if (relaySub) supabase.removeChannel(relaySub);
      if (pollId) window.clearInterval(pollId);
      if (kwhPollId) window.clearInterval(kwhPollId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetCPF]);

  const timeText = useMemo(() => {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(now);
  }, [now]);

  const dateText = useMemo(() => {
    return new Intl.DateTimeFormat("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(now);
  }, [now]);

  const renderScreen = () => {
    switch (currentScreen) {
      case "monitoring":
        return (
          <Monitoring
            cpf={targetCPF}
            status={realData.status}
            lastUpdate={lastUpdate}
            voltage={realData.voltage}
            current={realData.current}
            solarW={realData.solarW}
            consW={realData.consW}
            netW={realData.netW}
            relayState={relayState}
            onSelectCpf={(cpf) => {
              const clean = normalizeCpf(cpf);
              if (clean.length !== 11) return;

              setSearchInput(maskCPF(clean));
              setInputError(false);
              setCpfNotFound(false);
              setDbError("");
              setNameNotFound(false);
              setPersonName("");

              setTargetCPF(clean);

              cpfRef.current = clean;
              queueMicrotask(() => {
                fetchLatestData();
                fetchPersonName();
                fetchRelayState();
                calcMonthKwh();
              });

              setMenuOpen(false);
            }}
          />
        );

      case "generation":
        return <Generation cpf={targetCPF} />;

      case "consumption":
        return <Consumption cpf={targetCPF} />;

      case "historic":
        return (
          <Historic
            cpf={targetCPF}
            onNavigate={(page) => {
              setCurrentScreen(page as any);
              setMenuOpen(false);
            }}
          />
        );

      case "settings":
        return (
          <SettingsPage
            user={user}
            onSelectCpf={(cpf) => {
              const clean = normalizeCpf(cpf);
              setSearchInput(maskCPF(clean));
              setInputError(false);
              setCpfNotFound(false);
              setDbError("");
              setTargetCPF(clean);
            }}
            onNavigate={(page: any) => {
              if (page === "dashboard") {
                setCurrentScreen("dashboard");
                setMenuOpen(false);
                return;
              }
              setCurrentScreen(page);
              setMenuOpen(false);
            }}
          />
        );

      case "customer_register":
        return (
          <CustomerRegisterPage
            onBack={() => {
              setCurrentScreen("settings");
              setMenuOpen(false);
            }}
          />
        );

      default:
        return (
          <>
            {/* Filtro CPF */}
            <div className="mb-4">
              <div className="flex gap-3 items-center justify-center">
                <div className="w-56 sm:w-72">
                  <input
                    type="text"
                    placeholder="000.000.000-00"
                    className={`w-full bg-[#1a2942] border rounded-xl py-3 px-4 text-white text-sm text-center outline-none transition-all ${
                      inputError
                        ? "border-red-500 ring-1 ring-red-500"
                        : "border-gray-700 focus:border-green-500"
                    }`}
                    value={searchInput}
                    onChange={(e) => {
                      setSearchInput(maskCPF(e.target.value));
                      setInputError(false);
                      setCpfNotFound(false);
                      setDbError("");
                      setNameNotFound(false);
                      setPersonName("");
                    }}
                  />
                </div>

                <button
                  onClick={handleFilter}
                  className="bg-green-500 hover:bg-green-600 text-[#0a1628] px-4 rounded-xl font-bold text-sm transition-all active:scale-95 py-3"
                >
                  BUSCAR
                </button>
              </div>

              {inputError && (
                <div className="flex items-center gap-1 mt-2 text-yellow-400 text-[10px] font-bold uppercase tracking-wider ml-2">
                  <AlertCircle className="w-3 h-3" />
                  CPF incompleto
                </div>
              )}

              {!inputError && dbError && targetCPF && (
                <div className="flex items-center gap-1 mt-2 text-red-400 text-[10px] font-bold uppercase tracking-wider ml-2">
                  <AlertCircle className="w-3 h-3" />
                  Erro ao consultar o banco: {dbError}
                </div>
              )}
            </div>

            {/* 📌 Monitoramento - CPF + Nome + Atualização + Relógio */}
            <div className="mb-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 p-4 backdrop-blur-md shadow-lg">
              <div className="flex items-center justify-between gap-4">
                {/* 🔎 Lado esquerdo */}
                <div className="flex flex-col space-y-1">
                  <span className="text-[11px] suppercase tracking-wider text-gray-300">
                    Monitorando:
                  </span>

                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-gray-300">
                      CPF:
                    </span>
                    <span className="text-base font-semibold text-green-400">
                      {targetCPF ? maskCPF(targetCPF) : "Aguardando CPF..."}
                    </span>
                  </div>

                  {targetCPF && (
                    <>
                      <div className="text-sm text-green-400">
                        {loadingName
                          ? "Carregando nome..."
                          : personName
                            ? personName
                            : nameNotFound
                              ? "CPF não encontrado"
                              : ""}
                      </div>

                      <div className="flex items-center gap-1 text-[11px] text-gray-400">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        Última atualização:
                        <span className="text-gray-300 font-medium text-green-400">
                          {lastUpdate}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* 🕒 Lado direito - Relógio */}
                <div className="text-right">
                  <div className="text-2xl font-bold text-white tracking-tight">
                    {timeText}
                  </div>
                  <div className="text-xs text-gray-400 capitalize">
                    {dateText}
                  </div>
                </div>
              </div>
            </div>
            {/* ✅ CARDS (MÊS): Geração/Consumo/Saldo/Status */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <MetricsCard
                icon={<Sun className="w-4 h-4" />}
                label="Geração (Mês)"
                value={`${monthKwh.toFixed(2)} kWh`}
                color="green"
              />

              <MetricsCard
                icon={<Plug className="w-4 h-4" />}
                label="Consumo (Mês)"
                value={"—"}
                color="yellow"
              />

              <MetricsCard
                icon={<Zap className="w-4 h-4" />}
                label="Saldo (Mês)"
                value={"—"}
                color="blue"
              />

              <MetricsCard
                icon={
                  relayState === null ? (
                    <Wifi className="w-4 h-4 text-gray-400" />
                  ) : relayState ? (
                    <Wifi className="w-4 h-4" />
                  ) : (
                    <WifiOff className="w-4 h-4" />
                  )
                }
                label="Status"
                value={
                  relayState === null
                    ? "Carregando..."
                    : relayState
                      ? "Online"
                      : "Offline"
                }
                color={
                  relayState === null ? "yellow" : relayState ? "green" : "red"
                }
                valueColor={
                  relayState === null ? "yellow" : relayState ? "green" : "red"
                }
              />
            </div>

            {monthKwhError && (
              <div className="flex items-center gap-1 -mt-2 mb-3 text-yellow-400 text-[10px] font-bold uppercase tracking-wider">
                <AlertCircle className="w-3 h-3" />
                kWh do mês: {monthKwhError}
              </div>
            )}

            {/* Chart */}
            <div className="bg-[#1a2942] rounded-2xl p-4 mb-6">
              <h3 className="text-white font-semibold mb-2 text-sm">
                Carga Atual
              </h3>
              <div className="h-20">
                <PowerChart cpf={targetCPF} />
              </div>
            </div>

            {/* Status do sistema */}
            <div className="mb-2 text-xs text-gray-300">
              Sistema:{" "}
              <span
                className={`font-bold ${
                  relayState === null
                    ? "text-gray-400"
                    : relayState
                      ? "text-green-400"
                      : "text-red-400"
                }`}
              >
                {relayState === null
                  ? "Carregando..."
                  : relayState
                    ? "LIGADO"
                    : "DESLIGADO"}
              </span>
            </div>

            {/* BOTÃO TOGGLE */}
            <button
              onClick={toggleSystemPower}
              disabled={relayLoading || relayState === null || !targetCPF}
              className={`w-full font-semibold py-4 rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                relayState
                  ? "bg-red-500 hover:bg-red-600 text-white"
                  : "bg-green-500 hover:bg-green-600 text-[#0a1628]"
              }`}
            >
              {relayLoading
                ? "ENVIANDO..."
                : relayState
                  ? "DESLIGAR SISTEMA"
                  : "LIGAR SISTEMA"}
            </button>

            {relayError && (
              <div className="flex items-center gap-1 mt-2 text-red-400 text-[10px] font-bold uppercase tracking-wider">
                <AlertCircle className="w-3 h-3" />
                {relayError}
              </div>
            )}

            {!targetCPF && (
              <div className="flex items-center gap-1 mt-2 text-yellow-400 text-[10px] font-bold uppercase tracking-wider">
                <AlertCircle className="w-3 h-3" />
                Informe um CPF para habilitar o controle
              </div>
            )}
          </>
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#0a1628] pb-20">
      <header className="bg-[#1a2942] px-4 py-4 flex items-center justify-between sticky top-0 z-50">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="text-white p-2 hover:bg-[#0a1628] rounded-lg transition-colors"
        >
          {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>

        <button
          type="button"
          onClick={() => {
            setCurrentScreen("dashboard");
            setMenuOpen(false);
          }}
          aria-label="Voltar para o Dashboard"
          className="bg-transparent p-0"
        >
          <img
            src={logoImage}
            alt="Logo"
            className="h-8 object-contain cursor-pointer"
          />
        </button>

        <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center text-white font-semibold">
          {user.name.charAt(0).toUpperCase()}
        </div>
      </header>

      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-64 bg-[#1a2942] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-8">
              <h2 className="text-white font-semibold mb-1">{user.name}</h2>
              <p className="text-gray-400 text-sm">{user.email}</p>
            </div>

            <nav className="space-y-2">
              <button
                onClick={() => {
                  setCurrentScreen("dashboard");
                  setMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  currentScreen === "dashboard"
                    ? "bg-green-500/20 text-green-400"
                    : "text-gray-300 hover:bg-[#0a1628]"
                }`}
              >
                <Menu className="w-5 h-5" />
                Dashboard
              </button>

              <button
                onClick={() => {
                  setCurrentScreen("generation");
                  setMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  currentScreen === "generation"
                    ? "bg-green-500/20 text-green-400"
                    : "text-gray-300 hover:bg-[#0a1628]"
                }`}
              >
                <Sun className="w-5 h-5" />
                Geração
              </button>

              <button
                onClick={() => {
                  setCurrentScreen("consumption");
                  setMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  currentScreen === "consumption"
                    ? "bg-green-500/20 text-green-400"
                    : "text-gray-300 hover:bg-[#0a1628]"
                }`}
              >
                <Plug className="w-5 h-5" />
                Consumo
              </button>

              <button
                onClick={() => {
                  setCurrentScreen("historic");
                  setMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  currentScreen === "historic"
                    ? "bg-green-500/20 text-green-400"
                    : "text-gray-300 hover:bg-[#0a1628]"
                }`}
              >
                <History className="w-5 h-5" />
                Histórico
              </button>

              <button
                onClick={() => {
                  setCurrentScreen("monitoring");
                  setMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  currentScreen === "monitoring"
                    ? "bg-green-500/20 text-green-400"
                    : "text-gray-300 hover:bg-[#0a1628]"
                }`}
              >
                <Users className="w-5 h-5" />
                Monitoramento
              </button>

              <button
                onClick={() => {
                  setCurrentScreen("settings");
                  setMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  currentScreen === "settings"
                    ? "bg-green-500/20 text-green-400"
                    : "text-gray-300 hover:bg-[#0a1628]"
                }`}
              >
                <Settings className="w-5 h-5" />
                Configurações
              </button>
            </nav>

            <button
              onClick={onLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors mt-8"
            >
              <LogOut className="w-5 h-5" />
              Sair
            </button>
          </div>
        </div>
      )}

      <main className="p-4">{renderScreen()}</main>
    </div>
  );
}

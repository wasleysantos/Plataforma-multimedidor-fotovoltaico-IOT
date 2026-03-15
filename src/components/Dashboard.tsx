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
import { integrateKwhFromRows, toNum } from "./EnergyCalc";

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

type CardRange = "realtime" | "month";

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

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
};

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

  const [lastGenUpdate, setLastGenUpdate] = useState<string>("—");
  const [lastConsUpdate, setLastConsUpdate] = useState<string>("—");

  const [cardRange, setCardRange] = useState<CardRange>("month");

  const [realData, setRealData] = useState({
    voltage: 0,
    current: 0,
    solarW: 0,
    consW: 0,
    netW: 0,
    status: "Offline" as "Online" | "Offline",
  });

  const [monthKwh, setMonthKwh] = useState(0);
  const [monthKwhError, setMonthKwhError] = useState("");

  const [monthConsKwh, setMonthConsKwh] = useState(0);
  const [monthConsKwhError, setMonthConsKwhError] = useState("");

  const monthBalanceKwh = useMemo(() => {
    const v = monthKwh - monthConsKwh;
    return Math.abs(v) < 0.0005 ? 0 : v;
  }, [monthKwh, monthConsKwh]);

  const [relayState, setRelayState] = useState<boolean | null>(null);
  const [relayLoading, setRelayLoading] = useState(false);
  const [relayError, setRelayError] = useState("");

  const [clienteDeviceGeracao, setClienteDeviceGeracao] = useState<
    string | null
  >(null);
  const [clienteDeviceConsumo, setClienteDeviceConsumo] = useState<
    string | null
  >(null);

  const cpfVariants = useMemo(() => {
    if (!targetCPF) return [];
    const clean = normalizeCpf(targetCPF);
    const masked = maskCPF(clean);
    return Array.from(new Set([clean, masked]));
  }, [targetCPF]);

  const fetchRelayState = async () => {
    if (!targetCPF) {
      setRelayState(null);
      setClienteDeviceGeracao(null);
      setClienteDeviceConsumo(null);
      return;
    }

    setRelayError("");

    const { data, error } = await supabase
      .from("device_status")
      .select("relay_state, device_geracao, device_consumo")
      .eq("cpf", targetCPF)
      .maybeSingle();

    if (error) {
      console.error("Erro device_status:", error);
      setRelayError(error.message || "Erro ao consultar device_status");
      setRelayState(null);
      return;
    }

    if (!data) {
      setRelayState(false);
      setClienteDeviceGeracao(null);
      setClienteDeviceConsumo(null);
      return;
    }

    setRelayState(!!data.relay_state);
    setClienteDeviceGeracao(data.device_geracao || null);
    setClienteDeviceConsumo(data.device_consumo || null);
  };

  const toggleSystemPower = async () => {
    if (relayState === null || !targetCPF) return;

    setRelayLoading(true);
    setRelayError("");

    const prevState = relayState;
    const nextState = !relayState;

    setRelayState(nextState);

    try {
      const { data: existingStatus, error: selectError } = await supabase
        .from("device_status")
        .select("id, cpf")
        .eq("cpf", targetCPF)
        .maybeSingle();

      if (selectError) {
        throw new Error(selectError.message);
      }

      if (existingStatus) {
        const { error: updateError } = await supabase
          .from("device_status")
          .update({
            relay_state: nextState,
            device_geracao: clienteDeviceGeracao || null,
            device_consumo: clienteDeviceConsumo || null,
            updated_at: new Date().toISOString(),
          })
          .eq("cpf", targetCPF);

        if (updateError) {
          throw new Error(updateError.message);
        }
      } else {
        const { error: insertError } = await supabase
          .from("device_status")
          .insert([
            {
              cpf: targetCPF,
              relay_state: nextState,
              device_geracao: clienteDeviceGeracao || null,
              device_consumo: clienteDeviceConsumo || null,
              updated_at: new Date().toISOString(),
            },
          ]);

        if (insertError) {
          throw new Error(insertError.message);
        }
      }
    } catch (error: any) {
      console.error("❌ Erro toggleSystemPower:", error);
      setRelayError(error.message || "Erro ao atualizar estado do sistema");
      setRelayState(prevState);
    } finally {
      setRelayLoading(false);
    }
  };

  const fetchLatestData = async () => {
    if (!targetCPF) return;

    setDbError("");

    const variants = cpfVariants.length ? cpfVariants : [targetCPF];

    const [genRes, consRes] = await Promise.all([
      supabase
        .from("geracao")
        .select("*")
        .in("user_cpf", variants)
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("consumo")
        .select("created_at,active_power")
        .in("user_cpf", variants)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    const genError = genRes.error;
    const consError = consRes.error;

    if (genError || consError) {
      const msg =
        genError?.message ||
        consError?.message ||
        "Erro ao consultar geração/consumo";

      console.error("Erro geração/consumo:", {
        genError,
        consError,
        targetCPF,
        variants,
      });

      setDbError(msg);
      setLastGenUpdate("—");
      setLastConsUpdate("—");
      setRealData({
        voltage: 0,
        current: 0,
        solarW: 0,
        consW: 0,
        netW: 0,
        status: "Offline",
      });
      setCpfNotFound(false);
      return;
    }

    const genData = genRes.data || [];
    const consData = consRes.data || [];

    if (genData.length === 0 && consData.length === 0) {
      setLastGenUpdate("—");
      setLastConsUpdate("—");
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

    const genRow: any = genData[0] || null;
    const consRow: any = consData[0] || null;

    setLastGenUpdate(formatDateTime(genRow?.created_at));
    setLastConsUpdate(formatDateTime(consRow?.created_at));

    const solarW = toNum(genRow?.active_power);
    const consW = toNum(consRow?.active_power);
    const netW = solarW - consW;

    setRealData({
      voltage: toNum(genRow?.voltage),
      current: toNum(genRow?.current),
      solarW,
      consW,
      netW,
      status: "Online",
    });

    setCpfNotFound(false);
  };

  const calcMonthKwh = async () => {
    if (!targetCPF) return;

    setMonthKwhError("");

    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const variants = cpfVariants.length ? cpfVariants : [targetCPF];

    const { data, error } = await supabase
      .from("geracao")
      .select("created_at,active_power")
      .in("user_cpf", variants)
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: true })
      .limit(100000);

    if (error) {
      setMonthKwhError(error.message || "Erro ao calcular kWh do mês");
      setMonthKwh(0);
      return;
    }

    const rows = (data || []) as { created_at: string; active_power: any }[];
    const kwh = integrateKwhFromRows(rows);
    setMonthKwh(Number(kwh.toFixed(3)));
  };

  const calcMonthConsKwh = async () => {
    if (!targetCPF) return;

    setMonthConsKwhError("");

    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const variants = cpfVariants.length ? cpfVariants : [targetCPF];

    const { data, error } = await supabase
      .from("consumo")
      .select("created_at,active_power")
      .in("user_cpf", variants)
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: true })
      .limit(100000);

    if (error) {
      setMonthConsKwhError(error.message || "Erro ao calcular consumo do mês");
      setMonthConsKwh(0);
      return;
    }

    const rows = (data || []) as { created_at: string; active_power: any }[];
    const kwh = integrateKwhFromRows(rows);
    setMonthConsKwh(Number(kwh.toFixed(3)));
  };

  const fetchPersonName = async () => {
    if (!targetCPF) return;

    setLoadingName(true);

    const { data, error } = await supabase
      .from("clientes")
      .select("name, device_geracao, device_consumo")
      .eq("cpf", targetCPF)
      .limit(1);

    if (error) {
      console.error("Erro clientes:", {
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
      setClienteDeviceGeracao(null);
      setClienteDeviceConsumo(null);
      setLoadingName(false);
      return;
    }

    setPersonName(data[0]?.name || "");
    setClienteDeviceGeracao(data[0]?.device_geracao || null);
    setClienteDeviceConsumo(data[0]?.device_consumo || null);
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
    calcMonthConsKwh();
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
    let genSub: any = null;
    let consSub: any = null;
    let relaySub: any = null;
    let pollId: number | null = null;
    let kwhPollId: number | null = null;

    if (targetCPF) {
      fetchLatestData();
      fetchPersonName();
      fetchRelayState();
      calcMonthKwh();
      calcMonthConsKwh();

      pollId = window.setInterval(() => {
        fetchLatestData();
        fetchRelayState();
      }, 5000);

      kwhPollId = window.setInterval(() => {
        calcMonthKwh();
        calcMonthConsKwh();
      }, 15000);

      genSub = supabase
        .channel(`realtime-geracao-${targetCPF}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "geracao",
            filter: `user_cpf=eq.${targetCPF}`,
          },
          () => {
            fetchLatestData();
            setDbError("");
          },
        )
        .subscribe();

      consSub = supabase
        .channel(`realtime-consumo-${targetCPF}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "consumo",
            filter: `user_cpf=eq.${targetCPF}`,
          },
          () => {
            fetchLatestData();
            setDbError("");
          },
        )
        .subscribe();

      relaySub = supabase
        .channel(`realtime-device-status-${targetCPF}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "device_status",
            filter: `cpf=eq.${targetCPF}`,
          },
          (payload: any) => {
            setRelayState(!!payload.new?.relay_state);
            setClienteDeviceGeracao(payload.new?.device_geracao || null);
            setClienteDeviceConsumo(payload.new?.device_consumo || null);
            setRelayError("");
          },
        )
        .subscribe();
    } else {
      setLastGenUpdate("—");
      setLastConsUpdate("—");
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
      setMonthConsKwh(0);
      setMonthConsKwhError("");

      setRelayState(null);
      setRelayError("");
      setRelayLoading(false);
      setClienteDeviceGeracao(null);
      setClienteDeviceConsumo(null);
    }

    return () => {
      if (genSub) supabase.removeChannel(genSub);
      if (consSub) supabase.removeChannel(consSub);
      if (relaySub) supabase.removeChannel(relaySub);
      if (pollId) window.clearInterval(pollId);
      if (kwhPollId) window.clearInterval(kwhPollId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetCPF, cpfVariants]);

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

  const generationLabel =
    cardRange === "realtime" ? "Geração (Tempo real)" : "Geração (Mês)";
  const consumptionLabel =
    cardRange === "realtime" ? "Consumo (Tempo real)" : "Consumo (Mês)";
  const balanceLabel =
    cardRange === "realtime" ? "Saldo (Tempo real)" : "Saldo (Mês)";

  const generationValue =
    cardRange === "realtime"
      ? `${realData.solarW.toFixed(2)} W`
      : `${monthKwh.toFixed(2)} kWh`;

  const consumptionValue =
    cardRange === "realtime"
      ? `${realData.consW.toFixed(2)} W`
      : `${monthConsKwh.toFixed(2)} kWh`;

  const balanceValue =
    cardRange === "realtime"
      ? `${realData.netW >= 0 ? "+" : ""}${realData.netW.toFixed(2)} W`
      : `${monthBalanceKwh >= 0 ? "+" : ""}${monthBalanceKwh.toFixed(2)} kWh`;

  const currentBalanceColor: "green" | "red" =
    cardRange === "realtime"
      ? realData.netW >= 0
        ? "green"
        : "red"
      : monthBalanceKwh >= 0
        ? "green"
        : "red";

  const renderScreen = () => {
    switch (currentScreen) {
      case "monitoring":
        return (
          <Monitoring
            cpf={targetCPF}
            status={realData.status}
            lastUpdate={`Geração: ${lastGenUpdate} | Consumo: ${lastConsUpdate}`}
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
                calcMonthConsKwh();
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

              {!inputError && !dbError && cpfNotFound && targetCPF && (
                <div className="flex items-center gap-1 mt-2 text-yellow-400 text-[10px] font-bold uppercase tracking-wider ml-2">
                  <AlertCircle className="w-3 h-3" />
                  Nenhum dado encontrado para este CPF
                </div>
              )}
            </div>

            <div className="mb-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 p-4 backdrop-blur-md shadow-lg">
              <div className="flex items-center justify-between gap-4">
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

                      <div className="flex flex-col gap-1 text-[11px] text-gray-400">
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                          Última geração:
                          <span className="text-gray-300 font-medium text-green-400">
                            {lastGenUpdate}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></span>
                          Último consumo:
                          <span className="text-gray-300 font-medium text-yellow-400">
                            {lastConsUpdate}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>

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

            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white text-sm font-semibold">
                Resumo energético
              </h3>

              <div className="flex bg-[#1a2942] rounded-xl p-1 border border-gray-700">
                <button
                  onClick={() => setCardRange("realtime")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    cardRange === "realtime"
                      ? "bg-green-500 text-[#0a1628]"
                      : "text-gray-300 hover:text-white"
                  }`}
                >
                  Tempo real
                </button>

                <button
                  onClick={() => setCardRange("month")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    cardRange === "month"
                      ? "bg-green-500 text-[#0a1628]"
                      : "text-gray-300 hover:text-white"
                  }`}
                >
                  Mês
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <MetricsCard
                icon={<Sun className="w-4 h-4" />}
                label={generationLabel}
                value={generationValue}
                color="green"
              />

              <MetricsCard
                icon={<Plug className="w-4 h-4" />}
                label={consumptionLabel}
                value={consumptionValue}
                color="yellow"
              />

              <MetricsCard
                icon={<Zap className="w-4 h-4" />}
                label={balanceLabel}
                value={balanceValue}
                color={currentBalanceColor === "green" ? "green" : "red"}
                valueColor={currentBalanceColor}
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

            {cardRange === "month" && (monthKwhError || monthConsKwhError) && (
              <div className="flex flex-col gap-1 -mt-2 mb-3">
                {monthKwhError && (
                  <div className="flex items-center gap-1 text-yellow-400 text-[10px] font-bold uppercase tracking-wider">
                    <AlertCircle className="w-3 h-3" />
                    kWh do mês (geração): {monthKwhError}
                  </div>
                )}
                {monthConsKwhError && (
                  <div className="flex items-center gap-1 text-yellow-400 text-[10px] font-bold uppercase tracking-wider">
                    <AlertCircle className="w-3 h-3" />
                    kWh do mês (consumo): {monthConsKwhError}
                  </div>
                )}
              </div>
            )}

            <div className="bg-[#1a2942] rounded-2xl p-4 mb-6">
              <h3 className="text-white font-semibold mb-2 text-sm">
                Carga Atual
              </h3>
              <div className="h-20">
                <PowerChart cpf={targetCPF} />
              </div>
            </div>

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
          className="fixed inset-0 z-50 bg-black/50"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="fixed left-0 top-0 bottom-0 w-64 bg-[#1a2942] p-6 z-60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-center gap-3 bg-[#0f1f35] p-5 rounded-xl border border-gray-800">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 font-bold text-lg">
                {user?.name
                  ? user.name.charAt(0).toUpperCase()
                  : user?.email?.charAt(0).toUpperCase()}
              </div>

              <div className="flex flex-col min-w-0">
                <span className="text-white font-semibold text-sm truncate">
                  {user?.name ? user.name.split(" ")[0] : "Usuário"}
                </span>
                <span className="text-gray-400 text-xs truncate">
                  {user.email}
                </span>
              </div>
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
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors mt-6"
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

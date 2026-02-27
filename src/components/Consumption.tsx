import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Zap, User, AlertCircle } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ✅ cálculo unificado
import { integrateKwhFromRows, toNum } from "./EnergyCalc";

interface ConsumptionProps {
  cpf: string; // (já vem limpo do Dashboard)
}

/** ⚠️ AJUSTE AQUI se o nome da tabela for diferente */
const TABLE_CONSUMO = "consumo";

type Row = {
  id?: string | number;
  created_at: string;
  active_power: any; // W
};

// W -> kW
const wToKw = (w: number) => w / 1000;

// formata CPF "11111111111" -> "111.111.111-11"
function formatCpfFromDigits(v: string) {
  const d = (v || "").replace(/\D/g, "").slice(0, 11);
  if (d.length !== 11) return "";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

// eixo curto: DD/MM HH:MM
function fmtAxis(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--/-- --:--";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

// tooltip completo: DD/MM/AAAA HH:MM:SS
function fmtTooltip(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "Data inválida";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

function tsToMsSafe(ts: string) {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : NaN;
}

export function Consumption({ cpf }: ConsumptionProps) {
  const [currentW, setCurrentW] = useState(0);
  const [todayKwh, setTodayKwh] = useState(0);
  const [chartRows, setChartRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState("");

  // nome do cliente
  const [personName, setPersonName] = useState("");
  const [loadingName, setLoadingName] = useState(false);

  // ref do cpf pra callbacks
  const cpfRef = useRef(cpf);
  useEffect(() => {
    cpfRef.current = cpf;
  }, [cpf]);

  // cpf variants (caso seu banco guarde com pontuação)
  const cpfFmt = useMemo(() => formatCpfFromDigits(cpf), [cpf]);

  const fetchPersonName = async () => {
    if (!cpf) return;
    setLoadingName(true);

    const { data, error } = await supabase
      .from("clientes") // ✅ customers -> clientes
      .select("name")
      .eq("cpf", cpf)
      .maybeSingle();

    if (!error && data) setPersonName(data?.name || "");
    else setPersonName("");

    setLoadingName(false);
  };

  const fetchConsumption = async () => {
    if (!cpf) {
      setLoading(false);
      setDbError("");
      setChartRows([]);
      setCurrentW(0);
      setTodayKwh(0);
      return;
    }

    setLoading(true);
    setDbError("");

    const { data, error } = await supabase
      .from(TABLE_CONSUMO)
      .select("id,created_at,active_power")
      .in("user_cpf", cpfFmt ? [cpf, cpfFmt] : [cpf]) // ✅ suporta CPF com/sem máscara
      .order("created_at", { ascending: false })
      .limit(24);

    if (error) {
      console.error("Consumption error:", error);
      setDbError(error.message || `Erro ao consultar ${TABLE_CONSUMO}`);
      setChartRows([]);
      setCurrentW(0);
      setTodayKwh(0);
      setLoading(false);
      return;
    }

    const rows = (data as Row[]) || [];

    if (rows.length > 0) {
      const newest = rows[0];
      setCurrentW(Math.max(0, toNum(newest.active_power)));

      const asc = [...rows]
        .filter((r) => Number.isFinite(tsToMsSafe(r.created_at)))
        .sort((a, b) => tsToMsSafe(a.created_at) - tsToMsSafe(b.created_at));

      setChartRows(asc);
    } else {
      setChartRows([]);
      setCurrentW(0);
    }

    setLoading(false);
  };

  const fetchTodayKwh = async () => {
    if (!cpf) return;

    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from(TABLE_CONSUMO)
      .select("created_at,active_power")
      .in("user_cpf", cpfFmt ? [cpf, cpfFmt] : [cpf])
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: true })
      .limit(100000); // ✅ mantém alto (amostra a cada 10s)

    if (error) {
      console.error("fetchTodayConsumptionKwh error:", error);
      return;
    }

    const rows = (data || []) as { created_at: string; active_power: any }[];
    const kwh = integrateKwhFromRows(rows); // ✅ cálculo unificado
    setTodayKwh(Number(kwh.toFixed(3)));
  };

  // primeira carga + mudança de CPF
  useEffect(() => {
    let kwhPollId: number | null = null;
    let sub: any = null;

    if (!cpf) {
      setLoading(false);
      setChartRows([]);
      setCurrentW(0);
      setTodayKwh(0);
      setDbError("");
      setPersonName("");
      return;
    }

    fetchPersonName();
    fetchConsumption();
    fetchTodayKwh();

    // kWh do dia
    kwhPollId = window.setInterval(() => {
      fetchTodayKwh();
    }, 30000);

    // realtime
    sub = supabase
      .channel(`realtime-consumption-${cpf}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: TABLE_CONSUMO,
          // ⚠️ filtro do realtime não suporta OR fácil; então deixo sem filtro e filtro no código
        },
        (payload: any) => {
          const n: any = payload?.new ?? null;
          if (!n?.created_at) return;

          const incomingCpf = String(n.user_cpf || "");
          const okCpf =
            incomingCpf === cpf || (cpfFmt && incomingCpf === cpfFmt);

          if (!okCpf) return;

          const row: Row = {
            id: n.id,
            created_at: n.created_at,
            active_power: n.active_power,
          };

          setCurrentW(Math.max(0, toNum(row.active_power)));
          setDbError("");

          setChartRows((prev) => {
            const map = new Map<string, Row>();
            for (const r of prev) {
              if (r.id != null) map.set(String(r.id), r);
            }
            if (row.id != null) map.set(String(row.id), row);

            const arr = Array.from(map.values())
              .filter((r) => Number.isFinite(tsToMsSafe(r.created_at)))
              .sort(
                (a, b) => tsToMsSafe(a.created_at) - tsToMsSafe(b.created_at),
              );

            return arr.length > 30 ? arr.slice(arr.length - 30) : arr;
          });
        },
      )
      .subscribe();

    return () => {
      if (kwhPollId) window.clearInterval(kwhPollId);
      if (sub) supabase.removeChannel(sub);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpf, cpfFmt]);

  const chartData = useMemo(() => {
    if (!chartRows.length) return [];
    return chartRows.map((r) => {
      const w = Math.max(0, toNum(r.active_power));
      return {
        ts: r.created_at,
        label: fmtAxis(r.created_at),
        value: Number(wToKw(w).toFixed(3)), // kW no gráfico
      };
    });
  }, [chartRows]);

  if (!cpf) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col mb-6">
          <h2 className="text-2xl font-bold text-white">Consumo de Energia</h2>
          <div className="flex items-center gap-2 text-blue-400 text-xs mt-1">
            <User className="w-3 h-3" />
            <span>Cliente: Aguardando seleção...</span>
          </div>
        </div>

        <div className="bg-[#1a2942] rounded-2xl p-10 text-center border border-dashed border-gray-700">
          <p className="text-gray-500 text-sm">
            Insira o CPF no painel principal para carregar os dados de consumo.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-white animate-pulse">
        Consultando banco de dados...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col mb-6">
        <h2 className="text-2xl font-bold text-white">Consumo de Energia</h2>

        <div className="flex items-center gap-2 text-blue-400 text-xs mt-1">
          <User className="w-3 h-3" />
          <span>CPF: {cpf}</span>
        </div>

        <div className="text-xs text-gray-300 mt-1">
          {loadingName ? "Carregando nome..." : personName ? personName : "—"}
        </div>

        {dbError && (
          <div className="flex items-center gap-1 mt-2 text-red-400 text-[10px] font-bold uppercase tracking-wider">
            <AlertCircle className="w-3 h-3" />
            <span>Erro:</span> {dbError}
          </div>
        )}
      </div>

      {/* Card: Potência atual (kW) */}
      <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-6 shadow-lg shadow-blue-500/20">
        <div className="flex items-center gap-3 mb-2">
          <Zap className="w-8 h-8 text-white" />
          <span className="text-white/80 font-medium">Consumo Atual</span>
        </div>

        <p className="text-5xl font-bold text-white mb-1">
          {wToKw(currentW).toFixed(3)} <span className="text-xl">kW</span>
        </p>
        <p className="text-white/80 text-sm">
          Medida instantânea (não acumulada)
        </p>
      </div>

      {/* Card: Consumo do dia (kWh) */}
      <div className="bg-[#1a2942] rounded-2xl p-4 border border-blue-500/20">
        <div className="text-xs text-gray-400">Consumo de hoje</div>
        <div className="text-2xl font-bold text-blue-300 mt-1">
          {todayKwh.toFixed(2)}{" "}
          <span className="text-xs text-gray-400">kWh</span>
        </div>
        <div className="text-[11px] text-gray-500 mt-1">
          Calculado pela integração no tempo usando potência (W) das medições do
          dia.
        </div>
      </div>

      {/* Gráfico */}
      <div className="bg-[#1a2942] rounded-2xl p-4 border border-gray-800">
        <h3 className="text-white font-semibold mb-4 text-sm">
          Potência nas últimas leituras (kW)
        </h3>

        <div className="h-[220px] w-full">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis
                  dataKey="label"
                  stroke="#64748b"
                  style={{ fontSize: "10px" }}
                  interval="preserveStartEnd"
                />
                <YAxis stroke="#64748b" style={{ fontSize: "10px" }} />
                <Tooltip
                  labelFormatter={(_, payload) => {
                    const ts = payload?.[0]?.payload?.ts;
                    return ts
                      ? `Atualizado em: ${fmtTooltip(ts)}`
                      : "Atualizado em: --";
                  }}
                  formatter={(value: any) => [`${value} kW`, "Potência"]}
                  contentStyle={{
                    backgroundColor: "#1a2942",
                    border: "1px solid #374151",
                    borderRadius: "8px",
                    color: "#fff",
                  }}
                  itemStyle={{ color: "#3b82f6" }}
                />
                <Bar
                  dataKey="value"
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                  barSize={26}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              Sem dados de consumo para este CPF.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

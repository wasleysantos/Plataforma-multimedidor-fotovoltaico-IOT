import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Sun, User, AlertCircle } from "lucide-react";
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

interface GenerationProps {
  cpf: string; // (já vem limpo do Dashboard)
}

type Row = {
  id?: number;
  created_at: string;
  active_power: any; // W
};

const wToKw = (w: number) => w / 1000;

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

export function Generation({ cpf }: GenerationProps) {
  const [currentW, setCurrentW] = useState(0); // potência atual (W)
  const [todayKwh, setTodayKwh] = useState(0); // geração do dia (kWh)
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

  const fetchPersonName = async () => {
    if (!cpf) return;
    setLoadingName(true);

    const { data, error } = await supabase
      .from("clientes")
      .select("name")
      .eq("cpf", cpf)
      .limit(1);

    if (!error && data && data.length > 0) {
      setPersonName(data[0]?.name || "");
    } else {
      setPersonName("");
    }

    setLoadingName(false);
  };

  const fetchGeneration = async () => {
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

    // últimas leituras (para gráfico)
    const { data, error } = await supabase
      .from("geracao")
      .select("id,created_at,active_power")
      .eq("user_cpf", cpf)
      .order("created_at", { ascending: false })
      .limit(24);

    if (error) {
      console.error("Generation geracao error:", error);
      setDbError(error.message || "Erro ao consultar geracao");
      setChartRows([]);
      setCurrentW(0);
      setTodayKwh(0);
      setLoading(false);
      return;
    }

    const rows = (data as Row[]) || [];

    if (rows.length > 0) {
      const newest = rows[0];
      setCurrentW(toNum(newest.active_power));

      // gráfico em ordem crescente
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

    // início do dia local
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("geracao")
      .select("created_at,active_power")
      .eq("user_cpf", cpf)
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: true })
      .limit(100000); // ✅ mantém alto (amostra a cada 10s)

    if (error) {
      console.error("fetchTodayKwh error:", error);
      return;
    }

    const rows = (data || []) as { created_at: string; active_power: any }[];
    const kwh = integrateKwhFromRows(rows); // ✅ cálculo unificado
    setTodayKwh(Number(kwh.toFixed(3)));
  };

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
    fetchGeneration();
    fetchTodayKwh();

    // kWh do dia (mais leve)
    kwhPollId = window.setInterval(() => {
      fetchTodayKwh();
    }, 30000);

    // realtime
    sub = supabase
      .channel(`realtime-generation-${cpf}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "geracao",
          filter: `user_cpf=eq.${cpf}`,
        },
        (payload: any) => {
          const n: Row | null = payload?.new ?? null;
          if (!n?.created_at) return;

          setCurrentW(toNum(n.active_power));
          setDbError("");

          setChartRows((prev) => {
            const map = new Map<number, Row>();
            for (const r of prev) {
              if (r.id != null) map.set(r.id, r);
            }
            if (n.id != null) map.set(n.id, n);

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
  }, [cpf]);

  const chartData = useMemo(() => {
    if (!chartRows.length) return [];
    return chartRows.map((r) => ({
      ts: r.created_at,
      label: fmtAxis(r.created_at),
      value: Number(wToKw(toNum(r.active_power)).toFixed(3)),
    }));
  }, [chartRows]);

  if (!cpf) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col mb-6">
          <h2 className="text-2xl font-bold text-white">Geração de Energia</h2>
          <div className="flex items-center gap-2 text-green-400 text-xs mt-1">
            <User className="w-3 h-3" />
            <span>Cliente: Aguardando seleção...</span>
          </div>
        </div>

        <div className="bg-[#1a2942] rounded-2xl p-10 text-center border border-dashed border-gray-700">
          <p className="text-gray-500 text-sm">
            Insira o CPF no painel principal para carregar os dados solares.
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
        <h2 className="text-2xl font-bold text-white">Geração de Energia</h2>

        <div className="flex items-center gap-2 text-green-400 text-xs mt-1">
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
      <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-2xl p-6 shadow-lg shadow-green-500/20">
        <div className="flex items-center gap-3 mb-2">
          <Sun className="w-8 h-8 text-white" />
          <span className="text-white/80 font-medium">
            Potência Solar Atual
          </span>
        </div>

        <p className="text-5xl font-bold text-white mb-1">
          {wToKw(currentW).toFixed(3)} <span className="text-xl">kW</span>
        </p>
        <p className="text-white/80 text-sm">
          Medida instantânea (não acumulada)
        </p>
      </div>

      {/* Card: Geração do dia (kWh) */}
      <div className="bg-[#1a2942] rounded-2xl p-4 border border-green-500/20">
        <div className="text-xs text-gray-400">Geração de hoje</div>
        <div className="text-2xl font-bold text-green-300 mt-1">
          {todayKwh.toFixed(2)}{" "}
          <span className="text-xs text-gray-400">kWh</span>
        </div>
        <div className="text-[11px] text-gray-500 mt-1">
          Calculado pela soma ao longo do tempo usando potência (W) das medições
          do dia.
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
                  itemStyle={{ color: "#22c55e" }}
                />
                <Bar
                  dataKey="value"
                  fill="#22c55e"
                  radius={[4, 4, 0, 0]}
                  barSize={26}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              Sem dados de geração para este CPF.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

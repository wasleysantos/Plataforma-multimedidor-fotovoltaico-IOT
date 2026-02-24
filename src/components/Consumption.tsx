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

interface ConsumptionProps {
  cpf: string; // (já vem limpo do Dashboard)
}

type Row = {
  id?: number;
  timestamp: string;
  house_consumption: any; // W (ou kW dependendo do seu backend — veja observação abaixo)
};

const toNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const tsToMs = (ts: string) => {
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : NaN;
};

// ✅ Se seu house_consumption estiver em W, use isso (igual geração)
// ✅ Se ele já estiver em kW, troque para: const wToKw = (w: number) => w;
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

// integra potência (W) => kWh pelo método do trapézio
function integrateKwh(
  rowsAsc: { timestamp: string; house_consumption: any }[],
) {
  if (!rowsAsc || rowsAsc.length < 2) return 0;

  let kwh = 0;
  for (let i = 1; i < rowsAsc.length; i++) {
    const a = rowsAsc[i - 1];
    const b = rowsAsc[i];

    const t0 = tsToMs(a.timestamp);
    const t1 = tsToMs(b.timestamp);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;

    const dtHours = Math.max(0, (t1 - t0) / 3600000);

    const p0w = Math.max(0, toNum(a.house_consumption));
    const p1w = Math.max(0, toNum(b.house_consumption));

    const pAvgKw = (p0w + p1w) / 2 / 1000;
    kwh += pAvgKw * dtHours;
  }
  return kwh;
}

export function Consumption({ cpf }: ConsumptionProps) {
  const [currentW, setCurrentW] = useState(0); // potência atual (W)
  const [todayKwh, setTodayKwh] = useState(0); // consumo do dia (kWh)
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
      .from("customers")
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
      .from("measurements")
      .select("id,timestamp,house_consumption")
      .eq("user_cpf", cpf)
      .order("timestamp", { ascending: false })
      .limit(24);

    if (error) {
      console.error("Consumption measurements error:", error);
      setDbError(error.message || "Erro ao consultar measurements");
      setChartRows([]);
      setCurrentW(0);
      setTodayKwh(0);
      setLoading(false);
      return;
    }

    const rows = (data as Row[]) || [];

    if (rows.length > 0) {
      const newest = rows[0];
      setCurrentW(toNum(newest.house_consumption));

      const asc = [...rows]
        .filter((r) => Number.isFinite(tsToMs(r.timestamp)))
        .sort((a, b) => tsToMs(a.timestamp) - tsToMs(b.timestamp));

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
      .from("measurements")
      .select("timestamp,house_consumption")
      .eq("user_cpf", cpf)
      .gte("timestamp", start.toISOString())
      .order("timestamp", { ascending: true })
      .limit(5000);

    if (error) {
      console.error("fetchTodayConsumptionKwh error:", error);
      return;
    }

    const rows = (data || []) as {
      timestamp: string;
      house_consumption: any;
    }[];
    const kwh = integrateKwh(rows);
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

    // kWh do dia (mais leve)
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
          table: "measurements",
          filter: `user_cpf=eq.${cpf}`,
        },
        (payload: any) => {
          const n: Row | null = payload?.new ?? null;
          if (!n?.timestamp) return;

          setCurrentW(toNum(n.house_consumption));
          setDbError("");

          setChartRows((prev) => {
            const map = new Map<number, Row>();
            for (const r of prev) {
              if (r.id != null) map.set(r.id, r);
            }
            if (n.id != null) map.set(n.id, n);

            const arr = Array.from(map.values())
              .filter((r) => Number.isFinite(tsToMs(r.timestamp)))
              .sort((a, b) => tsToMs(a.timestamp) - tsToMs(b.timestamp));

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
      ts: r.timestamp,
      label: fmtAxis(r.timestamp),
      value: Number(wToKw(toNum(r.house_consumption)).toFixed(3)), // kW no gráfico
    }));
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

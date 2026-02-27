import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { supabase } from "../lib/supabase";

type Row = {
  id: number;
  created_at: string;
  active_power: any; // kW (potência) (mantive comentário do seu código)
};

type RangeKey = "24h" | "7d" | "30d";
type Mode = "KW" | "BRL_ECON";

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function hoursForRange(r: RangeKey) {
  if (r === "24h") return 24;
  if (r === "7d") return 24 * 7;
  return 24 * 30;
}

function tsToMs(ts: string) {
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function sinceIso(range: RangeKey) {
  const h = hoursForRange(range);
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

function inWindow(ts: string, range: RangeKey) {
  const ms = tsToMs(ts);
  if (!Number.isFinite(ms)) return false;
  const cutoff = Date.now() - hoursForRange(range) * 60 * 60 * 1000;
  return ms >= cutoff;
}

function fmtAxis(ts: string, range: RangeKey) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--";

  if (range === "24h") {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(d);
}

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

function buildSeries(points: { ts: string; genKw: number }[], tarifa: number) {
  let kwhAcum = 0;

  return points.map((p, i) => {
    if (i === 0) {
      return { ts: p.ts, label: "", gen_kw: p.genKw, brl_econ: 0 };
    }

    const t0 = tsToMs(points[i - 1].ts);
    const t1 = tsToMs(p.ts);
    const dtHours = Math.max(0, (t1 - t0) / (1000 * 60 * 60));

    const g0 = points[i - 1].genKw;
    const g1 = p.genKw;

    const incKwh = ((g0 + g1) / 2) * dtHours;
    kwhAcum += incKwh;

    return {
      ts: p.ts,
      label: "",
      gen_kw: p.genKw,
      brl_econ: Number((kwhAcum * tarifa).toFixed(2)),
    };
  });
}

const FALLBACK_TARIFA_MA = 0.85;

export function PowerChart({ cpf }: { cpf: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [dbError, setDbError] = useState("");

  const [range, setRange] = useState<RangeKey>("24h");
  const [mode, setMode] = useState<Mode>("KW");

  const [tarifaKwh, setTarifaKwh] = useState<number>(FALLBACK_TARIFA_MA);
  const [tarifaLoading, setTarifaLoading] = useState(false);
  const [tarifaError, setTarifaError] = useState("");

  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  useEffect(() => {
    const fetchTarifa = async () => {
      if (!cpf) {
        setTarifaKwh(FALLBACK_TARIFA_MA);
        setTarifaError("");
        setTarifaLoading(false);
        return;
      }

      setTarifaLoading(true);
      setTarifaError("");

      const { data, error } = await supabase
        .from("clientes")
        .select("tarifa_kwh")
        .eq("cpf", cpf)
        .maybeSingle();

      if (error) {
        setTarifaKwh(FALLBACK_TARIFA_MA);
        setTarifaError(error.message || "Erro ao buscar tarifa");
        setTarifaLoading(false);
        return;
      }

      const t = Number(data?.tarifa_kwh);
      const ok = Number.isFinite(t) && t > 0;

      setTarifaKwh(ok ? t : FALLBACK_TARIFA_MA);
      setTarifaLoading(false);
    };

    fetchTarifa();
  }, [cpf]);

  useEffect(() => {
    const fetchChart = async () => {
      if (!cpf) {
        setRows([]);
        setDbError("");
        setLoading(false);
        return;
      }

      setLoading(true);
      setDbError("");

      const since = sinceIso(range);

      const { data, error } = await supabase
        .from("geracao")
        .select("id,created_at,active_power") // ✅ removido house_consumption
        .eq("user_cpf", cpf)
        .gte("created_at", since)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("PowerChart geracao error:", error);
        setDbError(error.message || "Erro ao consultar geracao");
        setRows([]);
        setLoading(false);
        return;
      }

      setRows((data as Row[]) || []);
      setLoading(false);
    };

    fetchChart();
  }, [cpf, range]);

  useEffect(() => {
    if (!cpf) return;

    const channel = supabase
      .channel(`realtime-powerchart-${cpf}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "geracao",
          filter: `user_cpf=eq.${cpf}`,
        },
        (payload: any) => {
          const r: Row | null = payload?.new ?? null;
          if (!r?.id) return;

          const currentRange = rangeRef.current;

          if (!inWindow(r.created_at, currentRange)) {
            setRows((prev) => prev.filter((x) => x.id !== r.id));
            return;
          }

          setRows((prev) => {
            const map = new Map<number, Row>();
            for (const x of prev) map.set(x.id, x);
            map.set(r.id, r);

            const ordered = Array.from(map.values())
              .filter((x) => Number.isFinite(tsToMs(x.created_at)))
              .sort((a, b) => tsToMs(a.created_at) - tsToMs(b.created_at));

            const cutoff =
              Date.now() - hoursForRange(currentRange) * 60 * 60 * 1000;

            return ordered.filter((x) => tsToMs(x.created_at) >= cutoff);
          });

          setDbError("");
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [cpf]);

  const chartData = useMemo(() => {
    if (!rows || rows.length === 0) return [];

    const ordered = [...rows]
      .filter((r) => Number.isFinite(tsToMs(r.created_at)))
      .sort((a, b) => tsToMs(a.created_at) - tsToMs(b.created_at));

    const points = ordered.map((r) => ({
      ts: r.created_at,
      genKw: Math.max(0, toNum(r.active_power)),
    }));

    const series = buildSeries(points, tarifaKwh || 0);

    return series.map((s) => ({
      ...s,
      label: fmtAxis(s.ts, range),
    }));
  }, [rows, tarifaKwh, range]);

  const ZoomButton = ({ k, label }: { k: RangeKey; label: string }) => (
    <button
      type="button"
      onClick={() => setRange(k)}
      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors border ${
        range === k
          ? "bg-green-500/20 text-green-300 border-green-500/40"
          : "bg-transparent text-gray-300 border-gray-700 hover:bg-white/5"
      }`}
    >
      {label}
    </button>
  );

  const ModeButton = ({ m, label }: { m: Mode; label: string }) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors border ${
        mode === m
          ? "bg-blue-500/20 text-blue-200 border-blue-500/40"
          : "bg-transparent text-gray-300 border-gray-700 hover:bg-white/5"
      }`}
    >
      {label}
    </button>
  );

  if (!cpf) {
    return (
      <div className="h-20 flex items-center justify-center text-gray-600 text-xs">
        Selecione um CPF para ver o gráfico.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-20 flex items-center justify-center text-gray-400 text-xs animate-pulse">
        Carregando gráfico...
      </div>
    );
  }

  if (dbError) {
    return (
      <div className="h-20 flex items-center justify-center text-red-400 text-xs">
        Erro no gráfico: {dbError}
      </div>
    );
  }

  if (chartData.length === 0) {
    const label =
      range === "24h" ? "24 horas" : range === "7d" ? "7 dias" : "30 dias";
    return (
      <div className="h-20 flex flex-col gap-2 items-center justify-center text-gray-600 text-xs">
        <div>Sem dados nas últimas {label}.</div>
        <div className="flex gap-2">
          <ZoomButton k="24h" label="24h" />
          <ZoomButton k="7d" label="7d" />
          <ZoomButton k="30d" label="30d" />
        </div>
      </div>
    );
  }

  const yKey = mode === "KW" ? "gen_kw" : "brl_econ";

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2 gap-3">
        <div className="text-[11px] text-gray-400">
          <span className="ml-3">
            Tarifa Média Equatorial Maranhão:{" "}
            <span className="text-gray-200 font-semibold">
              {tarifaLoading
                ? "Carregando..."
                : `R$ ${tarifaKwh.toFixed(2)}/kWh`}
            </span>
          </span>
        </div>

        <div className="flex gap-2">
          <ZoomButton k="24h" label="24h" />
          <ZoomButton k="7d" label="7d" />
          <ZoomButton k="30d" label="30d" />
        </div>
      </div>

      <div className="flex items-center justify-between mb-2 gap-3">
        <div className="flex gap-2">
          <ModeButton m="KW" label="kW" />
          <ModeButton m="BRL_ECON" label="Economia em R$" />
        </div>

        <div className="text-[11px] text-gray-500 text-right">
          Período:{" "}
          <span className="text-gray-200 font-semibold">
            {range === "24h" ? "24h" : range === "7d" ? "7 dias" : "30 dias"}
          </span>
        </div>
      </div>

      {tarifaError && (
        <div className="text-[11px] text-yellow-400 mb-2">{tarifaError}</div>
      )}

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="mainGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.1} />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="label"
            stroke="#64748b"
            style={{ fontSize: "12px" }}
            tickLine={false}
            interval="preserveStartEnd"
          />

          <YAxis
            stroke="#64748b"
            style={{ fontSize: "12px" }}
            tickLine={false}
            tickFormatter={(value) =>
              mode === "BRL_ECON"
                ? `R$ ${Number(value).toFixed(0)}`
                : Number(value).toFixed(1)
            }
          />

          <Tooltip
            labelFormatter={(_, payload) => {
              const ts = payload?.[0]?.payload?.ts;
              return ts
                ? `Atualizado em: ${fmtTooltip(ts)}`
                : "Atualizado em: --";
            }}
            formatter={(value: any) => {
              if (mode === "KW")
                return [`${Number(value).toFixed(2)} kW`, "Geração"];
              return [`R$ ${Number(value).toFixed(2)}`, "Economizado (acum.)"];
            }}
            contentStyle={{
              backgroundColor: "#1a2942",
              border: "1px solid #334155",
              borderRadius: "8px",
              color: "#fff",
            }}
          />

          <Legend
            wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }}
            iconType="line"
          />

          <Area
            type="monotone"
            dataKey={yKey}
            name={mode === "KW" ? "Geração (kW)" : "Economia em R$ (acum.)"}
            stroke="#22c55e"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#mainGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

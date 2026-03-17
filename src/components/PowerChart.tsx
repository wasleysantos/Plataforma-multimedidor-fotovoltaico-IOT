import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type GenRow = {
  id: number;
  created_at: string;
  active_power: any;
};

type ConsRow = {
  id: number;
  created_at: string;
  active_power: any;
};

type RangeKey = "24h" | "30d";

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function hoursForRange(r: RangeKey) {
  return r === "24h" ? 24 : 24 * 30;
}

function tsToMs(ts: string) {
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function sinceIso(range: RangeKey) {
  const h = hoursForRange(range);
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
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

export function PowerChart({ cpf }: { cpf: string }) {
  const [genRows, setGenRows] = useState<GenRow[]>([]);
  const [consRows, setConsRows] = useState<ConsRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [dbError, setDbError] = useState("");

  // padrão 30 dias
  const [range, setRange] = useState<RangeKey>("30d");

  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  const cpfVariants = useMemo(() => {
    const clean = normalizeCpf(cpf);
    if (!clean) return [];
    const masked = maskCPF(clean);
    return Array.from(new Set([clean, masked]));
  }, [cpf]);

  const fetchChart = useCallback(async () => {
    if (!cpf) {
      setGenRows([]);
      setConsRows([]);
      setDbError("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setDbError("");

    const since = sinceIso(rangeRef.current);
    const variants = cpfVariants.length ? cpfVariants : [cpf];

    const [genRes, consRes] = await Promise.all([
      supabase
        .from("geracao")
        .select("id,created_at,active_power")
        .in("user_cpf", variants)
        .gte("created_at", since)
        .order("created_at", { ascending: true }),

      supabase
        .from("consumo")
        .select("id,created_at,active_power")
        .in("user_cpf", variants)
        .gte("created_at", since)
        .order("created_at", { ascending: true }),
    ]);

    if (genRes.error || consRes.error) {
      console.error("PowerChart error:", genRes.error || consRes.error);
      setDbError(
        genRes.error?.message ||
          consRes.error?.message ||
          "Erro ao consultar geracao/consumo",
      );
      setGenRows([]);
      setConsRows([]);
      setLoading(false);
      return;
    }

    setGenRows((genRes.data as GenRow[]) || []);
    setConsRows((consRes.data as ConsRow[]) || []);
    setLoading(false);
  }, [cpf, cpfVariants]);

  useEffect(() => {
    fetchChart();
  }, [fetchChart, range]);

  useEffect(() => {
    if (!cpf) return;

    const channels: any[] = [];
    const variants = cpfVariants.length ? cpfVariants : [cpf];

    const subscribeTable = (table: "geracao" | "consumo", userCpf: string) => {
      const channel = supabase
        .channel(`realtime-${table}-${userCpf}-${rangeRef.current}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter: `user_cpf=eq.${userCpf}`,
          },
          async () => {
            await fetchChart();
          },
        )
        .subscribe();

      channels.push(channel);
    };

    for (const v of variants) {
      subscribeTable("geracao", v);
      subscribeTable("consumo", v);
    }

    return () => {
      for (const ch of channels) {
        supabase.removeChannel(ch);
      }
    };
  }, [cpf, cpfVariants, fetchChart]);

  const chartData = useMemo(() => {
    const g = [...(genRows || [])]
      .filter((r) => Number.isFinite(tsToMs(r.created_at)))
      .sort((a, b) => tsToMs(a.created_at) - tsToMs(b.created_at))
      .map((r) => ({
        ts: r.created_at,
        gen: Math.max(0, toNum(r.active_power)),
      }));

    const c = [...(consRows || [])]
      .filter((r) => Number.isFinite(tsToMs(r.created_at)))
      .sort((a, b) => tsToMs(a.created_at) - tsToMs(b.created_at))
      .map((r) => ({
        ts: r.created_at,
        cons: Math.max(0, toNum(r.active_power)),
      }));

    if (g.length === 0 && c.length === 0) return [];

    const map = new Map<string, { ts: string; gen?: number; cons?: number }>();

    for (const x of g) {
      map.set(x.ts, { ...(map.get(x.ts) || { ts: x.ts }), gen: x.gen });
    }

    for (const x of c) {
      map.set(x.ts, { ...(map.get(x.ts) || { ts: x.ts }), cons: x.cons });
    }

    const merged = Array.from(map.values()).sort(
      (a, b) => tsToMs(a.ts) - tsToMs(b.ts),
    );

    let lastGen = 0;
    let lastCons = 0;

    return merged.map((m) => {
      if (typeof m.gen === "number") lastGen = m.gen;
      if (typeof m.cons === "number") lastCons = m.cons;

      return {
        ts: m.ts,
        label: fmtAxis(m.ts, range),
        gen_w: lastGen,
        cons_w: lastCons,
      };
    });
  }, [genRows, consRows, range]);

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
    const label = range === "24h" ? "24 horas" : "30 dias";

    return (
      <div className="h-20 flex flex-col gap-2 items-center justify-center text-gray-600 text-xs">
        <div>Sem dados nas últimas {label}.</div>
        <div className="flex gap-2">
          <ZoomButton k="24h" label="24h" />
          <ZoomButton k="30d" label="30d" />
        </div>
      </div>
    );
  }

  const yTick = (value: any) => `${Number(value).toFixed(0)} W`;

  return (
    <div className="w-full">
      <div className="flex items-center justify-end mb-2 gap-2">
        <ZoomButton k="24h" label="24h" />
        <ZoomButton k="30d" label="30d" />
      </div>

      <div className="flex items-center justify-end mb-2">
        <div className="text-[11px] text-gray-500 text-right">
          Período:{" "}
          <span className="text-gray-200 font-semibold">
            {range === "24h" ? "24h" : "30 dias"}
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="genGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.1} />
            </linearGradient>

            <linearGradient id="consGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.7} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.08} />
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
            tickFormatter={yTick}
          />

          <Tooltip
            labelFormatter={(_, payload) => {
              const ts = payload?.[0]?.payload?.ts;
              return ts
                ? `Atualizado em: ${fmtTooltip(ts)}`
                : "Atualizado em: --";
            }}
            formatter={(value: any, name: string) => [
              `${Number(value).toFixed(0)} W`,
              name,
            ]}
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
            dataKey="gen_w"
            name="Geração (W)"
            stroke="#22c55e"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#genGradient)"
          />

          <Area
            type="monotone"
            dataKey="cons_w"
            name="Consumo (W)"
            stroke="#f59e0b"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#consGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
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

type GenRow = {
  id: number;
  created_at: string;
  active_power: any; // potência (W ou kW, depende do seu banco)
};

type ConsRow = {
  id: number;
  created_at: string;
  active_power: any; // potência (W ou kW, depende do seu banco)
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

// ===== CPF variants (limpo + mascarado) =====
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

type Point = { ts: string; genKw: number; consKw: number };

function buildSeries(points: Point[], tarifa: number) {
  // economia acumulada baseada apenas em geração (mantém seu comportamento)
  let kwhAcum = 0;

  return points.map((p, i) => {
    if (i === 0) {
      return {
        ts: p.ts,
        label: "",
        gen_kw: p.genKw,
        cons_kw: p.consKw,
        brl_econ: 0,
      };
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
      cons_kw: p.consKw,
      brl_econ: Number((kwhAcum * tarifa).toFixed(2)),
    };
  });
}

const FALLBACK_TARIFA_MA = 0.85;

export function PowerChart({ cpf }: { cpf: string }) {
  const [genRows, setGenRows] = useState<GenRow[]>([]);
  const [consRows, setConsRows] = useState<ConsRow[]>([]);
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

  const cpfVariants = useMemo(() => {
    const clean = normalizeCpf(cpf);
    if (!clean) return [];
    const masked = maskCPF(clean);
    return Array.from(new Set([clean, masked]));
  }, [cpf]);

  // Tarifa
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

      const clean = normalizeCpf(cpf);

      const { data, error } = await supabase
        .from("clientes")
        .select("tarifa_kwh")
        .eq("cpf", clean)
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

  // Fetch gráfico (GERAÇÃO + CONSUMO)
  useEffect(() => {
    const fetchChart = async () => {
      if (!cpf) {
        setGenRows([]);
        setConsRows([]);
        setDbError("");
        setLoading(false);
        return;
      }

      setLoading(true);
      setDbError("");

      const since = sinceIso(range);
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
    };

    fetchChart();
  }, [cpf, range, cpfVariants]);

  // Realtime: channels para CPF limpo e mascarado (se forem diferentes)
  useEffect(() => {
    if (!cpf) return;

    const variants = cpfVariants.length ? cpfVariants : [cpf];
    const channels: any[] = [];

    const subTable = (table: "geracao" | "consumo", userCpf: string) => {
      const ch = supabase
        .channel(`realtime-powerchart-${table}-${userCpf}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter: `user_cpf=eq.${userCpf}`,
          },
          (payload: any) => {
            const r = payload?.new;
            if (!r?.id || !r?.created_at) return;

            const currentRange = rangeRef.current;

            if (!inWindow(r.created_at, currentRange)) {
              if (table === "geracao") {
                setGenRows((prev) => prev.filter((x) => x.id !== r.id));
              } else {
                setConsRows((prev) => prev.filter((x) => x.id !== r.id));
              }
              return;
            }

            const upsert = <T extends { id: number; created_at: string }>(
              prev: T[],
            ) => {
              const map = new Map<number, T>();
              for (const x of prev) map.set(x.id, x);
              map.set(r.id, r as T);

              const ordered = Array.from(map.values())
                .filter((x) => Number.isFinite(tsToMs(x.created_at)))
                .sort((a, b) => tsToMs(a.created_at) - tsToMs(b.created_at));

              const cutoff =
                Date.now() - hoursForRange(currentRange) * 60 * 60 * 1000;

              return ordered.filter((x) => tsToMs(x.created_at) >= cutoff);
            };

            if (table === "geracao") setGenRows((prev) => upsert(prev));
            else setConsRows((prev) => upsert(prev));

            setDbError("");
          },
        )
        .subscribe();

      channels.push(ch);
    };

    for (const v of variants) {
      subTable("geracao", v);
      subTable("consumo", v);
    }

    return () => {
      for (const ch of channels) supabase.removeChannel(ch);
    };
  }, [cpf, cpfVariants]);

  // Monta dados do gráfico (merge por timestamp + forward-fill)
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
    for (const x of g)
      map.set(x.ts, { ...(map.get(x.ts) || { ts: x.ts }), gen: x.gen });
    for (const x of c)
      map.set(x.ts, { ...(map.get(x.ts) || { ts: x.ts }), cons: x.cons });

    const merged = Array.from(map.values()).sort(
      (a, b) => tsToMs(a.ts) - tsToMs(b.ts),
    );

    let lastGen = 0;
    let lastCons = 0;

    const points: Point[] = merged.map((m) => {
      if (typeof m.gen === "number") lastGen = m.gen;
      if (typeof m.cons === "number") lastCons = m.cons;
      return { ts: m.ts, genKw: lastGen, consKw: lastCons };
    });

    const series = buildSeries(points, tarifaKwh || 0);

    return series.map((s) => ({
      ...s,
      label: fmtAxis(s.ts, range),
    }));
  }, [genRows, consRows, tarifaKwh, range]);

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

  const yTick = (value: any) =>
    mode === "BRL_ECON"
      ? `R$ ${Number(value).toFixed(0)}`
      : Number(value).toFixed(1);

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
            {/* Geração */}
            <linearGradient id="genGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.1} />
            </linearGradient>

            {/* Consumo */}
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
            formatter={(value: any, name: string) => {
              if (mode === "BRL_ECON")
                return [`R$ ${Number(value).toFixed(2)}`, name];
              return [`${Number(value).toFixed(2)} kW`, name];
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

          {mode === "BRL_ECON" ? (
            <Area
              type="monotone"
              dataKey="brl_econ"
              name="Economia (acum.)"
              stroke="#22c55e"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#genGradient)"
            />
          ) : (
            <>
              <Area
                type="monotone"
                dataKey="gen_kw"
                name="Geração (kW)"
                stroke="#22c55e"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#genGradient)"
              />

              <Area
                type="monotone"
                dataKey="cons_kw"
                name="Consumo (kW)"
                stroke="#f59e0b"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#consGradient)"
              />
            </>
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

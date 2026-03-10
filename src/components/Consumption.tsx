import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Zap, User, AlertCircle, Calendar } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { integrateKwhFromRows, toNum } from "./EnergyCalc";

interface ConsumptionProps {
  cpf: string;
}

const TABLE_CONSUMO = "consumo";

type Row = {
  id?: string | number;
  created_at: string;
  active_power: any;
};

function formatCpfFromDigits(v: string) {
  const d = (v || "").replace(/\D/g, "").slice(0, 11);
  if (d.length !== 11) return "";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

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

function startIsoFromDateInput(dateStr: string) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  return dt.toISOString();
}

function endIsoFromDateInput(dateStr: string) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
  return dt.toISOString();
}

function fmtDatePtBr(dateStr: string) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
}

function formatDateTime(value?: string | null) {
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
}

export function Consumption({ cpf }: ConsumptionProps) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [currentW, setCurrentW] = useState(0);
  const [periodKwh, setPeriodKwh] = useState(0);
  const [chartRows, setChartRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState("");

  const [personName, setPersonName] = useState("");
  const [loadingName, setLoadingName] = useState(false);

  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);

  const [lastConsUpdate, setLastConsUpdate] = useState("—");

  const cpfRef = useRef(cpf);
  useEffect(() => {
    cpfRef.current = cpf;
  }, [cpf]);

  const cpfFmt = useMemo(() => formatCpfFromDigits(cpf), [cpf]);

  const cpfVariants = useMemo(() => {
    return cpfFmt ? [cpf, cpfFmt] : [cpf];
  }, [cpf, cpfFmt]);

  const period = useMemo(() => {
    const valid =
      !!startDate &&
      !!endDate &&
      Number.isFinite(Date.parse(startDate)) &&
      Number.isFinite(Date.parse(endDate)) &&
      Date.parse(startDate) <= Date.parse(endDate);

    if (!valid) {
      return {
        since: "",
        until: "",
        label: "Período inválido",
        invalid: true,
      };
    }

    return {
      since: startIsoFromDateInput(startDate),
      until: endIsoFromDateInput(endDate),
      label: `${fmtDatePtBr(startDate)} → ${fmtDatePtBr(endDate)}`,
      invalid: false,
    };
  }, [startDate, endDate]);

  const isTodayPeriod = useMemo(() => {
    return startDate === todayStr && endDate === todayStr;
  }, [startDate, endDate, todayStr]);

  const fetchPersonName = async () => {
    if (!cpf) return;
    setLoadingName(true);

    const { data, error } = await supabase
      .from("clientes")
      .select("name")
      .eq("cpf", cpf)
      .maybeSingle();

    if (!error && data) setPersonName(data?.name || "");
    else setPersonName("");

    setLoadingName(false);
  };

  const fetchLastConsUpdate = async () => {
    if (!cpf) {
      setLastConsUpdate("—");
      return;
    }

    const { data, error } = await supabase
      .from(TABLE_CONSUMO)
      .select("created_at")
      .in("user_cpf", cpfVariants)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      setLastConsUpdate("—");
      return;
    }

    setLastConsUpdate(formatDateTime(data?.[0]?.created_at ?? null));
  };

  const fetchConsumptionByPeriod = async () => {
    if (!cpf || period.invalid) {
      setLoading(false);
      setDbError("");
      setChartRows([]);
      setCurrentW(0);
      setPeriodKwh(0);
      return;
    }

    setLoading(true);
    setDbError("");

    const { data, error } = await supabase
      .from(TABLE_CONSUMO)
      .select("id,created_at,active_power")
      .in("user_cpf", cpfVariants)
      .gte("created_at", period.since)
      .lte("created_at", period.until)
      .order("created_at", { ascending: true })
      .limit(100000);

    if (error) {
      console.error("Consumption error:", error);
      setDbError(error.message || `Erro ao consultar ${TABLE_CONSUMO}`);
      setChartRows([]);
      setCurrentW(0);
      setPeriodKwh(0);
      setLoading(false);
      return;
    }

    const rows = ((data || []) as Row[]).filter((r) =>
      Number.isFinite(tsToMsSafe(r.created_at)),
    );

    setChartRows(rows);

    if (rows.length > 0) {
      const newest = rows[rows.length - 1];
      setCurrentW(Math.max(0, toNum(newest.active_power)));
    } else {
      setCurrentW(0);
    }

    const kwh = integrateKwhFromRows(rows);
    setPeriodKwh(Number(kwh.toFixed(3)));

    setLoading(false);
  };

  useEffect(() => {
    if (!cpf) {
      setLoading(false);
      setChartRows([]);
      setCurrentW(0);
      setPeriodKwh(0);
      setDbError("");
      setPersonName("");
      setLastConsUpdate("—");
      return;
    }

    fetchPersonName();
    fetchConsumptionByPeriod();
    fetchLastConsUpdate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpf, period.since, period.until, period.invalid, cpfFmt]);

  useEffect(() => {
    if (!cpf || period.invalid) return;

    let sub: any = null;
    let pollId: number | null = null;
    let lastUpdatePollId: number | null = null;

    if (isTodayPeriod) {
      sub = supabase
        .channel(`realtime-consumption-${cpf}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: TABLE_CONSUMO,
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

            setDbError("");
            setLastConsUpdate(formatDateTime(row.created_at));
            setCurrentW(Math.max(0, toNum(row.active_power)));

            setChartRows((prev) => {
              const merged = [...prev, row];
              const unique = Array.from(
                new Map(
                  merged.map((item, index) => [
                    item.id != null
                      ? String(item.id)
                      : `${item.created_at}-${index}`,
                    item,
                  ]),
                ).values(),
              )
                .filter((r) => Number.isFinite(tsToMsSafe(r.created_at)))
                .sort(
                  (a, b) => tsToMsSafe(a.created_at) - tsToMsSafe(b.created_at),
                );

              const kwh = integrateKwhFromRows(unique);
              setPeriodKwh(Number(kwh.toFixed(3)));

              return unique;
            });
          },
        )
        .subscribe();

      pollId = window.setInterval(() => {
        fetchConsumptionByPeriod();
      }, 30000);
    } else {
      pollId = window.setInterval(() => {
        fetchConsumptionByPeriod();
      }, 30000);
    }

    lastUpdatePollId = window.setInterval(() => {
      fetchLastConsUpdate();
    }, 5000);

    return () => {
      if (sub) supabase.removeChannel(sub);
      if (pollId) window.clearInterval(pollId);
      if (lastUpdatePollId) window.clearInterval(lastUpdatePollId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpf, cpfFmt, isTodayPeriod, period.invalid, period.since, period.until]);

  const chartData = useMemo(() => {
    if (!chartRows.length) return [];

    let rowsForChart = [...chartRows];

    if (isTodayPeriod) {
      rowsForChart = rowsForChart.slice(-30);
    }

    return rowsForChart.map((r) => {
      const w = Math.max(0, toNum(r.active_power));
      return {
        ts: r.created_at,
        label: fmtAxis(r.created_at),
        valueW: Number(w.toFixed(0)),
      };
    });
  }, [chartRows, isTodayPeriod]);

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

        <div className="flex flex-wrap items-end gap-3 mt-3 bg-white/5 border border-gray-800 rounded-xl p-3">
          <div className="flex flex-col">
            <label className="text-[11px] text-gray-300 mb-1">
              Selecionar período:
            </label>

            <label className="text-[11px] text-gray-400 mb-1">Início</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-[#1a2942] text-white text-sm px-3 py-2 rounded-lg border border-gray-700 outline-none"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-[11px] text-gray-400 mb-1">
              <br />
            </label>
            <label className="text-[11px] text-gray-400 mb-1">Fim</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-[#1a2942] text-white text-sm px-3 py-2 rounded-lg border border-gray-700 outline-none"
            />
          </div>

          <div className="flex items-center gap-2 text-[11px] text-gray-400 pb-1">
            <Calendar className="w-4 h-4 text-blue-400" />
            <span>{period.label}</span>
          </div>
        </div>

        {cpf && (
          <div className="flex flex-col gap-0.5 text-[11px] text-gray-500 mt-2">
            <div>
              Último consumo:{" "}
              <span className="text-blue-400 font-medium">
                {lastConsUpdate}
              </span>
            </div>
          </div>
        )}

        {dbError && (
          <div className="flex items-center gap-1 mt-2 text-red-400 text-[10px] font-bold uppercase tracking-wider">
            <AlertCircle className="w-3 h-3" />
            <span>Erro:</span> {dbError}
          </div>
        )}

        {period.invalid && (
          <div className="flex items-center gap-1 mt-2 text-yellow-400 text-[10px] font-bold uppercase tracking-wider">
            <AlertCircle className="w-3 h-3" />
            Período inválido
          </div>
        )}
      </div>

      <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-6 shadow-lg shadow-blue-500/20">
        <div className="flex items-center gap-3 mb-2">
          <Zap className="w-8 h-8 text-white" />
          <span className="text-white/80 font-medium">Consumo Atual</span>
        </div>

        <p className="text-5xl font-bold text-white mb-1">
          {currentW.toFixed(0)} <span className="text-xl">W</span>
        </p>
        <p className="text-white/80 text-sm">
          {isTodayPeriod
            ? "Medida instantânea em tempo real"
            : "Última potência registrada dentro do período selecionado"}
        </p>
      </div>

      <div className="bg-[#1a2942] rounded-2xl p-4 border border-blue-500/20">
        <div className="text-xs text-gray-400">
          Consumo acumulado no período
        </div>
        <div className="text-2xl font-bold text-blue-300 mt-1">
          {periodKwh.toFixed(2)}{" "}
          <span className="text-xs text-gray-400">kWh</span>
        </div>
        <div className="text-[11px] text-gray-500 mt-1">
          Período: {period.label}
        </div>

        <div className="h-[220px] w-full">
          {!period.invalid && chartData.length > 0 ? (
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
                  formatter={(value: any) => [`${value} W`, "Potência"]}
                  contentStyle={{
                    backgroundColor: "#1a2942",
                    border: "1px solid #374151",
                    borderRadius: "8px",
                    color: "#fff",
                  }}
                  itemStyle={{ color: "#3b82f6" }}
                />
                <Bar
                  dataKey="valueW"
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                  barSize={26}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              {period.invalid
                ? "Selecione um período válido."
                : "Sem dados de consumo para este período."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

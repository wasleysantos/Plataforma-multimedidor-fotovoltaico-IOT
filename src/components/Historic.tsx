import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Calendar,
  Download,
  TrendingUp,
  TrendingDown,
  Clock,
  User,
  ChevronRight,
} from "lucide-react";
import jsPDF from "jspdf";

// ✅ cálculo unificado (igual Dashboard/Generation/Consumption)
import { integrateKwhFromRows, toNum } from "./EnergyCalc";

interface HistoricProps {
  cpf: string;
  onNavigate?: (page: "generation" | "consumption") => void;
}

function tsToMsSafe(ts: string) {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : NaN;
}

function fmtDateKey(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "invalid";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtDateHeader(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
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

const FALLBACK_TARIFA = 0.85;

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

type ConsPoint = { t: number; w: number };

function findClosestWithin(
  pointsAsc: ConsPoint[],
  targetMs: number,
  toleranceMs: number,
) {
  if (!pointsAsc.length || !Number.isFinite(targetMs)) return 0;

  let lo = 0;
  let hi = pointsAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pointsAsc[mid].t < targetMs) lo = mid + 1;
    else hi = mid;
  }

  const cand: ConsPoint[] = [];
  if (lo < pointsAsc.length) cand.push(pointsAsc[lo]);
  if (lo - 1 >= 0) cand.push(pointsAsc[lo - 1]);

  let best = 0;
  let bestDt = Infinity;

  for (const c of cand) {
    const dt = Math.abs(c.t - targetMs);
    if (dt <= toleranceMs && dt < bestDt) {
      bestDt = dt;
      best = c.w;
    }
  }

  return best;
}

function formatLastUpdated(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

export function Historic({ cpf, onNavigate }: HistoricProps) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [genHistoryAsc, setGenHistoryAsc] = useState<any[]>([]);
  const [consHistoryAsc, setConsHistoryAsc] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // ✅ Calendário sempre visível (default: hoje → hoje)
  const [startDate, setStartDate] = useState(todayStr); // YYYY-MM-DD
  const [endDate, setEndDate] = useState(todayStr); // YYYY-MM-DD

  const [personName, setPersonName] = useState("");
  const [nameNotFound, setNameNotFound] = useState(false);
  const [loadingName, setLoadingName] = useState(false);

  const [tarifaKwh, setTarifaKwh] = useState<number>(FALLBACK_TARIFA);
  const [tarifaError, setTarifaError] = useState("");

  // ✅ Última atualização (separadas, fora do período)
  const [lastUpdatedGen, setLastUpdatedGen] = useState("—");
  const [lastUpdatedCons, setLastUpdatedCons] = useState("—");

  // ✅ Paginação por DIA
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 5;

  const cpfVariants = useMemo(() => {
    if (!cpf) return [];
    const clean = normalizeCpf(cpf);
    const masked = maskCPF(clean);
    return Array.from(new Set([clean, masked]));
  }, [cpf]);

  // reset pagina ao trocar cpf/datas
  useEffect(() => {
    setCurrentPage(1);
  }, [cpf, startDate, endDate]);

  // ✅ resolve período (since/until) pelo calendário
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

    const since = startIsoFromDateInput(startDate);
    const until = endIsoFromDateInput(endDate);

    return {
      since,
      until,
      label: `${fmtDatePtBr(startDate)} → ${fmtDatePtBr(endDate)}`,
      invalid: false,
    };
  }, [startDate, endDate]);

  // ✅ clientes
  useEffect(() => {
    const fetchCustomer = async () => {
      if (!cpf) {
        setPersonName("");
        setNameNotFound(false);
        setLoadingName(false);
        setTarifaKwh(FALLBACK_TARIFA);
        setTarifaError("");
        return;
      }

      setLoadingName(true);
      setNameNotFound(false);
      setTarifaError("");

      const { data, error } = await supabase
        .from("clientes")
        .select("name,tarifa_kwh")
        .eq("cpf", normalizeCpf(cpf))
        .maybeSingle();

      if (error) {
        console.error("Erro clientes:", error);
        setPersonName("");
        setNameNotFound(false);
        setTarifaKwh(FALLBACK_TARIFA);
        setTarifaError(error.message || "Erro ao buscar tarifa");
        setLoadingName(false);
        return;
      }

      if (!data) {
        setPersonName("");
        setNameNotFound(true);
        setTarifaKwh(FALLBACK_TARIFA);
        setLoadingName(false);
        return;
      }

      setPersonName(data?.name || "");
      setNameNotFound(!data?.name);

      const t = Number(data?.tarifa_kwh);
      setTarifaKwh(Number.isFinite(t) && t > 0 ? t : FALLBACK_TARIFA);

      setLoadingName(false);
    };

    fetchCustomer();
  }, [cpf]);

  // ✅ Última atualização: separados (fora do período)
  useEffect(() => {
    const fetchLastUpdated = async () => {
      if (!cpf) {
        setLastUpdatedGen("—");
        setLastUpdatedCons("—");
        return;
      }

      const cpfClean = normalizeCpf(cpf);
      const variants = cpfVariants;

      const genReq = supabase
        .from("geracao")
        .select("created_at")
        .eq("user_cpf", cpfClean)
        .order("created_at", { ascending: false })
        .limit(1);

      const consReq = supabase
        .from("consumo")
        .select("created_at")
        .in("user_cpf", variants)
        .order("created_at", { ascending: false })
        .limit(1);

      const [genRes, consRes] = await Promise.all([genReq, consReq]);

      const genTs = genRes.data?.[0]?.created_at ?? null;
      const consTs = consRes.data?.[0]?.created_at ?? null;

      setLastUpdatedGen(formatLastUpdated(genTs));
      setLastUpdatedCons(formatLastUpdated(consTs));
    };

    fetchLastUpdated();
    if (!cpf) return;

    const id = window.setInterval(fetchLastUpdated, 5000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpf, cpfVariants]);

  // ✅ geracao + consumo (mesmo período) — BUSCA ASC (para cálculo e match)
  useEffect(() => {
    const fetchHistory = async () => {
      if (!cpf || period.invalid) {
        setGenHistoryAsc([]);
        setConsHistoryAsc([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      const cpfClean = normalizeCpf(cpf);

      const genReq = supabase
        .from("geracao")
        .select("id,created_at,voltage,active_power")
        .eq("user_cpf", cpfClean)
        .gte("created_at", period.since)
        .lte("created_at", period.until)
        .order("created_at", { ascending: true })
        .limit(1000000);

      const consReq = supabase
        .from("consumo")
        .select("id,created_at,active_power,user_cpf")
        .in("user_cpf", cpfVariants)
        .gte("created_at", period.since)
        .lte("created_at", period.until)
        .order("created_at", { ascending: true })
        .limit(1000000);

      const [genRes, consRes] = await Promise.all([genReq, consReq]);

      if (genRes.error) {
        console.error("Historic geracao error:", genRes.error);
        setGenHistoryAsc([]);
      } else {
        setGenHistoryAsc(genRes.data || []);
      }

      if (consRes.error) {
        console.error("Historic consumo error:", consRes.error);
        setConsHistoryAsc([]);
      } else {
        setConsHistoryAsc(consRes.data || []);
      }

      setLoading(false);
    };

    fetchHistory();
  }, [cpf, cpfVariants, period.since, period.until, period.invalid]);

  // ✅ pontos do consumo para OUT (busca binária)
  const consPointsAsc = useMemo<ConsPoint[]>(() => {
    const pts: ConsPoint[] = [];
    for (const it of consHistoryAsc || []) {
      const t = tsToMsSafe(it.created_at);
      if (!Number.isFinite(t)) continue;
      pts.push({ t, w: Math.max(0, toNum(it.active_power)) });
    }
    pts.sort((a, b) => a.t - b.t);
    return pts;
  }, [consHistoryAsc]);

  // ✅ Totais do período (IGUAL Dashboard)
  const periodTotals = useMemo(() => {
    const genAsc = [...(genHistoryAsc || [])].sort(
      (a, b) => tsToMsSafe(a.created_at) - tsToMsSafe(b.created_at),
    );
    const consAsc = [...(consHistoryAsc || [])].sort(
      (a, b) => tsToMsSafe(a.created_at) - tsToMsSafe(b.created_at),
    );

    const genKwh = integrateKwhFromRows(genAsc);
    const consKwh = integrateKwhFromRows(consAsc);
    const saldoKwh = genKwh - consKwh;

    return { genKwh, consKwh, saldoKwh };
  }, [genHistoryAsc, consHistoryAsc]);

  const periodEconBrl = useMemo(() => {
    return periodTotals.genKwh * (tarifaKwh || 0);
  }, [periodTotals.genKwh, tarifaKwh]);

  // ✅ Agrupa por dia — tudo do mais novo → mais antigo
  const grouped = useMemo(() => {
    const mapGen = new Map<string, any[]>();
    const mapCons = new Map<string, any[]>();

    for (const item of genHistoryAsc || []) {
      const k = fmtDateKey(item.created_at);
      if (!mapGen.has(k)) mapGen.set(k, []);
      mapGen.get(k)!.push(item);
    }

    for (const item of consHistoryAsc || []) {
      const k = fmtDateKey(item.created_at);
      if (!mapCons.has(k)) mapCons.set(k, []);
      mapCons.get(k)!.push(item);
    }

    const keys = Array.from(
      new Set([...Array.from(mapGen.keys()), ...Array.from(mapCons.keys())]),
    ).sort((a, b) => {
      const ta = Date.parse(a + "T00:00:00");
      const tb = Date.parse(b + "T00:00:00");
      return tb - ta; // ✅ dia mais novo primeiro
    });

    return keys.map((k) => {
      const dayGenAsc = (mapGen.get(k) || []).sort(
        (a, b) => tsToMsSafe(a.created_at) - tsToMsSafe(b.created_at),
      );
      const dayConsAsc = (mapCons.get(k) || []).sort(
        (a, b) => tsToMsSafe(a.created_at) - tsToMsSafe(b.created_at),
      );

      const genKwh = integrateKwhFromRows(dayGenAsc);
      const consKwh = integrateKwhFromRows(dayConsAsc);
      const saldoKwh = genKwh - consKwh;
      const econBrl = genKwh * (tarifaKwh || 0);

      // ✅ horários mais novos primeiro
      const dayGenDesc = [...dayGenAsc].sort(
        (a, b) => tsToMsSafe(b.created_at) - tsToMsSafe(a.created_at),
      );

      return {
        dateKey: k,
        title: fmtDateHeader(k),
        items: dayGenDesc,
        summary: { genKwh, consKwh, saldoKwh, econBrl },
      };
    });
  }, [genHistoryAsc, consHistoryAsc, tarifaKwh]);

  // ✅ Paginação por DIA (depois do agrupamento)
  const totalPages = Math.max(1, Math.ceil(grouped.length / ITEMS_PER_PAGE));
  const paginatedGrouped = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return grouped.slice(start, end);
  }, [grouped, currentPage]);

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Relatório de Energia - Tesla Solar", 14, 20);
    doc.setFontSize(10);
    doc.text(`CPF: ${cpf}`, 14, 30);
    if (personName) doc.text(`Cliente: ${personName}`, 14, 36);

    doc.text(`Período: ${period.label}`, 14, personName ? 42 : 36);
    doc.text(
      `Tarifa: R$ ${tarifaKwh.toFixed(2)}/kWh`,
      14,
      personName ? 48 : 42,
    );

    doc.text(
      `Total período: Gerado ${periodTotals.genKwh.toFixed(
        2,
      )} kWh | Consumido ${periodTotals.consKwh.toFixed(
        2,
      )} kWh | Saldo ${periodTotals.saldoKwh.toFixed(
        2,
      )} kWh | Economizado R$ ${periodEconBrl.toFixed(2)}`,
      14,
      personName ? 54 : 48,
    );

    let y = personName ? 66 : 60;

    grouped.forEach((g) => {
      doc.setFontSize(12);
      doc.text(`Data: ${g.title}`, 14, y);
      y += 7;

      doc.setFontSize(10);
      doc.text(
        `Resumo: Gerado ${g.summary.genKwh.toFixed(
          2,
        )} kWh | Consumido ${g.summary.consKwh.toFixed(
          2,
        )} kWh | Saldo ${g.summary.saldoKwh.toFixed(
          2,
        )} kWh | Economizado R$ ${g.summary.econBrl.toFixed(2)}`,
        14,
        y,
      );
      y += 8;

      doc.setFontSize(9);

      g.items.forEach((item: any) => {
        const hora = new Date(item.created_at).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        const genW = Math.max(0, toNum(item.active_power));
        const tens = toNum(item.voltage);

        const tGen = tsToMsSafe(item.created_at);
        const consW = findClosestWithin(consPointsAsc, tGen, 15000);

        const saldoW = genW - consW;

        doc.text(
          `${hora} | Tens: ${tens}V | In: ${genW.toFixed(
            0,
          )}W | Out: ${consW.toFixed(0)}W | Saldo: ${saldoW.toFixed(0)}W`,
          14,
          y,
        );

        y += 6;
        if (y > 280) {
          doc.addPage();
          y = 20;
        }
      });

      y += 6;
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
    });

    doc.save(`Historico-${personName || cpf}.pdf`);
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-white animate-pulse">
        Consultando banco de dados...
      </div>
    );
  }

  const hasAnyData =
    (genHistoryAsc?.length || 0) > 0 || (consHistoryAsc?.length || 0) > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-3">
        <div className="flex flex-col">
          <h2 className="text-2xl font-bold text-white">Histórico</h2>
          <div className="flex items-center gap-3 text-green-300 text-xs mt-1"></div>

          <div className="text-xs mt-1">
            {!cpf ? (
              <span className="text-green-400">
                Cliente: Aguardando seleção...
              </span>
            ) : loadingName ? (
              <span className="text-gray-300">Carregando nome...</span>
            ) : personName ? (
              <span className="text-green-400 font-semibold">{personName}</span>
            ) : nameNotFound ? (
              <span className="text-red-400 font-semibold">
                CPF não encontrado
              </span>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </div>

          {/* ✅ Calendário SEMPRE visível */}
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
                <br></br>
              </label>
              <label className="text-[11px] text-gray-400 mb-1">Fim</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-[#1a2942] text-white text-sm px-3 py-2 rounded-lg border border-gray-700 outline-none"
              />
            </div>

            {tarifaError && (
              <div className="text-[11px] text-yellow-400">{tarifaError}</div>
            )}
          </div>

          {cpf && (
            <div className="flex flex-col gap-0.5 text-[11px] text-gray-500 mt-2">
              <div>
                Última geração:{" "}
                <span className="text-gray-300">{lastUpdatedGen}</span>
              </div>
              <div>
                Último consumo:{" "}
                <span className="text-gray-300">{lastUpdatedCons}</span>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={exportToPDF}
          disabled={!cpf || !hasAnyData || period.invalid}
          className="flex items-center gap-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-700 text-white px-3 py-2 rounded-lg transition-colors text-xs font-semibold"
        >
          <Download className="w-4 h-4" />
          PDF
        </button>
      </div>

      {!cpf ? (
        <div className="bg-[#1a2942] rounded-2xl p-10 text-center border border-dashed border-gray-700">
          <p className="text-gray-500">Selecione um CPF no Painel Geral.</p>
        </div>
      ) : period.invalid ? (
        <div className="bg-[#1a2942] rounded-2xl p-10 text-center border border-dashed border-gray-700">
          <p className="text-gray-500">
            Selecione um período válido no calendário (início ≤ fim).
          </p>
        </div>
      ) : !hasAnyData ? (
        <div className="bg-[#1a2942] rounded-2xl p-10 text-center border border-dashed border-gray-700">
          <p className="text-gray-500">Sem dados para o período selecionado.</p>
        </div>
      ) : (
        <>
          {/* Cards topo */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {/* Geração */}
            <div className="bg-[#1a2942] rounded-xl p-4 border border-gray-800">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-400" />
                  <span className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">
                    GERAÇÃO SOLAR ({period.label})
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate?.("generation")}
                  disabled={!cpf}
                  className="p-2 rounded-lg border border-gray-700 hover:bg-white/5 transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
                  title="Abrir página de Geração"
                >
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>
              </div>

              <p className="text-2xl font-bold text-white mt-2">
                {periodTotals.genKwh.toFixed(2)}{" "}
                <span className="text-xs font-normal text-gray-400">kWh</span>
              </p>

              <div className="flex items-center justify-between mt-1">
                <p className="text-[11px] text-gray-500">
                  Total no período selecionado
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate?.("generation")}
                  disabled={!cpf}
                  className="text-[11px] font-semibold text-green-300 hover:text-green-200 transition-colors disabled:opacity-50"
                >
                  Ver
                </button>
              </div>
            </div>

            {/* Consumo */}
            <div className="bg-[#1a2942] rounded-xl p-4 border border-gray-800">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-blue-400" />
                  <span className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">
                    CONSUMO ({period.label})
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate?.("consumption")}
                  disabled={!cpf}
                  className="p-2 rounded-lg border border-gray-700 hover:bg-white/5 transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
                  title="Abrir página de Consumo"
                >
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>
              </div>

              <p className="text-2xl font-bold text-white mt-2">
                {periodTotals.consKwh.toFixed(2)}{" "}
                <span className="text-xs font-normal text-gray-400">kWh</span>
              </p>

              <div className="flex items-center justify-between mt-1">
                <p className="text-[11px] text-gray-500">
                  Total no período selecionado
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate?.("consumption")}
                  disabled={!cpf}
                  className="text-[11px] font-semibold text-blue-300 hover:text-blue-200 transition-colors disabled:opacity-50"
                >
                  Ver
                </button>
              </div>
            </div>
          </div>

          {/* Agrupado por dia (PAGINADO) */}
          <div className="space-y-6">
            {paginatedGrouped.map((g) => (
              <div key={g.dateKey} className="space-y-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-800 bg-white/5">
                    <Calendar className="w-4 h-4 text-green-400" />
                    <h3 className="text-white font-semibold text-base leading-none tracking-wide">
                      {g.title}
                    </h3>
                  </div>

                  <div className="text-[11px] text-gray-400">
                    Gerado{" "}
                    <span className="text-gray-200 font-semibold">
                      {g.summary.genKwh.toFixed(2)} kWh
                    </span>{" "}
                    | Consumido{" "}
                    <span className="text-gray-200 font-semibold">
                      {g.summary.consKwh.toFixed(2)} kWh
                    </span>{" "}
                    | Saldo{" "}
                    <span className="text-gray-200 font-semibold">
                      {g.summary.saldoKwh.toFixed(2)} kWh
                    </span>{" "}
                    | Economizado{" "}
                    <span className="text-green-300 font-semibold">
                      R$ {g.summary.econBrl.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Lista por horário (DESC) */}
                <div className="bg-[#1a2942] rounded-xl border border-gray-800 overflow-hidden">
                  {g.items.map((item: any, idx: number) => {
                    const genW = Math.max(0, toNum(item.active_power));
                    const tGen = tsToMsSafe(item.created_at);
                    const consW = findClosestWithin(consPointsAsc, tGen, 15000);
                    const saldoW = genW - consW;

                    const hora = new Date(item.created_at).toLocaleTimeString(
                      "pt-BR",
                      { hour: "2-digit", minute: "2-digit", second: "2-digit" },
                    );

                    return (
                      <div
                        key={item.id ?? `${g.dateKey}-${idx}`}
                        className={`px-4 py-3 flex items-center justify-between gap-4 ${
                          idx !== 0 ? "border-t border-gray-800" : ""
                        } hover:bg-white/5 transition-colors`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Clock className="w-4 h-4 text-gray-400" />
                          <div className="min-w-0">
                            <div className="text-white font-semibold text-sm">
                              {hora}
                            </div>
                            <div className="text-gray-500 text-[11px]">
                              Tensão:{" "}
                              <span className="text-gray-300">
                                {toNum(item.voltage)}V
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="text-gray-200 font-bold text-[12px]">
                            Saldo: {saldoW.toFixed(0)} W
                          </div>
                          <div className="flex items-center justify-end gap-3 mt-0.5 text-[11px]">
                            <span className="text-green-400 font-semibold">
                              In: {genW.toFixed(0)} W
                            </span>
                            <span className="text-blue-400 font-semibold">
                              Out: {consW.toFixed(0)} W
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {g.items.length === 0 && (
                    <div className="px-4 py-6 text-center text-gray-400 text-sm">
                      Sem dados neste dia.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Controles de paginação */}
          {grouped.length > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-xs bg-gray-700 rounded disabled:opacity-40"
              >
                Anterior
              </button>

              <span className="text-xs text-gray-400">
                Página {currentPage} de {totalPages}
              </span>

              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-xs bg-gray-700 rounded disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

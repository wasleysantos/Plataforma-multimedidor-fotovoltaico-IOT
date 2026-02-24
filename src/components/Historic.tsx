// Historic.tsx (COMPLETO ATUALIZADO) ✅
// NOVA BASE (igual ao Generation atualizado):
// - solar_generation = potência em W (amostra a cada 10s)
// - Wh por amostra = W * (10/3600) = W/360
// - kWh do período/dia = soma(Wh)/1000
// - NÃO usa mais solar_generation_wh no cálculo (pode continuar exibindo se quiser, mas aqui removi do select e do PDF/lista)
// - Consumo/saldo mantidos por integração (W->kWh) usando timestamps (para não quebrar)
// - Lista por horário segue exibindo POTÊNCIA em W

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

interface HistoricProps {
  cpf: string;
  onNavigate?: (page: "generation" | "consumption") => void;
}

type RangeKey = "today" | "7d" | "30d";

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function tsToMs(ts: string) {
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : NaN;
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

function startIsoForRange(range: RangeKey) {
  const now = new Date();

  if (range === "today") {
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
    );
    return start.toISOString();
  }

  const days = range === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ✅ base fixa: amostra a cada 10 segundos
const SAMPLE_SECONDS = 10;
const WH_FACTOR = SAMPLE_SECONDS / 3600; // 1/360

// ✅ GERAÇÃO: soma potência (W) -> Wh do intervalo -> kWh
function sumGenKwhFromW(items: any[]) {
  const totalWh = (items || []).reduce((acc, it) => {
    const w = Math.max(0, toNum(it?.solar_generation));
    return acc + w * WH_FACTOR;
  }, 0);

  return totalWh / 1000;
}

// ✅ CONSUMO: integra W -> kWh (trapézio) pelos timestamps (mantém seu comportamento anterior)
function integrateConsKwhFromW(itemsAsc: any[]) {
  if (!itemsAsc || itemsAsc.length < 2) return 0;

  let consKwh = 0;

  for (let i = 1; i < itemsAsc.length; i++) {
    const prev = itemsAsc[i - 1];
    const curr = itemsAsc[i];

    const t0 = tsToMs(prev.timestamp);
    const t1 = tsToMs(curr.timestamp);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;

    const dtHours = Math.max(0, (t1 - t0) / (1000 * 60 * 60));

    // W -> kW
    const c0kw = Math.max(0, toNum(prev.house_consumption)) / 1000;
    const c1kw = Math.max(0, toNum(curr.house_consumption)) / 1000;

    consKwh += ((c0kw + c1kw) / 2) * dtHours;
  }

  return consKwh;
}

const FALLBACK_TARIFA = 0.85;

export function Historic({ cpf, onNavigate }: HistoricProps) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [range, setRange] = useState<RangeKey>("7d");

  const [personName, setPersonName] = useState("");
  const [nameNotFound, setNameNotFound] = useState(false);
  const [loadingName, setLoadingName] = useState(false);

  const [tarifaKwh, setTarifaKwh] = useState<number>(FALLBACK_TARIFA);
  const [tarifaError, setTarifaError] = useState("");

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
        .from("customers")
        .select("name,tarifa_kwh")
        .eq("cpf", cpf)
        .maybeSingle();

      if (error) {
        console.error("Erro customers:", error);
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

  useEffect(() => {
    const fetchHistory = async () => {
      if (!cpf) {
        setHistory([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      const since = startIsoForRange(range);

      // ✅ agora só precisamos de solar_generation (W) + consumo/tensão
      const { data, error } = await supabase
        .from("measurements")
        .select("id,timestamp,voltage,solar_generation,house_consumption")
        .eq("user_cpf", cpf)
        .gte("timestamp", since)
        .order("timestamp", { ascending: false })
        .limit(10000);

      if (error) {
        console.error("Historic measurements error:", error);
        setHistory([]);
        setLoading(false);
        return;
      }

      setHistory(data || []);
      setLoading(false);
    };

    fetchHistory();
  }, [cpf, range]);

  // ✅ total do período (cards topo)
  const periodTotals = useMemo(() => {
    if (!history || history.length === 0) {
      return { genKwh: 0, consKwh: 0, saldoKwh: 0, lastVoltage: 0 };
    }

    // ✅ geração pelo W (10s) -> kWh
    const genKwh = sumGenKwhFromW(history);

    // ✅ consumo por integração (W->kWh)
    const asc = [...history].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const consKwh = integrateConsKwhFromW(asc);

    const saldoKwh = genKwh - consKwh;

    return {
      genKwh,
      consKwh,
      saldoKwh,
      lastVoltage: toNum(history?.[0]?.voltage),
    };
  }, [history]);

  const periodEconBrl = useMemo(() => {
    return periodTotals.genKwh * (tarifaKwh || 0);
  }, [periodTotals.genKwh, tarifaKwh]);

  // ✅ Agrupa por data + resumo diário
  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();

    for (const item of history) {
      const k = fmtDateKey(item.timestamp);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }

    const keys = Array.from(map.keys()).sort((a, b) => (a > b ? -1 : 1));

    return keys.map((k) => {
      const dayItemsDesc = (map.get(k) || []).sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      // ✅ geração diária pelo W (10s) -> kWh
      const genKwh = sumGenKwhFromW(dayItemsDesc);

      // ✅ consumo diário por integração (W->kWh)
      const dayItemsAsc = [...dayItemsDesc].reverse();
      const consKwh = integrateConsKwhFromW(dayItemsAsc);

      const saldoKwh = genKwh - consKwh;
      const econBrl = genKwh * (tarifaKwh || 0);

      return {
        dateKey: k,
        title: fmtDateHeader(k),
        items: dayItemsDesc,
        summary: {
          genKwh,
          consKwh,
          saldoKwh,
          econBrl,
        },
      };
    });
  }, [history, tarifaKwh]);

  const lastTs = history?.[0]?.timestamp
    ? new Date(history[0].timestamp)
    : null;

  const lastUpdatedLabel = lastTs
    ? new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(lastTs)
    : "—";

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Relatório de Energia - Tesla Solar", 14, 20);
    doc.setFontSize(10);
    doc.text(`CPF: ${cpf}`, 14, 30);
    if (personName) doc.text(`Cliente: ${personName}`, 14, 36);

    const rangeLabel =
      range === "today" ? "Hoje" : range === "7d" ? "7 dias" : "30 dias";

    doc.text(`Período: ${rangeLabel}`, 14, personName ? 42 : 36);
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
        const hora = new Date(item.timestamp).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        const potW = Math.max(0, toNum(item.solar_generation));
        const tens = toNum(item.voltage);
        const consW = Math.max(0, toNum(item.house_consumption));

        // ✅ energia do intervalo calculada (Wh) pela base fixa de 10s
        const enerWh = potW * WH_FACTOR;

        doc.text(
          `${hora} | Tens: ${tens}V | Pot: ${potW.toFixed(
            0,
          )}W | Ener: ${enerWh.toFixed(2)}Wh | Cons: ${consW.toFixed(0)}W`,
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

  const RangeButton = ({ k, label }: { k: RangeKey; label: string }) => (
    <button
      type="button"
      onClick={() => setRange(k)}
      className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-200 ${
        range === k
          ? "bg-green-500 hover:bg-green-600 text-white shadow-lg shadow-green-500/20"
          : "bg-transparent text-gray-300 border border-gray-700 hover:bg-white/5"
      }`}
    >
      {label}
    </button>
  );

  if (loading) {
    return (
      <div className="p-8 text-center text-white animate-pulse">
        Consultando banco de dados...
      </div>
    );
  }

  const rangeLabel =
    range === "today" ? "Hoje" : range === "7d" ? "7 dias" : "30 dias";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-3">
        <div className="flex flex-col">
          <h2 className="text-2xl font-bold text-white">Histórico</h2>

          <div className="flex items-center gap-2 text-green-400 text-xs mt-1">
            <User className="w-3 h-3" />
            <span>CPF: {cpf || "Aguardando seleção..."}</span>
          </div>

          <div className="text-xs text-gray-300 mt-1">
            {cpf
              ? loadingName
                ? "Carregando nome..."
                : personName
                  ? personName
                  : nameNotFound
                    ? "CPF não encontrado"
                    : "—"
              : "—"}
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-2">
            <div className="flex gap-2">
              <RangeButton k="today" label="Hoje" />
              <RangeButton k="7d" label="7 dias" />
              <RangeButton k="30d" label="30 dias" />
            </div>

            {tarifaError && (
              <div className="text-[11px] text-yellow-400">{tarifaError}</div>
            )}

            {cpf && (
              <div className="text-[11px] text-gray-500">
                Última atualização:{" "}
                <span className="text-gray-300">{lastUpdatedLabel}</span>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={exportToPDF}
          disabled={!cpf || history.length === 0}
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
      ) : history.length === 0 ? (
        <div className="bg-[#1a2942] rounded-2xl p-10 text-center border border-dashed border-gray-700">
          <p className="text-gray-500">
            Sem dados para{" "}
            {range === "today"
              ? "Hoje"
              : range === "7d"
                ? "os últimos 7 dias"
                : "os últimos 30 dias"}
            .
          </p>
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
                    GERAÇÃO SOLAR ({rangeLabel})
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate?.("generation")}
                  disabled={!cpf}
                  className="p-2 rounded-lg border border-gray-700 hover:bg-white/5 transition-colors
                             disabled:opacity-50 disabled:hover:bg-transparent"
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
                  className="text-[11px] font-semibold text-green-300 hover:text-green-200 transition-colors
                             disabled:opacity-50"
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
                    CONSUMO ({rangeLabel})
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate?.("consumption")}
                  disabled={!cpf}
                  className="p-2 rounded-lg border border-gray-700 hover:bg-white/5 transition-colors
                             disabled:opacity-50 disabled:hover:bg-transparent"
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
                  className="text-[11px] font-semibold text-blue-300 hover:text-blue-200 transition-colors
                             disabled:opacity-50"
                >
                  Ver
                </button>
              </div>
            </div>
          </div>

          {/* Agrupado por dia */}
          <div className="space-y-6">
            {grouped.map((g) => (
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

                {/* Lista por horário (W) */}
                <div className="bg-[#1a2942] rounded-xl border border-gray-800 overflow-hidden">
                  {g.items.map((item: any, idx: number) => {
                    const genW = Math.max(0, toNum(item.solar_generation));
                    const consW = Math.max(0, toNum(item.house_consumption));
                    const saldoW = genW - consW;

                    const hora = new Date(item.timestamp).toLocaleTimeString(
                      "pt-BR",
                      { hour: "2-digit", minute: "2-digit", second: "2-digit" },
                    );

                    // ✅ Wh do intervalo (10s)
                    const genWh = genW * WH_FACTOR;

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
                              <span className="text-gray-600"> • </span>
                              Energia:{" "}
                              <span className="text-gray-300">
                                {genWh.toFixed(2)} Wh
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
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

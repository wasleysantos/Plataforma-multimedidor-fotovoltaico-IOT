// src/utils/energy.ts

export function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function tsToMs(ts: string) {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Integra potência (W) ao longo do tempo usando método do trapézio
 * Retorna kWh
 */
export function integrateKwhFromRows(
  rows: { created_at: string; active_power: any }[]
) {
  if (!rows || rows.length < 2) return 0;

  let kwh = 0;

  for (let i = 1; i < rows.length; i++) {
    const p1 = toNum(rows[i - 1].active_power);
    const p2 = toNum(rows[i].active_power);

    const t1 = tsToMs(rows[i - 1].created_at);
    const t2 = tsToMs(rows[i].created_at);

    const dtSeconds = (t2 - t1) / 1000;
    if (dtSeconds <= 0) continue;

    // Trapézio
    const avgPower = (p1 + p2) / 2;

    // W * segundos -> Wh
    const wh = (avgPower * dtSeconds) / 3600;

    kwh += wh / 1000;
  }

  return kwh;
}
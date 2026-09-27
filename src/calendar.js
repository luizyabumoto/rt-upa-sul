/** Grade de escala por calendário civil de Cuiabá (datas locais sem UTC). */
export const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function fortnight(year, month, half) {
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12 || ![1, 2].includes(half)) {
    throw new RangeError('Ano, mês ou quinzena inválidos');
  }
  const last = new Date(year, month, 0).getDate();
  const start = half === 1 ? 1 : 16;
  const end = half === 1 ? 15 : last;
  return Array.from({length: end - start + 1}, (_, index) => {
    const day = start + index;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const weekday = new Date(year, month - 1, day).getDay();
    return {date, year, month, day, weekday, weekdayName: WEEKDAYS[weekday]};
  });
}

/**
 * fixed: {doctorId, sector, slot, weekday, startTime, endTime, affiliation}
 * absences: {doctorId, startDate, endDate}
 * overrides: {date, sector, slot, doctorId|null, affiliation?, reason?}
 * Cada posição da grade é identificada por setor + slot + data.
 */
export function generateSchedule({year, month, half, fixed = [], absences = [], overrides = []}) {
  const days = fortnight(year, month, half);
  const placements = [];
  const warnings = [];
  const overrideMap = new Map(overrides.map(item => [`${item.date}|${item.sector}|${item.slot}`, item]));
  for (const day of days) {
    for (const rule of fixed.filter(item => item.weekday === day.weekday)) {
      const key = `${day.date}|${rule.sector}|${rule.slot}`;
      const override = overrideMap.get(key);
      const placement = {date: day.date, sector: rule.sector, slot: rule.slot,
        doctorId: override ? override.doctorId : rule.doctorId,
        affiliation: override?.affiliation ?? rule.affiliation,
        startTime: rule.startTime, endTime: rule.endTime,
        source: override ? 'alteração' : 'fixo', reason: override?.reason ?? null};
      if (placement.doctorId && absences.some(a => a.doctorId === placement.doctorId && a.startDate <= day.date && day.date <= a.endDate)) {
        warnings.push({type: 'afastamento', date: day.date, doctorId: placement.doctorId, sector: rule.sector, slot: rule.slot});
      }
      placements.push(placement);
    }
  }
  for (const item of overrides) {
    if (!days.some(day => day.date === item.date)) continue;
    const key = `${item.date}|${item.sector}|${item.slot}`;
    if (!placements.some(p => `${p.date}|${p.sector}|${p.slot}` === key)) {
      placements.push({...item, source: 'alteração'});
    }
  }
  return {days, placements, warnings};
}

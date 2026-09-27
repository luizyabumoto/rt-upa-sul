import {fortnight} from './calendar.js';

/** Mapeia data e posto às células do modelo oficial da escala de 12 horas. */
export function templateMap(year,month,half){
 const days=fortnight(year,month,half);
 const mondayOffset=(days[0].weekday+6)%7;
 const result=[];
 for(let i=0;i<days.length;i++){
  const position=mondayOffset+i;
  const week=Math.floor(position/7);
  if(week>2)throw new Error('Modelo oficial comporta até três semanas por quinzena.');
  const col='CDEFGHI'[position%7];
  const header=[3,19,35][week];
  const dayRow=header+1;
  const firstShiftRow=header+2;
  result.push({date:days[i].date,weekday:days[i].weekday,week,column:col,
   weekdayCell:`${col}${header}`,dayCell:`${col}${dayRow}`,
   shiftCells:Array.from({length:14},(_,slot)=>`${col}${firstShiftRow+slot}`)});
 }
 return result;
}

"""A4 landscape schedules using the same dated rules and confirmed covers as Excel."""
import calendar
import datetime as dt
from io import BytesIO
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib import colors
from export_excel import planned_doctor, slot_bounds, SEED

POSTS = ['Clínico 1','Clínico 2','Clínico 3','Clínico 4','Pediatria 1','Pediatria 2','Box']
DAYS = ['SEG','TER','QUA','QUI','SEX','SÁB','DOM']

def cinderela_label(slot, day):
    a,b=slot_bounds(slot,day.isoformat())
    return f'{a:02d}h-{b%24:02d}h'

def assignments(date, slot, data):
    half = 1 if date.day <= 15 else 2
    key = f'{date.isoformat()}|{slot}'
    base = data.get(f'edits:{date.year}:{date.month}:{half}', {}).get(key, planned_doctor(date.isoformat(),slot,data))
    start,end = slot_bounds(slot,date.isoformat())
    covers=sorted((c for c in data.get('coverages',[]) if c.get('confirmed') and c['date']==date.isoformat() and c['slot']==slot),key=lambda c:c['start'])
    result=[]; cursor=start
    for cover in covers:
        if cover['start']>cursor:result.append((base,cursor,cover['start'],False))
        result.append((cover['doctor'],cover['start'],cover['end'],True));cursor=cover['end']
    if cursor<end:result.append((base,cursor,end,False))
    return result

def doctor_text(date, slot, data):
    result=[]
    for doctor,start,end,covered in assignments(date,slot,data):
        if doctor:
            color='#008000' if 'EXTRA' in doctor.upper() else '#0053a5' if 'COAPH' in doctor.upper() else '#000000'
            text=escape(doctor.strip()).replace('\n','<br/>')
            if covered:text+=' <b>[C]</b>'
            if len(assignments(date,slot,data))>1:text+=f' ({start%24:02d}h-{end%24:02d}h)'
            result.append(f'<font color="{color}">{text}</font>')
        else:
            exact=next((a for a in SEED['assignments'] if a['date']==date.isoformat() and a['slot']==slot),{})
            edits=data.get(f'edits:{date.year}:{date.month}:{1 if date.day<=15 else 2}',{})
            changed=f'{date.isoformat()}|{slot}' in edits or any(r['start']<=date.isoformat() and r['weekday']==(date.weekday()+1)%7 and r['slot']==slot for r in data.get('roster',[])) or any(r['weekday']==(date.weekday()+1)%7 and r['slot']==slot for r in data.get('fixed',[]))
            absent=not changed and (exact.get('availability')=='not-scheduled' or slot>=14 and date.weekday()>=5)
            result.append('X' if absent else '<font color="#a51c30">VAGO</font>')
    return '<br/>'.join(result)

def export_pdf(year,month,half,kind,layout,data):
    if any(type(v) is not int for v in (year,month,half)) or not 2020<=year<=2100 or not 1<=month<=12 or half not in (1,2) or kind not in ('regular','cinderela') or layout not in ('compact','weekly'):
        raise ValueError('Período ou formato inválido')
    first=1 if half==1 else 16;last=15 if half==1 else calendar.monthrange(year,month)[1]
    dates=[dt.date(year,month,day) for day in range(first,last+1)]
    groups=[dates]
    if layout=='weekly':
        groups=[]
        for day in dates:
            if not groups or day.weekday()==0:groups.append([])
            groups[-1].append(day)
    buffer=BytesIO();pdf=canvas.Canvas(buffer,pagesize=landscape(A4));pdf.setTitle('Escala médica - RT UPA Sul');pdf.setAuthor('RT UPA Sul')
    width,height=landscape(A4);margin=22;available=width-2*margin;maxheight=height-112
    slots=list(range(14)) if kind=='regular' else [14,15]
    for page,group in enumerate(groups,1):
        title='ESCALA MÉDICA - UPA SUL' if kind=='regular' else 'ESCALA CINDERELAS - UPA SUL'
        pdf.setFont('Helvetica-Bold',13);pdf.drawString(margin,height-27,title)
        pdf.setFont('Helvetica',9);pdf.drawString(margin,height-43,f'{group[0]:%d/%m/%Y} a {group[-1]:%d/%m/%Y} | Pascoal Ramos')
        pdf.setFont('Helvetica',7);pdf.drawString(margin,height-56,'Diurno: 07h-19h | Noturno: 19h-07h do dia seguinte | 12 horas' if kind=='regular' else f'Cinderela 1: {cinderela_label(14,group[0])} | Cinderela 2: {cinderela_label(15,group[0])} | 6 horas')
        # Compact: days down the page. Weekly: seven wide columns with larger type.
        weekly=layout=='weekly'
        def label(slot):return f'{"DIURNO" if slot<7 else "NOTURNO"}<br/>{POSTS[slot%7]}' if slot<14 else cinderela_label(slot,group[0])
        raw=([['Posto / horário']+[f'{d:%d/%m}<br/>{DAYS[d.weekday()]}' for d in group]]+[[label(s)]+[doctor_text(d,s,data) for d in group] for s in slots]) if weekly else ([['Data']+[label(s) for s in slots]]+[[f'{d:%d/%m}<br/>{DAYS[d.weekday()]}']+[doctor_text(d,s,data) for s in slots] for d in group])
        widths=([76]+[(available-76)/len(group)]*len(group)) if weekly else ([37]+[(available-37)/len(slots)]*len(slots))
        size=8.5 if weekly or kind=='cinderela' else 6.0
        while True:
            style=ParagraphStyle('cell',fontName='Helvetica',fontSize=size,leading=size*1.12,alignment=1,spaceAfter=0)
            cells=[[Paragraph(text,style) for text in row] for row in raw]
            table=Table(cells,colWidths=widths)
            table.setStyle(TableStyle([('GRID',(0,0),(-1,-1),.35,colors.HexColor('#9faab3')),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e4edf2')),('BACKGROUND',(0,1),(0,-1),colors.HexColor('#f1f5f7')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),2),('RIGHTPADDING',(0,0),(-1,-1),2),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3)]))
            _,h=table.wrap(available,maxheight)
            if h<=maxheight:break
            size-=.2
            if size<4.2:raise ValueError('Muitos detalhes para uma folha. Escolha uma semana por folha.')
        table.drawOn(pdf,margin,height-66-h)
        pdf.setFont('Helvetica',6.8)
        pdf.drawString(margin,28,'SMS: preto | COAPH: azul | EXTRA SMS: verde | [C]: cobertura confirmada | X: sem plantão previsto')
        pdf.drawString(margin,17,'Revise vagas, extras e afastamentos antes de distribuir. Padrões futuros são previsões; anotações pessoais não são incluídas.')
        pdf.drawRightString(width-margin,17,f'{page}/{len(groups)}');pdf.showPage()
    pdf.save();return buffer.getvalue()

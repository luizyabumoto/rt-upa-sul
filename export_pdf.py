"""Escala em PDF, A4 paisagem, no mesmo desenho do Excel: postos nas linhas, dias nas colunas,
faixas de diurno, noturno e visita, e cor de fundo pelo vínculo. Usa as mesmas regras com vigência,
ajustes por data e coberturas confirmadas do Excel. Quinzena inteira em uma folha ou uma semana por folha."""
import calendar
import datetime as dt
import re
from io import BytesIO
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib import colors
from export_excel import planned_doctor, slot_bounds, SEED, MONTHS

POSTS = ['Clínico 1', 'Clínico 2', 'Clínico 3', 'Clínico 4', 'Pediatria 1', 'Pediatria 2', 'Box de emergência']
DAYS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM']
C = colors.HexColor
NAVY, SLATE, LINE = C('#14304A'), C('#3A4A5F'), C('#C5CED9')
# Vínculo: cor de fundo da célula e da linha do CRM (iguais ao modelo em Excel).
VINCULO = {'SMS': ('#FFFFFF', '#44546A'), 'COAPH': ('#E7EFFC', '#1F4E9E'), 'EXTRA SMS': ('#E4F3E8', '#1E6B3A')}
BANDS = {'D': ('DIURNO  ·  07h às 19h  ·  12 horas', '#FCEFD2', '#7A4B00'), 'N': ('NOTURNO  ·  19h às 07h  ·  12 horas', '#DFE4F6', '#27347A'),
         'V': ('VISITA À ENFERMARIA  ·  diurno  ·  6 horas', '#DDF1EC', '#12564E'), 'C': ('CINDERELAS  ·  6 horas', '#F3E5F5', '#5B2A6E')}


def cinderela_label(slot, day):
    a, b = slot_bounds(slot, day.isoformat())
    return f'{a:02d}h-{b % 24:02d}h'


def vinculo(doctor):
    texto = (doctor or '').upper()
    return 'EXTRA SMS' if 'EXTRA' in texto else 'COAPH' if 'COAPH' in texto else 'SMS'


def assignments(date, slot, data):
    half = 1 if date.day <= 15 else 2
    key = f'{date.isoformat()}|{slot}'
    base = data.get(f'edits:{date.year}:{date.month}:{half}', {}).get(key, planned_doctor(date.isoformat(), slot, data))
    start, end = slot_bounds(slot, date.isoformat())
    covers = sorted((c for c in data.get('coverages', []) if c.get('confirmed') and c['date'] == date.isoformat() and c['slot'] == slot), key=lambda c: c['start'])
    result = []; cursor = start
    for cover in covers:
        if cover['start'] > cursor: result.append((base, cursor, cover['start'], False))
        result.append((cover['doctor'], cover['start'], cover['end'], True)); cursor = cover['end']
    if cursor < end: result.append((base, cursor, end, False))
    return result


def sem_plantao(date, slot, data):
    """Posto vazio que não estava previsto (o "X" da planilha importada, ou cinderela no fim de semana)."""
    exact = next((a for a in SEED['assignments'] if a['date'] == date.isoformat() and a['slot'] == slot), {})
    edits = data.get(f'edits:{date.year}:{date.month}:{1 if date.day <= 15 else 2}', {})
    wd = (date.weekday() + 1) % 7
    changed = f'{date.isoformat()}|{slot}' in edits or any(r['start'] <= date.isoformat() and r['weekday'] == wd and r['slot'] == slot for r in data.get('roster', [])) \
        or any(r['weekday'] == wd and r['slot'] == slot for r in data.get('fixed', []))
    return not changed and (exact.get('availability') == 'not-scheduled' or slot >= 14 and date.weekday() >= 5)


def doctor_markup(doctor, size, extra=''):
    nome, _, resto = (doctor or '').strip().partition('\n')
    crm = (re.search(r'CRM\D*(\d+)', resto or doctor, re.I) or [None, ''])[1]
    cor = VINCULO[vinculo(doctor)][1]
    crm_txt = f'CRM {crm}' if crm else 'CRM a confirmar'
    return (f'<b>{escape(nome)}</b><br/><font size="{size * .86:.2f}" color="{cor}">{crm_txt} · {vinculo(doctor)}{extra}</font>')


def cell(parts, size, vazio):
    """(texto em marcação, cor de fundo) de um posto num dia."""
    pessoas = [p for p in parts if p[0]]
    if not pessoas:
        return ('<font color="#9AA5B4">—</font>', '#F4F6F9') if vazio else ('<font color="#B42318"><b>VAGO</b></font>', '#FDECEC')
    textos = []
    for doctor, start, end, covered in parts:
        if not doctor:
            textos.append(f'<font color="#B42318"><b>VAGO</b> ({start % 24:02d}h-{end % 24:02d}h)</font>')
            continue
        extra = (' <b>[C]</b>' if covered else '') + (f' · {start % 24:02d}h-{end % 24:02d}h' if len(parts) > 1 else '')
        textos.append(doctor_markup(doctor, size, extra))
    fundo = VINCULO[vinculo(pessoas[0][0])][0] if len(pessoas) == 1 else '#FFFFFF'
    return '<br/>'.join(textos), fundo


def doctor_text(date, slot, data):
    """Texto simples de um posto (usado nos testes e em conferências)."""
    parts = assignments(date, slot, data)
    return cell(parts, 6, sem_plantao(date, slot, data))[0]


def visitador(date, line, data):
    wd = (date.weekday() + 1) % 7
    seed = {(v['weekday'], v['line']): v['doctor'] for v in SEED['visits']}
    return data.get('visits:weekly', {}).get(f'{wd}|{line}', seed.get((wd, line), ''))


def secoes(dates, kind, data):
    """[(chave da faixa, [(rótulo, [partes por dia], [vazio por dia])])]"""
    if kind == 'cinderela':
        linhas = [(f'Cinderela {i + 1}<br/><font size="5.5">{cinderela_label(s, dates[0])}</font>', [assignments(d, s, data) for d in dates], [sem_plantao(d, s, data) for d in dates]) for i, s in enumerate((14, 15))]
        return [('C', linhas)]
    out = []
    for chave, base in (('D', 0), ('N', 7)):
        out.append((chave, [(POSTS[p], [assignments(d, base + p, data) for d in dates], [sem_plantao(d, base + p, data) for d in dates]) for p in range(7)]))
    out.append(('V', [(f'Visitador {line + 1}', [[(visitador(d, line, data), 7, 13, False)] for d in dates], [False] * len(dates)) for line in range(2)]))
    return out


def desenhar_pagina(pdf, dates, kind, data, periodo_txt, pagina, paginas, fonte_inicial):
    width, height = landscape(A4)
    m = 18
    # Cabeçalho
    pdf.setFillColor(NAVY); pdf.rect(m, height - m - 26, width - 2 * m, 26, stroke=0, fill=1)
    pdf.setFillColor(colors.white); pdf.setFont('Helvetica-Bold', 13)
    pdf.drawString(m + 10, height - m - 17.5, 'ESCALA MÉDICA DE PLANTÕES  ·  UPA SUL – PASCOAL RAMOS' if kind == 'regular' else 'ESCALA DE CINDERELAS  ·  UPA SUL – PASCOAL RAMOS')
    pdf.setFont('Helvetica-Bold', 9.5); pdf.drawRightString(width - m - 10, height - m - 17, f'COMPETÊNCIA: {periodo_txt}')
    pdf.setFillColor(SLATE); pdf.setFont('Helvetica', 7.5)
    pdf.drawString(m + 2, height - m - 37, 'Secretaria Municipal de Saúde de Cuiabá  ·  Diretor Clínico: Dr. Luiz Fernando Yabumoto  ·  CRM = CRM-MT')
    # Legenda de vínculos
    x = width - m
    for rotulo, (fundo, texto) in reversed([('SMS', VINCULO['SMS']), ('COAPH', VINCULO['COAPH']), ('EXTRA SMS', VINCULO['EXTRA SMS']), ('VAGO', ('#FDECEC', '#B42318'))]):
        w = pdf.stringWidth(rotulo, 'Helvetica-Bold', 6.5) + 14
        x -= w
        pdf.setFillColor(C(fundo)); pdf.setStrokeColor(LINE); pdf.roundRect(x, height - m - 41, w, 11, 2, stroke=1, fill=1)
        pdf.setFillColor(C(texto)); pdf.setFont('Helvetica-Bold', 6.5); pdf.drawCentredString(x + w / 2, height - m - 37.5, rotulo)
        x -= 4
    pdf.setFillColor(SLATE); pdf.setFont('Helvetica-Bold', 6.5); pdf.drawRightString(x - 2, height - m - 37.5, 'VÍNCULO:')

    # Tabela
    topo, rodape = height - m - 48, m + 34
    disponivel_h, disponivel_w = topo - rodape, width - 2 * m
    rotulo_w = 64
    col_w = (disponivel_w - rotulo_w) / len(dates)
    grupos = secoes(dates, kind, data)
    size = fonte_inicial
    while True:
        st = ParagraphStyle('c', fontName='Helvetica', fontSize=size, leading=size * 1.13, alignment=1, textColor=C('#14253E'))
        cab = ParagraphStyle('h', parent=st, fontName='Helvetica-Bold', fontSize=max(size + .6, 6), leading=(size + .6) * 1.15, textColor=colors.white)
        rot = ParagraphStyle('r', parent=st, fontName='Helvetica-Bold', alignment=0, fontSize=max(size + .4, 5.8), leading=(size + .4) * 1.15)
        faixa = ParagraphStyle('f', parent=st, fontName='Helvetica-Bold', alignment=0, fontSize=max(size + .8, 6.5))
        linhas = [[Paragraph('POSTO', cab)] + [Paragraph(f'{DAYS[d.weekday()]}<br/>{d:%d/%m}', cab) for d in dates]]
        estilo = [('GRID', (0, 0), (-1, -1), .4, LINE), ('BACKGROUND', (0, 0), (-1, 0), SLATE), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                  ('LEFTPADDING', (0, 0), (-1, -1), 1.5), ('RIGHTPADDING', (0, 0), (-1, -1), 1.5), ('TOPPADDING', (0, 0), (-1, -1), 1.6), ('BOTTOMPADDING', (0, 0), (-1, -1), 1.8)]
        for i, d in enumerate(dates, 1):
            if d.weekday() >= 5: estilo.append(('BACKGROUND', (i, 0), (i, 0), C('#55667D')))
        for chave, grupo in grupos:
            texto, fundo, cor = BANDS[chave]
            r = len(linhas)
            linhas.append([Paragraph(f'<font color="{cor}">{texto}</font>', faixa)] + [''] * len(dates))
            estilo += [('SPAN', (0, r), (-1, r)), ('BACKGROUND', (0, r), (-1, r), C(fundo)), ('TOPPADDING', (0, r), (-1, r), 1), ('BOTTOMPADDING', (0, r), (-1, r), 1.5)]
            for rotulo, partes, vazios in grupo:
                r = len(linhas)
                linha = [Paragraph(rotulo, rot)]
                estilo.append(('BACKGROUND', (0, r), (0, r), C('#F6F8FA')))
                for i, (p, vazio) in enumerate(zip(partes, vazios), 1):
                    txt, bg = cell(p, size, vazio)
                    linha.append(Paragraph(txt, st))
                    estilo.append(('BACKGROUND', (i, r), (i, r), C(bg)))
                linhas.append(linha)
        tabela = Table(linhas, colWidths=[rotulo_w] + [col_w] * len(dates), repeatRows=0)
        tabela.setStyle(TableStyle(estilo))
        _, h = tabela.wrap(disponivel_w, disponivel_h)
        if h <= disponivel_h: break
        size -= .15
        if size < 3.6: raise ValueError('Muitos detalhes para uma folha. Escolha uma semana por folha.')
    tabela.drawOn(pdf, m, topo - h)

    # Rodapé: horários, legenda, emissão e assinaturas
    pdf.setFillColor(SLATE); pdf.setFont('Helvetica', 6.6)
    pdf.drawString(m, m + 20, 'Diurno 07h–19h · Noturno 19h–07h do dia seguinte · Visita 6 h  ·  [C] cobertura confirmada  ·  — sem plantão previsto'
                   if kind == 'regular' else f'Cinderela 1: {cinderela_label(14, dates[0])} · Cinderela 2: {cinderela_label(15, dates[0])} · 6 horas  ·  [C] cobertura confirmada  ·  — sem plantão previsto')
    agora = dt.datetime.now(dt.timezone(dt.timedelta(hours=-4)))
    pdf.drawString(m, m + 10, f'Emitida em {agora:%d/%m/%Y às %H:%M}  ·  Escala sujeita a alterações; trocas somente com ciência da Direção Clínica / RT.')
    for i, cargo in enumerate(('Diretor Clínico', 'Responsável Técnico')):
        x0 = width - m - 330 + i * 170
        pdf.setStrokeColor(C('#14253E')); pdf.setLineWidth(.5); pdf.line(x0, m + 18, x0 + 150, m + 18)
        pdf.setFont('Helvetica', 6.4); pdf.drawCentredString(x0 + 75, m + 10, cargo)
    if paginas > 1:
        pdf.drawRightString(width - m, m, f'Folha {pagina} de {paginas}')


def export_pdf(year, month, half, kind, layout, data):
    if any(type(v) is not int for v in (year, month, half)) or not 2020 <= year <= 2100 or not 1 <= month <= 12 or half not in (1, 2) or kind not in ('regular', 'cinderela') or layout not in ('compact', 'weekly'):
        raise ValueError('Período ou formato inválido')
    first = 1 if half == 1 else 16
    last = 15 if half == 1 else calendar.monthrange(year, month)[1]
    dates = [dt.date(year, month, day) for day in range(first, last + 1)]
    grupos = [dates]
    if layout == 'weekly':
        grupos = []
        for day in dates:
            if not grupos or day.weekday() == 0: grupos.append([])
            grupos[-1].append(day)
    periodo_txt = f'{half}ª QUINZENA · {first:02d} a {last:02d} de {MONTHS[month].lower()} de {year}'
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=landscape(A4))
    pdf.setTitle(f'Escala {"médica" if kind == "regular" else "de cinderelas"} - UPA Sul - {first:02d} a {last:02d}/{month:02d}/{year}')
    pdf.setAuthor('RT UPA Sul')
    for pagina, grupo in enumerate(grupos, 1):
        desenhar_pagina(pdf, grupo, kind, data, periodo_txt, pagina, len(grupos), 9.5 if layout == 'weekly' else 7.4)
        pdf.showPage()
    pdf.save()
    return buffer.getvalue()

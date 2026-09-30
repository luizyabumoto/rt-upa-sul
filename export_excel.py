#!/usr/bin/env python3
"""Preenche cópia do modelo oficial sem reconstruir formatação ou impressão.

Uso: python export_excel.py --year 2026 --month 10 --half 1 --backup backup.json --output escala.xlsx
O backup é opcional; sem ele, reproduz os dados fornecidos de outubro/2026.
"""
import argparse
import calendar
import datetime as dt
import json
from pathlib import Path
import re
import sys
import unicodedata
from copy import deepcopy
from zipfile import ZipFile
from xml.etree import ElementTree as etree

ROOT = Path(__file__).resolve().parent
DEFAULT_TEMPLATE = ROOT / 'templates' / 'escala-medica-oficial.xlsx'
SEED = json.loads((ROOT / 'src' / 'seed.json').read_text(encoding='utf8'))
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
Q = lambda name: '{' + NS + '}' + name

# O Excel real (diferente de leitores tolerantes como openpyxl) exige que os
# prefixos de namespace usados no XML batam com os nomes citados dentro do
# atributo mc:Ignorable ("x14ac xr xr2 xr3", etc.). Sem isto, ElementTree
# reescreve o XML com prefixos genéricos (ns0, ns1...) ao serializar de volta
# e o Excel considera o arquivo corrompido, reparando-o e apagando o conteúdo
# das células. Registrar os prefixos originais aqui mantém a serialização
# idêntica à do modelo oficial.
for _prefix, _uri in {
    '': NS,
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    'x14ac': 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac',
    'xr': 'http://schemas.microsoft.com/office/spreadsheetml/2014/revision',
    'xr2': 'http://schemas.microsoft.com/office/spreadsheetml/2015/revision2',
    'xr3': 'http://schemas.microsoft.com/office/spreadsheetml/2016/revision3',
    'x16r2': 'http://schemas.microsoft.com/office/spreadsheetml/2015/02/main',
}.items():
    etree.register_namespace(_prefix, _uri)
MONTHS = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
WEEKDAYS = ['SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO', 'DOMINGO']
# Espelha scheduling.js:bounds. Cinderelas: até 30/09/2026, 12h-18h e 18h-00h; a partir de 01/10/2026, 11h-17h e 12h-18h.
CINDERELAS_NOVAS = '2026-10-01'


def slot_bounds(slot, date_text=CINDERELAS_NOVAS):
    novas = str(date_text) >= CINDERELAS_NOVAS
    if slot == 14:
        return (11, 17) if novas else (12, 18)
    if slot == 15:
        return (12, 18) if novas else (18, 24)
    return (7, 19) if slot < 7 else (19, 31)

def doctor_identity(name):
    """Espelha scheduling.js:doctorIdentity — usado pra comparar médicos sem acento/CRM/pontuação."""
    base = re.split(r'CRM', name or '', flags=re.I)[0]
    decomposed = unicodedata.normalize('NFD', base)
    stripped = ''.join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r'[^a-zA-Z0-9]', '', stripped).lower()

def _sort_key(name):
    decomposed = unicodedata.normalize('NFD', name or '')
    return ''.join(c for c in decomposed if not unicodedata.combining(c)).upper()

# Diurno/noturno · Clínico 1-4: quatro postos fisicamente iguais no template.
# Um médico pode ser cadastrado como "Clínico (qualquer)" (rt-upa:clinicoRoster)
# em vez de preso a um número; eles só preenchem posições que sobrarem vagas
# depois de roster/fixo/padrão/escala importada — nunca substituem um médico
# já determinado por uma dessas fontes. Espelha scheduling.js (recurringRule,
# nonGenericResolution, genericClinicoDoctors) pra exportar exatamente o que
# aparece na tela.
CLINICO_TURNS = {'dia': [0, 1, 2, 3], 'noite': [7, 8, 9, 10]}

def _clinico_turn_for_slot(slot):
    for turn, group in CLINICO_TURNS.items():
        if slot in group:
            return turn
    return None

def _pinned_rule(date_text, slot, backup):
    """Espelha scheduling.js:pinnedRule. Retorna (doctor, status); (None, None) se nada bate."""
    weekday = (dt.date.fromisoformat(date_text).weekday() + 1) % 7
    rules = sorted((r for r in backup.get('roster', []) if r['start'] <= date_text and r['weekday'] == weekday and r['slot'] == slot), key=lambda r: (r['start'], r['id']), reverse=True)
    if rules:
        return rules[0]['doctor'], 'custom'
    rule = next((r for r in backup.get('fixed', []) if int(r['weekday']) == weekday and int(r['slot']) == slot), None)
    if rule is not None:
        return rule['doctor'], 'custom'
    if slot >= 14:
        found = next((r for r in SEED.get('cinderelas', []) if r['weekday'] == weekday and r['slot'] == slot), None)
        return (found['doctor'], 'regular') if found else (None, None)
    patterns = sorted((p for p in SEED.get('patterns', []) if p['start'] <= date_text and (not p['end'] or date_text <= p['end'])), key=lambda p: p['start'], reverse=True)
    if patterns:
        found = next((r for r in patterns[0]['rules'] if r['weekday'] == weekday and r['slot'] == slot), None)
        if found is not None:
            return found['doctor'], found.get('status', 'regular')
    return None, None

def _non_generic_resolution(date_text, slot, backup):
    """Espelha scheduling.js:nonGenericResolution — inclui a escala exata importada."""
    doctor, status = _pinned_rule(date_text, slot, backup)
    if status == 'custom' or slot >= 14:
        return doctor, status
    exact = next((r for r in SEED['assignments'] if r['date'] == date_text and r['slot'] == slot), None)
    if exact is not None:
        return exact['doctor'], 'regular'
    return doctor, status

def _generic_clinico_doctors(date_text, weekday, turn, backup):
    """Espelha scheduling.js:genericClinicoDoctors — pool ordenado alfabeticamente."""
    rows = [r for r in backup.get('clinicoRoster', []) if r['weekday'] == weekday and r['turn'] == turn and r['start'] <= date_text]
    rows.sort(key=lambda r: (r['start'], r['id']))
    latest = {}
    for row in rows:
        latest[doctor_identity(row['doctor'])] = row
    pool = [row['doctor'] for row in latest.values() if row.get('active')]
    pool.sort(key=_sort_key)
    return pool

def recurring_rule(date_text, slot, backup):
    """Espelha scheduling.js:recurringRule, incluindo o preenchimento genérico de clínico."""
    turn = _clinico_turn_for_slot(slot)
    if turn is None:
        return _pinned_rule(date_text, slot, backup)
    weekday = (dt.date.fromisoformat(date_text).weekday() + 1) % 7
    group = CLINICO_TURNS[turn]
    pinned = {s: _non_generic_resolution(date_text, s, backup) for s in group}
    taken = {doctor_identity(doc) for doc, _ in pinned.values() if doc}
    pool = [d for d in _generic_clinico_doctors(date_text, weekday, turn, backup) if doctor_identity(d) not in taken]
    empty_slots = [s for s in group if not pinned[s][0]]
    if slot in empty_slots:
        index = empty_slots.index(slot)
        if index < len(pool):
            return pool[index], 'custom'
    return pinned[slot]

def planned_doctor(date_text, slot, backup):
    """Espelha scheduling.js:plannedDoctor."""
    doctor, status = recurring_rule(date_text, slot, backup)
    if status == 'custom':
        return doctor or ''
    if slot >= 14:
        return doctor or ''
    exact = next((r for r in SEED['assignments'] if r['date'] == date_text and r['slot'] == slot), None)
    if exact is not None:
        return exact['doctor']
    return doctor or ''

def color_writer(styles,sheet_data):
    fonts=styles.find(Q('fonts'));xfs=styles.find(Q('cellXfs'));cache={}
    def apply(address,doctor):
        cell=next(c for row in sheet_data.findall(Q('row')) for c in row.findall(Q('c')) if c.get('r')==address)
        rgb='FF008000' if 'EXTRA' in doctor.upper() else 'FF0070C0' if 'COAPH' in doctor.upper() else 'FFFF0000' if doctor=='VAGO' else 'FF000000'
        base=int(cell.get('s','0'));key=(base,rgb)
        if key not in cache:
            xf=deepcopy(xfs[base]);font=deepcopy(fonts[int(xf.get('fontId','0'))]);old=font.find(Q('color'))
            if old is not None:font.remove(old)
            etree.SubElement(font,Q('color'),rgb=rgb);fonts.append(font);fonts.set('count',str(len(fonts)))
            xf.set('fontId',str(len(fonts)-1));xf.set('applyFont','1');xfs.append(xf);xfs.set('count',str(len(xfs)));cache[key]=len(xfs)-1
        cell.set('s',str(cache[key]))
    return apply


# Estes namespaces são citados em mc:Ignorable mas não são usados em nenhuma
# tag/atributo do corpo da planilha, então o ElementTree não os declara
# sozinho ao serializar; sem a declaração, o Excel encontra um prefixo
# "órfão" em mc:Ignorable e considera o arquivo corrompido. Repor a
# declaração manualmente (a ordem dos atributos não importa em XML) resolve.
SHEET_EXTRA_NS = {
    'xmlns:xr2': 'http://schemas.microsoft.com/office/spreadsheetml/2015/revision2',
    'xmlns:xr3': 'http://schemas.microsoft.com/office/spreadsheetml/2016/revision3',
}
STYLES_EXTRA_NS = {
    'xmlns:x16r2': 'http://schemas.microsoft.com/office/spreadsheetml/2015/02/main',
}


def _restore_ignorable_namespaces(root, extra):
    for key, uri in extra.items():
        if root.get(key) is None:
            root.set(key, uri)


def serialize_xml(root):
    """Serializa como o Excel grava: aspas duplas e standalone="yes"."""
    body = etree.tostring(root, encoding='unicode')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + body).encode('utf-8')


def read_backup(path):
    if path is None:
        return {}
    data = json.loads(path.read_text(encoding='utf8'))
    if data.get('version') != 1 or not isinstance(data.get('items'), dict):
        raise ValueError('Backup inválido: esperado backup JSON versão 1')
    result = {}
    for key, value in data['items'].items():
        if key.startswith('rt-upa:'):
            result[key[7:]] = json.loads(value)
    return result


def get_row(sheet_data, row_number):
    for row in sheet_data.findall(Q('row')):
        if int(row.get('r')) == row_number:
            return row
    row = etree.Element(Q('row'), r=str(row_number))
    later = next((old for old in sheet_data.findall(Q('row')) if int(old.get('r')) > row_number), None)
    if later is None:
        sheet_data.append(row)
    else:
        sheet_data.insert(list(sheet_data).index(later), row)
    return row


def column_index(address):
    result = 0
    for char in re.match(r'[A-Z]+', address).group():
        result = result * 26 + ord(char) - 64
    return result


def set_cell(sheet_data, address, value):
    row_number = int(re.search(r'\d+', address).group())
    row = get_row(sheet_data, row_number)
    cell = next((item for item in row.findall(Q('c')) if item.get('r') == address), None)
    if cell is None:
        cell = etree.Element(Q('c'), r=address)
        later = next((old for old in row.findall(Q('c')) if column_index(old.get('r')) > column_index(address)), None)
        if later is None:
            row.append(cell)
        else:
            row.insert(list(row).index(later), cell)
    # Mantém atributo de estilo s; remove apenas valor/fórmula anteriores.
    for child in list(cell):
        if child.tag in (Q('v'), Q('is'), Q('f')):
            cell.remove(child)
    if value is None or value == '':
        cell.attrib.pop('t', None)
    elif isinstance(value, int):
        cell.attrib.pop('t', None)
        etree.SubElement(cell, Q('v')).text = str(value)
    else:
        cell.set('t', 'inlineStr')
        etree.SubElement(etree.SubElement(cell, Q('is')), Q('t')).text = str(value)


def export(year, month, half, backup, template, output):
    if not 1900 <= year <= 2200 or not 1 <= month <= 12 or half not in (1, 2):
        raise ValueError('Ano, mês ou quinzena inválidos')
    start = 1 if half == 1 else 16
    end = 15 if half == 1 else calendar.monthrange(year, month)[1]
    key = f'{year}:{month}:{half}'
    edits = backup.get(f'edits:{key}', {})
    fixed = backup.get('fixed', [])
    visits = backup.get('visits:weekly', {})
    seed_shifts = {(item['date'], item['slot']): item['doctor'] for item in SEED['assignments'] if item['slot'] < 14}
    seed_visits = {(item['weekday'], item['line']): item['doctor'] for item in SEED['visits']}
    with ZipFile(template) as original:
        tree = etree.fromstring(original.read('xl/worksheets/sheet1.xml'))
        _restore_ignorable_namespaces(tree, SHEET_EXTRA_NS)
        sheet_data = tree.find(Q('sheetData'))
        styles=etree.fromstring(original.read('xl/styles.xml'));_restore_ignorable_namespaces(styles, STYLES_EXTRA_NS);apply_color=color_writer(styles,sheet_data)
        set_cell(sheet_data, 'A2', f'COMPETÊNCIA: {start} a {end} de {MONTHS[month]} de {year}')
        offset = dt.date(year, month, start).weekday()
        schedule = {}
        # Zera apenas as posições editáveis da grade de três semanas.
        for week, heading in enumerate((3, 19, 35)):
            for index, column in enumerate('CDEFGHI'):
                set_cell(sheet_data, f'{column}{heading}', None)
                set_cell(sheet_data, f'{column}{heading+1}', None)
                for slot in range(14):
                    set_cell(sheet_data, f'{column}{heading+2+slot}', None)
        for day in range(start, end + 1):
            date = dt.date(year, month, day)
            date_text = date.isoformat()
            position = offset + day - start
            week, weekday_index = divmod(position, 7)
            if week >= 3:
                raise ValueError('Modelo não comporta mais de três blocos semanais')
            heading = (3, 19, 35)[week]
            column = 'CDEFGHI'[weekday_index]
            set_cell(sheet_data, f'{column}{heading}', WEEKDAYS[date.weekday()])
            set_cell(sheet_data, f'{column}{heading+1}', day)
            for slot in range(14):
                rule = next((r for r in fixed if int(r['weekday']) == (date.weekday()+1)%7 and int(r['slot']) == slot), None)
                baseline = planned_doctor(date_text,slot,backup)
                selected = edits.get(f'{date_text}|{slot}', baseline)
                cover = next((c for c in backup.get('coverages',[]) if c.get('confirmed') and c['date']==date_text and c['slot']==slot),None)
                if cover: selected=cover['doctor']
                # Preserva indicador de vaga; exige revisão antes de uso oficial.
                exact=next((a for a in SEED['assignments'] if a['date']==date_text and a['slot']==slot),{})
                overridden=f'{date_text}|{slot}' in edits or any(r['start']<=date_text and r['weekday']==(date.weekday()+1)%7 and r['slot']==slot for r in backup.get('roster',[])) or rule is not None
                empty='X' if not overridden and exact.get('availability')=='not-scheduled' else 'VAGO'
                set_cell(sheet_data, f'{column}{heading+2+slot}', selected or empty)
                apply_color(f'{column}{heading+2+slot}',selected or empty)
                schedule[(date_text, slot)] = selected
        # Visitas são duas linhas semanais de segunda a domingo, sem datas.
        for weekday_index, column in enumerate('CDEFGHI'):
            weekday = (weekday_index + 1) % 7
            set_cell(sheet_data, f'{column}52', WEEKDAYS[weekday_index])
            for line in range(2):
                selected = visits.get(f'{weekday}|{line}', seed_visits.get((weekday, line), ''))
                set_cell(sheet_data, f'{column}{53+line}', selected or 'VAGO')
                apply_color(f'{column}{53+line}',selected or 'VAGO')
        replacement = serialize_xml(tree)
        output.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(output, 'w') as target:
            for member in original.infolist():
                data=replacement if member.filename=='xl/worksheets/sheet1.xml' else serialize_xml(styles) if member.filename=='xl/styles.xml' else original.read(member.filename)
                target.writestr(member,data)
    return schedule


def fortnight_of(date_text):
    """(ano, mês, quinzena, primeiro dia, último dia) da quinzena que contém a data."""
    day = dt.date.fromisoformat(date_text)
    half = 1 if day.day <= 15 else 2
    start = 1 if half == 1 else 16
    end = 15 if half == 1 else calendar.monthrange(day.year, day.month)[1]
    return day.year, day.month, half, dt.date(day.year, day.month, start), dt.date(day.year, day.month, end)


def hours_label(slot, date_text):
    start, end = slot_bounds(slot, date_text)
    return f'{start}h às {end % 24:02d}h' if end % 24 == 0 else f'{start}h às {end}h'


def _add_style(styles, base, fill_rgb=None, font_rgb=None, bold=False):
    """Cópia do estilo base com outro preenchimento/cor de fonte (usado na faixa com o número do dia)."""
    fonts, fills, xfs = styles.find(Q('fonts')), styles.find(Q('fills')), styles.find(Q('cellXfs'))
    xf = deepcopy(xfs[base])
    if fill_rgb:
        fill = etree.SubElement(fills, Q('fill'))
        pattern = etree.SubElement(fill, Q('patternFill'), patternType='solid')
        etree.SubElement(pattern, Q('fgColor'), rgb=fill_rgb)
        etree.SubElement(pattern, Q('bgColor'), indexed='64')
        fills.set('count', str(len(fills)))
        xf.set('fillId', str(len(fills) - 1)); xf.set('applyFill', '1')
    if font_rgb or bold:
        font = deepcopy(fonts[int(xf.get('fontId', '0'))])
        for tag in ('color', 'b') if font_rgb else ('b',):
            old = font.find(Q(tag))
            if old is not None:
                font.remove(old)
        if bold:
            font.insert(0, etree.Element(Q('b')))
        if font_rgb:
            etree.SubElement(font, Q('color'), rgb=font_rgb)
        fonts.append(font); fonts.set('count', str(len(fonts)))
        xf.set('fontId', str(len(fonts) - 1)); xf.set('applyFont', '1')
    xfs.append(xf); xfs.set('count', str(len(xfs)))
    return len(xfs) - 1


def export_cinderela(date_text, backup, output):
    """Escala de cinderelas QUINZENAL (modelo seguido pela UPA Norte), com o cabeçalho da UPA Sul.

    Blocos semanais de segunda a domingo: PERÍODO/CAR. HOR. + dias da semana, faixa com o número do dia e as
    duas cinderelas; no fim, o aviso de trocas. Quinzena = a que contém date_text. Visitas ficam só na escala de
    12 horas. A carga horária é sempre a atual (11h às 17h e 12h às 18h), mesmo exportando uma quinzena anterior.
    Os médicos seguem o padrão semanal fixo das cinderelas, com edições do dia e coberturas confirmadas."""
    year, month, half, first, last = fortnight_of(date_text)
    template = ROOT / 'templates' / 'escala-cinderelas.xlsx'
    with ZipFile(template) as original:
        tree = etree.fromstring(original.read('xl/worksheets/sheet1.xml'))
        _restore_ignorable_namespaces(tree, SHEET_EXTRA_NS)
        sheet_data = tree.find(Q('sheetData'))
        styles = etree.fromstring(original.read('xl/styles.xml')); _restore_ignorable_namespaces(styles, STYLES_EXTRA_NS)
        # Protótipos do modelo: 1-2 cabeçalho, 3 títulos da semana, 4-5 linhas de médico, 6 aviso de trocas.
        rows = {int(r.get('r')): r for r in sheet_data.findall(Q('row'))}
        style = {r: {re.match(r'[A-Z]+', c.get('r')).group(): c.get('s') for c in rows[r].findall(Q('c'))} for r in (3, 4, 5, 6)}
        heights = {r: rows[r].get('ht') for r in (3, 4, 6)}
        for r in list(sheet_data.findall(Q('row'))):
            if int(r.get('r')) >= 3:
                sheet_data.remove(r)
        day_style = _add_style(styles, int(style[3]['C']), fill_rgb='FF0070C0', font_rgb='FFFFFFFF', bold=True)
        cols = 'ABCDEFGHI'

        def new_row(number, height, styles_by_col, values=None):
            row = etree.SubElement(sheet_data, Q('row'), r=str(number), spans='1:9', ht=str(height), customHeight='1')
            for col in cols:
                etree.SubElement(row, Q('c'), r=f'{col}{number}', s=str(styles_by_col(col)))
            for col, value in (values or {}).items():
                set_cell(sheet_data, f'{col}{number}', value)
            return row

        set_cell(sheet_data, 'A2', f'COMPETÊNCIA: {first.day} a {last.day} de {MONTHS[month]} de {year}')
        # Semanas (segunda a domingo) que a quinzena toca.
        weeks, monday = [], first - dt.timedelta(days=first.weekday())
        while monday <= last:
            weeks.append(monday); monday += dt.timedelta(days=7)
        colored = []
        number = 3
        for monday in weeks:
            new_row(number, heights[3], lambda c: style[3][c], {'A': 'PERÍODO', 'B': 'CAR. HOR.', **{col: WEEKDAYS[i] for i, col in enumerate('CDEFGHI')}})
            days = {col: monday + dt.timedelta(days=i) for i, col in enumerate('CDEFGHI')}
            new_row(number + 1, heights[3], lambda c: day_style, {col: d.day for col, d in days.items() if first <= d <= last})
            for offset, slot in ((2, 14), (3, 15)):
                values = {'A': 'CINDERELA', 'B': hours_label(slot, CINDERELAS_NOVAS)}
                for col, day in days.items():
                    if not first <= day <= last:
                        continue
                    date = day.isoformat(); weekday = (day.weekday() + 1) % 7
                    edits = backup.get(f'edits:{year}:{month}:{half}', {})
                    doctor = edits.get(f'{date}|{slot}', planned_doctor(date, slot, backup))
                    cover = next((x for x in backup.get('coverages', []) if x.get('confirmed') and x['date'] == date and x['slot'] == slot), None)
                    if cover:
                        doctor = cover['doctor']
                    values[col] = doctor or ('X' if weekday in (0, 6) else 'VAGO')
                    colored.append((f'{col}{number + offset}', values[col]))
                new_row(number + offset, heights[4], lambda c: style[4][c], values)
            number += 4
        foot = number
        footer = new_row(foot, heights[6], lambda c: style[6][c], {'A': '*ESCALA SUJEITA À ALTERAÇÕES NO DECORRER DO MÊS EM RAZÃO DA POSSIBILIDADE DE TROCAS DE PLANTÕES ENTRE OS MÉDICOS DO CORPO CLÍNICO.'})
        footer.set('thickBot', '1')
        apply_color = color_writer(styles, sheet_data)
        for address, value in colored:
            apply_color(address, value)
        tree.find(Q('dimension')).set('ref', f'A1:I{foot}')
        merges = tree.find(Q('mergeCells'))
        for m in list(merges):
            merges.remove(m)
        for ref in ('A1:C1', 'D1:F1', 'G1:I1', 'A2:C2', 'D2:I2', f'A{foot}:I{foot}'):
            etree.SubElement(merges, Q('mergeCell'), ref=ref)
        merges.set('count', str(len(merges)))
        replacement = serialize_xml(tree)
        with ZipFile(output, 'w') as target:
            for member in original.infolist():
                target.writestr(member, replacement if member.filename == 'xl/worksheets/sheet1.xml' else serialize_xml(styles) if member.filename == 'xl/styles.xml' else original.read(member.filename))
    return {'ano': year, 'mes': month, 'quinzena': half, 'semanas': len(weeks)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--month', type=int, required=True)
    parser.add_argument('--half', type=int, choices=(1,2), required=True)
    parser.add_argument('--backup', type=Path)
    parser.add_argument('--template', type=Path, default=DEFAULT_TEMPLATE)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve() == args.template.resolve():
        parser.error('O arquivo de saída não pode sobrescrever o modelo oficial.')
    schedule = export(args.year, args.month, args.half, read_backup(args.backup), args.template, args.output)
    print(f'Arquivo criado: {args.output} ({len(schedule)} posições; revise as vagas e os nomes antes de enviar).')

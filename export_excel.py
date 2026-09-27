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
from zipfile import ZipFile
from xml.etree import ElementTree as etree

ROOT = Path(__file__).resolve().parent
DEFAULT_TEMPLATE = ROOT / 'templates' / 'escala-medica-oficial.xlsx'
SEED = json.loads((ROOT / 'src' / 'seed.json').read_text(encoding='utf8'))
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
Q = lambda name: '{' + NS + '}' + name
MONTHS = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
WEEKDAYS = ['SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO', 'DOMINGO']


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
        sheet_data = tree.find(Q('sheetData'))
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
                baseline = (rule or {}).get('doctor') or seed_shifts.get((date_text, slot), '')
                selected = edits.get(f'{date_text}|{slot}', baseline)
                cover = next((c for c in backup.get('coverages',[]) if c.get('confirmed') and c['date']==date_text and c['slot']==slot),None)
                if cover: selected=cover['doctor']
                # Preserva indicador de vaga; exige revisão antes de uso oficial.
                set_cell(sheet_data, f'{column}{heading+2+slot}', selected or 'VAGO')
                schedule[(date_text, slot)] = selected
        # Visitas são duas linhas semanais de segunda a domingo, sem datas.
        for weekday_index, column in enumerate('CDEFGHI'):
            weekday = (weekday_index + 1) % 7
            set_cell(sheet_data, f'{column}52', WEEKDAYS[weekday_index])
            for line in range(2):
                selected = visits.get(f'{weekday}|{line}', seed_visits.get((weekday, line), ''))
                set_cell(sheet_data, f'{column}{53+line}', selected or 'VAGO')
        replacement = etree.tostring(tree, encoding='utf-8', xml_declaration=True)
        output.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(output, 'w') as target:
            for member in original.infolist():
                target.writestr(member, replacement if member.filename == 'xl/worksheets/sheet1.xml' else original.read(member.filename))
    return schedule


def export_cinderela(date_text, backup, output):
    day=dt.date.fromisoformat(date_text)
    monday=day-dt.timedelta(days=day.weekday())
    template=ROOT/'templates'/'escala-cinderelas.xlsx'
    with ZipFile(template) as original:
        tree=etree.fromstring(original.read('xl/worksheets/sheet1.xml'))
        sheet_data=tree.find(Q('sheetData'))
        set_cell(sheet_data,'A2',f'CINDERELAS: {monday:%d/%m/%Y} a {monday+dt.timedelta(days=6):%d/%m/%Y}')
        for i,col in enumerate('CDEFGHI'):
            day=monday+dt.timedelta(days=i);date=day.isoformat();weekday=(day.weekday()+1)%7
            set_cell(sheet_data,f'{col}3',f'{WEEKDAYS[i]}\n{day:%d/%m}')
            edits=backup.get(f'edits:{day.year}:{day.month}:{1 if day.day<=15 else 2}',{})
            for slot,row in [(14,4),(15,5)]:
                rule=next((x for x in backup.get('fixed',[]) if x['weekday']==weekday and x['slot']==slot),None)
                seed=next((x for x in SEED.get('cinderelas',[]) if x['weekday']==weekday and x['slot']==slot),{})
                doctor=edits.get(f'{date}|{slot}',(rule if rule is not None else seed).get('doctor',''))
                cover=next((x for x in backup.get('coverages',[]) if x.get('confirmed') and x['date']==date and x['slot']==slot),None)
                if cover:doctor=cover['doctor']
                set_cell(sheet_data,f'{col}{row}',doctor or ('X' if weekday in (0,6) else 'VAGO'))
        replacement=etree.tostring(tree,encoding='utf-8',xml_declaration=True)
        with ZipFile(output,'w') as target:
            for member in original.infolist():target.writestr(member,replacement if member.filename=='xl/worksheets/sheet1.xml' else original.read(member.filename))


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

import unittest,json,tempfile
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as E
from online import validate_items,ApiError
from export_excel import planned_doctor,export,export_cinderela,DEFAULT_TEMPLATE,Q
class RosterTests(unittest.TestCase):
 def test_schema_and_dates(self):
  rule=dict(id='r',start='2026-10-01',weekday=2,slot=0,doctor='TESTE CRM 1 - COAPH')
  validate_items({'rt-upa:roster':json.dumps([rule])})
  for changes in [dict(start='2026-02-30'),dict(weekday=7),dict(slot=16),dict(doctor='TESTE - EXTRA SMS')]:
   with self.assertRaises(ApiError):validate_items({'rt-upa:roster':json.dumps([{**rule,**changes}])})
  with self.assertRaises(ApiError):validate_items({'rt-upa:roster':json.dumps([rule,rule])})
 def test_explicit_extra_recurrence(self):
  rule=dict(id='extra',start='2026-10-01',weekday=3,slot=0,doctor='TESTE CRM 123 - EXTRA SMS',repeatExtra=True)
  validate_items({'rt-upa:roster':json.dumps([rule])})
  self.assertEqual(planned_doctor('2026-10-07',0,{'roster':[rule]}),rule['doctor'])
  self.assertNotEqual(planned_doctor('2026-09-30',0,{'roster':[rule]}),rule['doctor'])
  for value in [False,'true',1,None]:
   with self.assertRaises(ApiError):validate_items({'rt-upa:roster':json.dumps([{**rule,'repeatExtra':value}])})
 def test_history_and_export_colors(self):
  rules=[dict(id='a',start='2026-10-01',weekday=2,slot=0,doctor='TESTE CRM 1 - COAPH')]
  self.assertIn('DHYEILLEN',planned_doctor('2026-09-28',1,{'roster':rules}))
  self.assertIn('TESTE',planned_doctor('2026-10-06',0,{'roster':rules}))
  with tempfile.TemporaryDirectory() as tmp:
   out=Path(tmp)/'export.xlsx'
   export(2026,10,1,{'roster':rules,'edits:2026:10:1':{'2026-10-06|1':'EXTRA SMS','2026-10-06|2':'TESTE SMS'}},DEFAULT_TEMPLATE,out)
   with ZipFile(out) as z:
    sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'));styles=E.fromstring(z.read('xl/styles.xml'))
    cells={c.get('r'):c for c in sheet.iter(Q('c'))}
    def color(address):
     xf=styles.find(Q('cellXfs'))[int(cells[address].get('s','0'))]
     return styles.find(Q('fonts'))[int(xf.get('fontId'))].find(Q('color')).get('rgb')
    self.assertEqual(color('D21'),'FF0070C0');self.assertEqual(color('D22'),'FF008000')
    self.assertEqual(color('D23'),'FF000000')
   rules=[dict(id='c',start='2026-10-01',weekday=2,slot=14,doctor='NOVO CRM 1 - COAPH')]
   export_cinderela('2026-10-06',{'roster':rules},out)
   with ZipFile(out) as z:self.assertIn(b'NOVO CRM 1 - COAPH',z.read('xl/worksheets/sheet1.xml'))

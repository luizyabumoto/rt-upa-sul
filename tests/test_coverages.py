import unittest,tempfile,json
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as E
from export_excel import export,export_cinderela,DEFAULT_TEMPLATE,ROOT,Q
from online import validate_items,ApiError
class CoverageExports(unittest.TestCase):
 def cover(self,slot,date='2026-10-01'):
  a,b=(12,18) if slot==14 else (18,24) if slot==15 else (7,19)
  return dict(id='test',taskId='t',date=date,slot=slot,start=a,end=b,doctor='COBERTURA TESTE',original='Original',confirmed=True)
 def test_validation_and_duplicate(self):
  c=self.cover(0);validate_items({'rt-upa:coverages':json.dumps([c])})
  with self.assertRaises(ApiError):validate_items({'rt-upa:coverages':json.dumps([c,{**c,'id':'b'}])})
 def test_exports_use_confirmed_coverages_and_keep_template(self):
  with tempfile.TemporaryDirectory() as d:
   out=Path(d)/'regular.xlsx';schedule=export(2026,10,1,{'coverages':[self.cover(0)]},DEFAULT_TEMPLATE,out);self.assertEqual(schedule[('2026-10-01',0)],'COBERTURA TESTE')
   out=Path(d)/'cinderela.xlsx';export_cinderela('2026-09-28',{'coverages':[self.cover(14,'2026-09-28')]},out)
   with ZipFile(out) as z,ZipFile(ROOT/'templates/escala-cinderelas.xlsx') as original:
    tree=E.fromstring(z.read('xl/worksheets/sheet1.xml'));cells={x.get('r'):''.join(x.itertext()) for x in tree.iter(Q('c'))};self.assertEqual(cells['C4'],'COBERTURA TESTE');self.assertEqual(cells['H4'],'X')
    for name in original.namelist():
     if name!='xl/worksheets/sheet1.xml':self.assertEqual(z.read(name),original.read(name))

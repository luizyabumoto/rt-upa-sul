import io,json,os,unittest
from unittest.mock import patch
from pypdf import PdfReader
from export_pdf import export_pdf,doctor_text
from test_online import request,provider
import datetime as dt

class PdfTests(unittest.TestCase):
 def test_landscape_one_page_and_weekly(self):
  for month,half in [(9,2),(10,2),(2,2)]:
   for kind in ['regular','cinderela']:
    reader=PdfReader(io.BytesIO(export_pdf(2026,month,half,kind,'compact',{})))
    self.assertEqual(len(reader.pages),1)
    self.assertGreater(float(reader.pages[0].mediabox.width),float(reader.pages[0].mediabox.height))
  reader=PdfReader(io.BytesIO(export_pdf(2026,9,2,'regular','weekly',{})))
  self.assertEqual(len(reader.pages),3)
  self.assertIn('GUSTAVO',reader.pages[1].extract_text())
 def test_confirmed_cover_and_private_notes(self):
  data={'coverages':[dict(date='2026-09-27',slot=0,start=7,end=19,doctor='COBERTURA CONFIRMADA - COAPH',confirmed=True)],'organizer':[{'body':'ANOTACAO PRIVADA NAO EXPORTAR'}]}
  text=PdfReader(io.BytesIO(export_pdf(2026,9,2,'regular','compact',data))).pages[0].extract_text()
  self.assertIn('COBERTURA',text);self.assertIn('[C]',text);self.assertNotIn('ANOTACAO PRIVADA',text)
  data['coverages'][0]['confirmed']=False
  self.assertNotIn('COBERTURA',doctor_text(dt.date(2026,9,27),0,data))
 def test_private_endpoint_and_validation(self):
  payload=dict(year=2026,month=9,half=2,kind='regular',layout='compact',items={})
  with patch.dict(os.environ,{'APP_ORIGIN':'http://127.0.0.1:8001'}),patch('online.remote',side_effect=provider):
   self.assertEqual(request('/api/export-pdf','POST',payload)['status'],401)
   out=request('/api/export-pdf','POST',payload,'test-token')
   self.assertEqual(out['status'],200);self.assertEqual(dict(out['headers'])['Content-Type'],'application/pdf');self.assertTrue(out['body'].startswith(b'%PDF'))
   self.assertEqual(request('/api/export-pdf','POST',{**payload,'month':13},'test-token')['status'],400)

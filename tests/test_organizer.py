import json
import unittest
from online import validate_items, ApiError

class OrganizerValidation(unittest.TestCase):
    def item(self):
        return dict(id='test',kind='task',title='Confirmar cobertura',body='<texto literal>',date='2026-10-03',reminder='2026-09-27',shift='Diurno',status='Aguardando confirmação',doctor='',cover='')
    def test_valid_and_legacy(self):
        self.assertEqual(validate_items({'rt-upa:organizer':json.dumps([self.item()]),'rt-upa:doctors':'[]'})['organizer'][0]['title'],'Confirmar cobertura')
    def test_bad_date_and_duplicate(self):
        item=self.item();item['date']='2026-02-30'
        with self.assertRaises(ApiError):validate_items({'rt-upa:organizer':json.dumps([item])})
        with self.assertRaises(ApiError):validate_items({'rt-upa:organizer':json.dumps([self.item(),self.item()])})
    def test_bad_shape(self):
        with self.assertRaises(ApiError):validate_items({'rt-upa:organizer':'{}'})
        item=self.item();item['status']='unknown'
        with self.assertRaises(ApiError):validate_items({'rt-upa:organizer':json.dumps([item])})

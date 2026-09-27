import base64,json,unittest
from online import validate_subscription,ApiError
from test_online import request
class PushTests(unittest.TestCase):
 def test_reject_private_and_forged_endpoint(self):
  for url in ['https://127.0.0.1/x','https://web.push.apple.com.evil.test/x']:
   with self.assertRaises(ApiError): validate_subscription({'endpoint':url})
 def test_key_lengths(self):
  sub={'endpoint':'https://web.push.apple.com/test','keys':{'p256dh':base64.urlsafe_b64encode(bytes([4])+bytes(64)).decode(),'auth':base64.urlsafe_b64encode(bytes(16)).decode()}}
  validate_subscription(sub)
  sub['keys']['auth']='bad'
  with self.assertRaises(ApiError):validate_subscription(sub)
 def test_public_worker_and_manifest_no_private_data(self):
  for path in ['/sw.js','/manifest.webmanifest','/icon.png']:
   self.assertEqual(request(path)['status'],200)
  self.assertEqual(request('/api/push/config','POST',{})['status'],403)

